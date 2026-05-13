import { useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import {
  useGetProductionBatch,
  useGetBatchMovements,
  useGetBatchAnalytics,
  useCloseProductionBatch,
  useReopenProductionBatch,
  useListProjects,
  getGetProductionBatchQueryKey,
  getGetBatchMovementsQueryKey,
  getGetBatchAnalyticsQueryKey,
  getListProductionBatchesQueryKey,
} from "@workspace/api-client-react";
import type { BatchMovement } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  ArrowLeft,
  FlaskConical,
  Layers,
  Package,
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingDown,
  Warehouse,
  ShoppingCart,
  BarChart3,
  ClipboardList,
  Activity,
  Calendar,
  User,
  Box,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, unit: string, decimals = 2) {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: decimals })} ${unit}`;
}

function fmtDate(d: string) {
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return d; }
}
function fmtDateTime(d: string) {
  try { return format(parseISO(d), "dd MMM yyyy, HH:mm"); } catch { return d; }
}

function statusBadge(status: string) {
  if (status === "open")
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Open</Badge>;
  if (status === "closed")
    return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">Closed</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Voided</Badge>;
}

function movStatusBadge(status: string) {
  if (status === "confirmed")
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Confirmed</Badge>;
  if (status === "pending")
    return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Pending</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Cancelled</Badge>;
}

function movTypeLabel(t: string) {
  const labels: Record<string, string> = {
    production_in: "Production In",
    purchase: "Purchase",
    sale_out: "Sale Out",
    transfer_out: "Transfer Out",
    wastage: "Wastage",
    adjustment_in: "Adjustment In",
    adjustment_out: "Adjustment Out",
    opening_stock: "Opening Stock",
  };
  return labels[t] ?? t;
}

function movTypeColor(t: string) {
  if (t === "production_in" || t === "purchase" || t === "adjustment_in" || t === "opening_stock")
    return "text-emerald-400";
  return "text-red-400";
}

function stockTypeIcon(t: string) {
  if (t === "latex") return <FlaskConical className="h-4 w-4 text-sky-400" />;
  if (t === "rubber_sheet") return <Layers className="h-4 w-4 text-emerald-400" />;
  return <Package className="h-4 w-4 text-amber-400" />;
}

function stockTypeLabel(t: string) {
  if (t === "latex") return "Latex";
  if (t === "rubber_sheet") return "Rubber Sheet";
  if (t === "rubber_scrap") return "Rubber Scrap";
  return t;
}

const STOCK_TYPES = ["latex", "rubber_sheet", "rubber_scrap"] as const;

// ── Main Component ─────────────────────────────────────────────────────────────

export default function BatchDetail() {
  const params = useParams<{ id: string }>();
  const batchId = params.id!;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === "admin";
  const canManage = isAdmin || role === "developer";

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: batch, isLoading: loadingBatch } = useGetProductionBatch(batchId);
  const { data: movements, isLoading: loadingMov } = useGetBatchMovements(batchId);
  const { data: analytics, isLoading: loadingAnalytics } = useGetBatchAnalytics(batchId);
  const { data: projects } = useListProjects();

  const projectName = useMemo(() => {
    if (!batch) return undefined;
    return projects?.find((p) => p.id === batch.projectId)?.name ?? batch.projectName;
  }, [batch, projects]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const closeBatch = useCloseProductionBatch();
  const reopenBatch = useReopenProductionBatch();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetProductionBatchQueryKey(batchId) });
    qc.invalidateQueries({ queryKey: getGetBatchMovementsQueryKey(batchId) });
    qc.invalidateQueries({ queryKey: getGetBatchAnalyticsQueryKey(batchId) });
    qc.invalidateQueries({ queryKey: getListProductionBatchesQueryKey() });
  }

  async function handleClose() {
    try {
      await closeBatch.mutateAsync({ id: batchId });
      toast({ title: "Batch closed — inventory movements auto-created" });
      invalidate();
    } catch {
      toast({ title: "Failed to close batch", variant: "destructive" });
    }
  }

  async function handleReopen() {
    try {
      await reopenBatch.mutateAsync({ id: batchId });
      toast({ title: "Batch reopened" });
      invalidate();
    } catch {
      toast({ title: "Failed to reopen batch", variant: "destructive" });
    }
  }

  // ── Analytics chart data ──────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!analytics?.stockSummary) return [];
    return STOCK_TYPES.filter((t) => {
      const s = analytics.stockSummary[t];
      return s && s.produced > 0;
    }).map((t) => {
      const s = analytics.stockSummary[t];
      return {
        name: stockTypeLabel(t),
        Produced: s.produced,
        "In Inventory": s.stockedIn,
        Sold: s.saleOut,
        Remaining: s.remaining,
      };
    });
  }, [analytics]);

  // ── Movement timeline grouped by date ─────────────────────────────────────
  const movByDate = useMemo(() => {
    if (!movements) return [];
    const map: Record<string, BatchMovement[]> = {};
    for (const m of movements) {
      const d = m.movementDate;
      if (!map[d]) map[d] = [];
      map[d].push(m);
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [movements]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loadingBatch) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="p-6 text-center text-slate-400">
        <p>Batch not found.</p>
        <Button variant="ghost" className="mt-3" onClick={() => navigate("/production-log")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Production Log
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">

      {/* ── Back + Header ────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 mb-2 transition-colors"
            onClick={() => navigate("/production-log")}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Production Log
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold font-mono text-slate-100">{batch.batchNumber}</h1>
            {statusBadge(batch.status)}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-slate-400 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> {fmtDate(batch.batchDate)}
            </span>
            <span className="flex items-center gap-1">
              <Box className="h-3.5 w-3.5" /> {projectName ?? batch.projectId.slice(0, 8)}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" /> {batch.createdByName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && batch.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              className="border-slate-600 hover:bg-slate-700 text-slate-300"
              onClick={handleClose}
              disabled={closeBatch.isPending}
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" /> Close Batch
            </Button>
          )}
          {isAdmin && batch.status === "closed" && (
            <Button
              size="sm"
              variant="outline"
              className="border-slate-600 hover:bg-slate-700 text-slate-300"
              onClick={handleReopen}
              disabled={reopenBatch.isPending}
            >
              <Unlock className="h-3.5 w-3.5 mr-1.5" /> Reopen
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sky-400 mb-1">
              <FlaskConical className="h-4 w-4" />
              <span className="text-xs font-medium text-slate-400">Latex</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {fmt(batch.totalLatexLitres, "L")}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-emerald-400 mb-1">
              <Layers className="h-4 w-4" />
              <span className="text-xs font-medium text-slate-400">Sheet</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {fmt(batch.totalSheetKg, "kg")}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-amber-400 mb-1">
              <Package className="h-4 w-4" />
              <span className="text-xs font-medium text-slate-400">Scrap</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {fmt(batch.totalScrapKg, "kg")}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-violet-400 mb-1">
              <Activity className="h-4 w-4" />
              <span className="text-xs font-medium text-slate-400">Entries</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {batch.entryCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Lifecycle info bar ────────────────────────────────────────────── */}
      <Card className="bg-slate-800/50 border-white/10">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-slate-500 text-xs block mb-0.5">Created by</span>
              <span className="text-slate-200">{batch.createdByName}</span>
            </div>
            <div>
              <span className="text-slate-500 text-xs block mb-0.5">Created at</span>
              <span className="text-slate-200">{fmtDateTime(batch.createdAt)}</span>
            </div>
            {batch.closedAt && (
              <>
                <div>
                  <span className="text-slate-500 text-xs block mb-0.5">Closed by</span>
                  <span className="text-slate-200">{batch.closedByName ?? "—"}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-xs block mb-0.5">Closed at</span>
                  <span className="text-slate-200">{fmtDateTime(batch.closedAt)}</span>
                </div>
              </>
            )}
            <div>
              <span className="text-slate-500 text-xs block mb-0.5">Stock movements</span>
              <span className="text-slate-200">{analytics?.stockMovementCount ?? "—"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Main tabs ────────────────────────────────────────────────────── */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-slate-800/60 border border-white/10">
          <TabsTrigger value="overview" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="entries" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs">
            <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Entries
          </TabsTrigger>
          <TabsTrigger value="movements" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs">
            <Activity className="h-3.5 w-3.5 mr-1.5" /> Stock Movements
          </TabsTrigger>
          <TabsTrigger value="analytics" className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs">
            <TrendingDown className="h-3.5 w-3.5 mr-1.5" /> Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab ────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">

          {/* Stock fate cards */}
          {loadingAnalytics ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {STOCK_TYPES.map((t) => <Skeleton key={t} className="h-40" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {STOCK_TYPES.map((t) => {
                const s = analytics?.stockSummary?.[t];
                if (!s || s.produced === 0) return null;
                const unit = s.unit;
                const pct = s.stockedIn > 0 ? Math.round((s.saleOut / s.stockedIn) * 100) : 0;
                return (
                  <Card key={t} className="bg-slate-800/60 border-white/10">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-200">
                        {stockTypeIcon(t)} {stockTypeLabel(t)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <ArrowDownCircle className="h-3.5 w-3.5 text-emerald-400" /> Produced
                        </span>
                        <span className="font-mono text-slate-100">{fmt(s.produced, unit)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <Warehouse className="h-3.5 w-3.5 text-sky-400" /> Stocked In
                        </span>
                        <span className="font-mono text-slate-100">{fmt(s.stockedIn, unit)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <ShoppingCart className="h-3.5 w-3.5 text-rose-400" /> Sold
                        </span>
                        <span className="font-mono text-slate-100">{fmt(s.saleOut, unit)}</span>
                      </div>
                      {s.transferOut > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-slate-400">
                            <ArrowUpCircle className="h-3.5 w-3.5 text-orange-400" /> Transferred
                          </span>
                          <span className="font-mono text-slate-100">{fmt(s.transferOut, unit)}</span>
                        </div>
                      )}
                      {s.wastage > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-slate-400">
                            <XCircle className="h-3.5 w-3.5 text-red-400" /> Wastage
                          </span>
                          <span className="font-mono text-slate-100">{fmt(s.wastage, unit)}</span>
                        </div>
                      )}
                      <div className="border-t border-white/10 pt-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">Remaining</span>
                        <span className={`font-mono text-sm font-bold ${s.remaining > 0 ? "text-emerald-400" : "text-slate-400"}`}>
                          {fmt(s.remaining, unit)}
                        </span>
                      </div>
                      {s.stockedIn > 0 && (
                        <div>
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>Sold</span><span>{pct}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {analytics && STOCK_TYPES.every((t) => !analytics.stockSummary?.[t] || analytics.stockSummary[t].produced === 0) && (
                <div className="md:col-span-3 text-center py-6 text-slate-500 text-sm">No production data yet.</div>
              )}
            </div>
          )}

          {/* Batch origin info */}
          <Card className="bg-slate-800/50 border-white/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-slate-300">Batch Origin</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Batch Number</span>
                  <span className="font-mono text-slate-100">{batch.batchNumber}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Production Date</span>
                  <span className="text-slate-200">{fmtDate(batch.batchDate)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Project</span>
                  <span className="text-slate-200">{projectName ?? "—"}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Created by</span>
                  <span className="text-slate-200">{batch.createdByName}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Status</span>
                  {statusBadge(batch.status)}
                </div>
                {batch.notes && (
                  <div className="md:col-span-3">
                    <span className="text-xs text-slate-500 block mb-0.5">Notes</span>
                    <span className="text-slate-300">{batch.notes}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Entries tab ─────────────────────────────────────────────── */}
        <TabsContent value="entries" className="mt-4">
          <Card className="bg-slate-800/60 border-white/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <ClipboardList className="h-4 w-4" /> Production Entries
                <Badge variant="outline" className="text-xs ml-auto border-slate-600 text-slate-400">
                  {analytics?.entries?.length ?? 0} entries
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingAnalytics ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : !analytics?.entries?.length ? (
                <div className="py-10 text-center text-slate-500 text-sm">No entries in this batch.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/10 hover:bg-transparent">
                        <TableHead className="text-slate-400 font-medium">Type</TableHead>
                        <TableHead className="text-slate-400 font-medium text-right">Quantity</TableHead>
                        <TableHead className="text-slate-400 font-medium">Date</TableHead>
                        <TableHead className="text-slate-400 font-medium">Entered By</TableHead>
                        <TableHead className="text-slate-400 font-medium">Remarks</TableHead>
                        <TableHead className="text-slate-400 font-medium">Recorded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.entries.map((e, i) => (
                        <TableRow key={e.id} className={`border-white/5 hover:bg-white/3 ${i % 2 === 0 ? "" : "bg-slate-900/20"}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {stockTypeIcon(e.productionType)}
                              <span className="text-sm text-slate-200">{stockTypeLabel(e.productionType)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-slate-100">
                            {fmt(e.quantity, e.unit)}
                          </TableCell>
                          <TableCell className="text-sm text-slate-400">{e.productionDate}</TableCell>
                          <TableCell className="text-sm text-slate-400">{e.enteredByName}</TableCell>
                          <TableCell className="text-sm text-slate-500">{e.remarks ?? "—"}</TableCell>
                          <TableCell className="text-xs text-slate-500">{fmtDateTime(e.createdAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Movements tab ───────────────────────────────────────────── */}
        <TabsContent value="movements" className="mt-4 space-y-4">
          {loadingMov ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !movements?.length ? (
            <Card className="bg-slate-800/50 border-white/10">
              <CardContent className="py-10 text-center text-slate-500 text-sm">
                No inventory movements linked to this batch.
                {batch.status === "open" && (
                  <p className="mt-1 text-xs text-slate-600">Close the batch to auto-create stock movements.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Timeline view */}
              <div className="space-y-4">
                {movByDate.map(([date, movs]) => (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        {fmtDate(date)}
                      </span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                    <div className="space-y-1.5">
                      {movs.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2.5"
                        >
                          <div className={`shrink-0 ${movTypeColor(m.movementType)}`}>
                            {m.direction === "in"
                              ? <ArrowDownCircle className="h-4 w-4" />
                              : <ArrowUpCircle className="h-4 w-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-slate-200">{movTypeLabel(m.movementType)}</span>
                              <div className="flex items-center gap-1">
                                {stockTypeIcon(m.stockType)}
                                <span className="text-xs text-slate-400">{stockTypeLabel(m.stockType)}</span>
                              </div>
                              {movStatusBadge(m.status)}
                            </div>
                            {m.notes && (
                              <p className="text-xs text-slate-500 mt-0.5 truncate">{m.notes}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`font-mono text-sm font-semibold ${m.direction === "in" ? "text-emerald-400" : "text-rose-400"}`}>
                              {m.direction === "in" ? "+" : "−"}{fmt(m.quantity, m.unit)}
                            </div>
                            <div className="text-xs text-slate-500">{m.createdByName}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Table view */}
              <Card className="bg-slate-800/60 border-white/10">
                <CardHeader className="pb-2 pt-3 px-4">
                  <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    All Movements
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/10 hover:bg-transparent">
                          <TableHead className="text-slate-400">Type</TableHead>
                          <TableHead className="text-slate-400">Stock</TableHead>
                          <TableHead className="text-slate-400 text-right">Qty</TableHead>
                          <TableHead className="text-slate-400">Date</TableHead>
                          <TableHead className="text-slate-400">Status</TableHead>
                          <TableHead className="text-slate-400">By</TableHead>
                          <TableHead className="text-slate-400">Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movements.map((m) => (
                          <TableRow key={m.id} className="border-white/5 hover:bg-white/3">
                            <TableCell>
                              <span className={`text-sm ${movTypeColor(m.movementType)}`}>
                                {movTypeLabel(m.movementType)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {stockTypeIcon(m.stockType)}
                                <span className="text-xs text-slate-400">{stockTypeLabel(m.stockType)}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <span className={m.direction === "in" ? "text-emerald-400" : "text-rose-400"}>
                                {m.direction === "in" ? "+" : "−"}{fmt(m.quantity, m.unit)}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-slate-400">{m.movementDate}</TableCell>
                            <TableCell>{movStatusBadge(m.status)}</TableCell>
                            <TableCell className="text-xs text-slate-400">{m.createdByName}</TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-40 truncate">{m.notes ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Analytics tab ───────────────────────────────────────────── */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          {loadingAnalytics ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <>
              {/* Bar chart */}
              {chartData.length > 0 && (
                <Card className="bg-slate-800/60 border-white/10">
                  <CardHeader className="pb-0 pt-4 px-4">
                    <CardTitle className="text-sm font-medium text-slate-300">
                      Stock Flow by Type
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 pb-4 px-2">
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} />
                        <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} width={50} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                        <Bar dataKey="Produced" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="In Inventory" fill="#22c55e" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Sold" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="Remaining" fill="#a855f7" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Per-type table */}
              <Card className="bg-slate-800/60 border-white/10">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-slate-300">Inventory Summary</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/10 hover:bg-transparent">
                          <TableHead className="text-slate-400">Stock Type</TableHead>
                          <TableHead className="text-slate-400 text-right">Produced</TableHead>
                          <TableHead className="text-slate-400 text-right">Stocked In</TableHead>
                          <TableHead className="text-slate-400 text-right">Sold</TableHead>
                          <TableHead className="text-slate-400 text-right">Transferred</TableHead>
                          <TableHead className="text-slate-400 text-right">Wastage</TableHead>
                          <TableHead className="text-slate-400 text-right">Remaining</TableHead>
                          <TableHead className="text-slate-400 text-right">Coverage</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {STOCK_TYPES.map((t) => {
                          const s = analytics?.stockSummary?.[t];
                          if (!s) return null;
                          const unit = s.unit;
                          const coverage = s.produced > 0 ? Math.round((s.stockedIn / s.produced) * 100) : 0;
                          return (
                            <TableRow key={t} className="border-white/5 hover:bg-white/3">
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {stockTypeIcon(t)}
                                  <span className="text-sm text-slate-200">{stockTypeLabel(t)}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-slate-100">{fmt(s.produced, unit)}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-emerald-400">{fmt(s.stockedIn, unit)}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-rose-400">{fmt(s.saleOut, unit)}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-orange-400">{fmt(s.transferOut, unit)}</TableCell>
                              <TableCell className="text-right font-mono text-sm text-red-400">{fmt(s.wastage, unit)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-semibold text-violet-400">{fmt(s.remaining, unit)}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-sky-500 rounded-full" style={{ width: `${Math.min(coverage, 100)}%` }} />
                                  </div>
                                  <span className="text-xs text-slate-400 w-9 text-right">{coverage}%</span>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Batch status summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="bg-slate-800/50 border-white/10">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 rounded-lg"><CheckCircle2 className="h-4 w-4 text-emerald-400" /></div>
                    <div>
                      <div className="text-xs text-slate-500">Status</div>
                      <div className="text-sm font-medium text-slate-200 capitalize">{batch.status}</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800/50 border-white/10">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="p-2 bg-sky-500/10 rounded-lg"><Activity className="h-4 w-4 text-sky-400" /></div>
                    <div>
                      <div className="text-xs text-slate-500">Movements</div>
                      <div className="text-sm font-medium text-slate-200">{analytics?.stockMovementCount ?? 0}</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800/50 border-white/10">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="p-2 bg-violet-500/10 rounded-lg"><ClipboardList className="h-4 w-4 text-violet-400" /></div>
                    <div>
                      <div className="text-xs text-slate-500">Entries</div>
                      <div className="text-sm font-medium text-slate-200">{batch.entryCount}</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-slate-800/50 border-white/10">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 rounded-lg"><Clock className="h-4 w-4 text-amber-400" /></div>
                    <div>
                      <div className="text-xs text-slate-500">Batch Date</div>
                      <div className="text-sm font-medium text-slate-200">{fmtDate(batch.batchDate)}</div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
