import { useState, useMemo } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInventoryStockBalance,
  useGetInventoryStockSummary,
  useListStockMovements,
  useCreateStockMovement,
  useConfirmStockMovement,
  useCancelStockMovement,
  useDeleteStockMovement,
  useListProjects,
  useListProductionBatches,
  getGetInventoryStockBalanceQueryKey,
  getGetInventoryStockSummaryQueryKey,
  getListStockMovementsQueryKey,
  ListStockMovementsStatus,
} from "@workspace/api-client-react";
import type { StockMovement } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  FlaskConical,
  Layers,
  Package,
  PackageOpen,
  TrendingUp,
  TrendingDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  Check,
  X,
  Trash2,
  BarChart3,
  ClipboardCheck,
  History,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";

// ── Constants ─────────────────────────────────────────────────────────────────

type StockType = "latex" | "rubber_sheet" | "rubber_scrap";
type MovementType =
  | "opening"
  | "production_in"
  | "purchase_in"
  | "sale_out"
  | "transfer_out"
  | "wastage"
  | "adjustment_in"
  | "adjustment_out";

const STOCK_TYPES = [
  { value: "latex" as StockType, label: "Latex", unit: "L", icon: <FlaskConical className="h-4 w-4" />, color: "sky" },
  { value: "rubber_sheet" as StockType, label: "Rubber Sheet", unit: "kg", icon: <Layers className="h-4 w-4" />, color: "emerald" },
  { value: "rubber_scrap" as StockType, label: "Rubber Scrap", unit: "kg", icon: <Package className="h-4 w-4" />, color: "amber" },
];

const MOVEMENT_TYPES = [
  { value: "opening" as MovementType, label: "Opening Stock", direction: "in" as const, group: "Stock In" },
  { value: "production_in" as MovementType, label: "From Production", direction: "in" as const, group: "Stock In" },
  { value: "purchase_in" as MovementType, label: "Purchase / Receipt", direction: "in" as const, group: "Stock In" },
  { value: "sale_out" as MovementType, label: "Sale", direction: "out" as const, group: "Stock Out" },
  { value: "transfer_out" as MovementType, label: "Transfer Out", direction: "out" as const, group: "Stock Out" },
  { value: "wastage" as MovementType, label: "Wastage / Loss", direction: "out" as const, group: "Stock Out" },
  { value: "adjustment_in" as MovementType, label: "Adjustment (+)", direction: "in" as const, group: "Adjustments", requiresApproval: true },
  { value: "adjustment_out" as MovementType, label: "Adjustment (−)", direction: "out" as const, group: "Adjustments", requiresApproval: true },
];

function stockTypeMeta(t: string) {
  return STOCK_TYPES.find((s) => s.value === t) ?? STOCK_TYPES[0];
}
function movementMeta(t: string) {
  return MOVEMENT_TYPES.find((m) => m.value === t);
}
function fmt(n: number, unit: string) {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${unit}`;
}

function statusBadge(status: string) {
  if (status === "confirmed")
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Confirmed</Badge>;
  if (status === "pending")
    return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Pending</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Cancelled</Badge>;
}

function directionCell(direction: string, qty: number, unit: string) {
  return direction === "in" ? (
    <span className="inline-flex items-center gap-1 text-emerald-400 font-mono text-sm">
      <TrendingUp className="h-3.5 w-3.5" />
      +{qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {unit}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-red-400 font-mono text-sm">
      <TrendingDown className="h-3.5 w-3.5" />
      −{qty.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {unit}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Inventory() {
  const { role, assignedProjectIds, canAccessAllProjects } = useRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  const isAdmin = role === "admin";
  const canManage = role === "admin" || role === "developer";
  const canOperate = canManage || role === "employee" || role === "operational_staff";

  // ── Filters ───────────────────────────────────────────────────────────────
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [stockTypeFilter, setStockTypeFilter] = useState<string>("all");
  const [movTypeFilter, setMovTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: projects } = useListProjects();
  const effectiveProjectId = projectFilter !== "all" ? projectFilter : undefined;

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: balanceRows, isLoading: loadingBalance } = useGetInventoryStockBalance({
    projectId: effectiveProjectId,
  });

  const { data: summary, isLoading: loadingSummary } = useGetInventoryStockSummary({
    projectId: effectiveProjectId,
  });

  const { data: movements, isLoading: loadingMovements } = useListStockMovements({
    projectId: effectiveProjectId,
    stockType: stockTypeFilter !== "all" ? (stockTypeFilter as StockType) : undefined,
    movementType: movTypeFilter !== "all" ? movTypeFilter : undefined,
    status: statusFilter !== "all" ? (statusFilter as ListStockMovementsStatus) : undefined,
  });

  const { data: productionBatches } = useListProductionBatches({
    projectId: effectiveProjectId,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMov = useCreateStockMovement();
  const confirmMov = useConfirmStockMovement();
  const cancelMov = useCancelStockMovement();
  const deleteMov = useDeleteStockMovement();

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: getGetInventoryStockBalanceQueryKey() });
    qc.invalidateQueries({ queryKey: getGetInventoryStockSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getListStockMovementsQueryKey() });
  }

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [movDialog, setMovDialog] = useState<{ open: boolean; tab: "in" | "out" | "adjustment" }>({
    open: false,
    tab: "in",
  });

  type MovForm = {
    projectId: string;
    stockType: StockType;
    movementType: MovementType;
    quantity: string;
    movementDate: string;
    batchId: string;
    referenceId: string;
    referenceType: string;
    notes: string;
  };

  const [movForm, setMovForm] = useState<MovForm>({
    projectId: "",
    stockType: "latex",
    movementType: "production_in",
    quantity: "",
    movementDate: format(new Date(), "yyyy-MM-dd"),
    batchId: "",
    referenceId: "",
    referenceType: "",
    notes: "",
  });

  const [confirmAction, setConfirmAction] = useState<{
    mov: StockMovement;
    action: "confirm" | "cancel" | "delete";
  } | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function openMovDialog(tab: "in" | "out" | "adjustment") {
    const defaultType: MovementType =
      tab === "in" ? "production_in" : tab === "out" ? "sale_out" : "adjustment_in";
    setMovForm({
      projectId: effectiveProjectId ?? "",
      stockType: "latex",
      movementType: defaultType,
      quantity: "",
      movementDate: format(new Date(), "yyyy-MM-dd"),
      batchId: "",
      referenceId: "",
      referenceType: "",
      notes: "",
    });
    setMovDialog({ open: true, tab });
  }

  function unitForType(stockType: StockType): "litres" | "kg" {
    return stockType === "latex" ? "litres" : "kg";
  }

  async function handleCreateMovement() {
    if (!movForm.projectId || !movForm.stockType || !movForm.movementType || !movForm.quantity || !movForm.movementDate)
      return;
    try {
      await createMov.mutateAsync({
        data: {
          projectId: movForm.projectId,
          stockType: movForm.stockType,
          movementType: movForm.movementType,
          quantity: Number(movForm.quantity),
          unit: unitForType(movForm.stockType),
          movementDate: movForm.movementDate,
          batchId: movForm.batchId || undefined,
          referenceId: movForm.referenceId || undefined,
          referenceType: movForm.referenceType || undefined,
          notes: movForm.notes || undefined,
        },
      });
      toast({ title: "Movement recorded" });
      setMovDialog({ open: false, tab: "in" });
      invalidateAll();
    } catch {
      toast({ title: "Failed to record movement", variant: "destructive" });
    }
  }

  async function handleConfirmAction() {
    if (!confirmAction) return;
    const { mov, action } = confirmAction;
    try {
      if (action === "confirm") {
        await confirmMov.mutateAsync({ id: mov.id });
        toast({ title: "Movement confirmed — stock balance updated" });
      } else if (action === "cancel") {
        await cancelMov.mutateAsync({ id: mov.id });
        toast({ title: "Movement cancelled" });
      } else {
        await deleteMov.mutateAsync({ id: mov.id });
        toast({ title: "Movement removed" });
      }
      setConfirmAction(null);
      invalidateAll();
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const visibleProjects = useMemo(() => {
    if (!projects) return [];
    if (canAccessAllProjects) return projects;
    return projects.filter((p) => assignedProjectIds.includes(p.id));
  }, [projects, canAccessAllProjects, assignedProjectIds]);

  const globalBalance = useMemo(() => {
    if (!balanceRows) return {} as Record<string, number>;
    const totals: Record<string, number> = {};
    for (const r of balanceRows) {
      totals[r.stockType] = (totals[r.stockType] ?? 0) + r.balance;
    }
    return totals;
  }, [balanceRows]);

  const pendingCount = summary?.pendingCount ?? 0;

  const chartData = useMemo(() => {
    if (!summary?.stockSummary) return [];
    return summary.stockSummary.map((s) => ({
      name: stockTypeMeta(s.stockType).label,
      "Prod In": +s.productionIn.toFixed(1),
      "Sale Out": +s.saleOut.toFixed(1),
      Wastage: +s.wastage.toFixed(1),
      Balance: +Math.max(s.balance, 0).toFixed(1),
    }));
  }, [summary]);

  const dialogMovTypes = useMemo(() => {
    if (movDialog.tab === "in") return MOVEMENT_TYPES.filter((m) => m.group === "Stock In");
    if (movDialog.tab === "out") return MOVEMENT_TYPES.filter((m) => m.group === "Stock Out");
    return MOVEMENT_TYPES.filter((m) => m.group === "Adjustments");
  }, [movDialog.tab]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-slate-950 text-slate-100">
      {/* ── Page header ── */}
      <div className="border-b border-white/10 bg-slate-900/50 px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-white flex items-center gap-2">
              <PackageOpen className="h-5 w-5 text-sky-400" />
              Inventory &amp; Stock
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Audit-friendly ledger — every movement is recorded and preserved
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {pendingCount} pending
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-44 h-9 bg-slate-800 border-slate-600 text-sm">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Projects</SelectItem>
                {visibleProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canOperate && (
              <>
                <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={() => openMovDialog("in")}>
                  <ArrowDownToLine className="h-4 w-4 mr-1" /> Stock In
                </Button>
                <Button size="sm" variant="outline"
                  className="h-9 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => openMovDialog("out")}>
                  <ArrowUpFromLine className="h-4 w-4 mr-1" /> Stock Out
                </Button>
                <Button size="sm" variant="outline"
                  className="h-9 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                  onClick={() => openMovDialog("adjustment")}>
                  <SlidersHorizontal className="h-4 w-4 mr-1" /> Adjust
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Balance KPI strip ── */}
      <div className="grid grid-cols-3 gap-px bg-white/5 border-b border-white/10">
        {STOCK_TYPES.map((st) => {
          const bal = globalBalance[st.value] ?? 0;
          const isLow = bal > 0 && bal < 50;
          const isZero = bal <= 0;
          return (
            <div key={st.value} className="bg-slate-900/60 px-4 py-3 flex items-center gap-3">
              <div className={`shrink-0 p-2 rounded-lg bg-slate-800 ${isLow ? "ring-1 ring-amber-500/30" : ""}`}>
                {st.icon}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-slate-400">{st.label}</div>
                <div className={`text-lg font-semibold truncate ${isLow ? "text-amber-300" : isZero ? "text-red-400" : "text-white"}`}>
                  {loadingBalance ? "—" : bal.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  <span className="text-xs text-slate-400 ml-1 font-normal">{st.unit}</span>
                </div>
                {isLow && <div className="text-xs text-amber-500">Low stock</div>}
                {isZero && !loadingBalance && <div className="text-xs text-red-500">No stock</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="dashboard" className="flex-1 flex flex-col">
        <div className="border-b border-white/10 bg-slate-900/30 px-4 sm:px-6">
          <TabsList className="bg-transparent border-0 gap-0 h-10">
            {[
              { value: "dashboard", label: "Dashboard", icon: <BarChart3 className="h-3.5 w-3.5" /> },
              { value: "movements", label: "Movements", icon: <History className="h-3.5 w-3.5" /> },
              {
                value: "pending",
                label: "Pending",
                icon: <ClipboardCheck className="h-3.5 w-3.5" />,
                badge: pendingCount > 0 ? pendingCount : undefined,
              },
            ].map((t) => (
              <TabsTrigger key={t.value} value={t.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-sky-400 data-[state=active]:text-sky-300 data-[state=active]:bg-transparent text-slate-400 text-sm h-10 px-4 flex items-center gap-1.5">
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
                {t.badge !== undefined && (
                  <span className="ml-1 bg-amber-500/20 text-amber-400 text-xs rounded-full px-1.5 py-0.5 leading-none">
                    {t.badge}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── Dashboard tab ── */}
        <TabsContent value="dashboard" className="flex-1 p-4 sm:p-6 space-y-6 mt-0">
          {loadingSummary ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          ) : (
            <>
              {/* Per-type stock cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(summary?.stockSummary ?? []).map((s) => {
                  const meta = stockTypeMeta(s.stockType);
                  return (
                    <Card key={s.stockType} className="bg-slate-900/60 border-white/10">
                      <CardHeader className="pb-2 flex flex-row items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-slate-800">{meta.icon}</span>
                        <CardTitle className="text-sm font-medium text-slate-300">{meta.label}</CardTitle>
                        <span className="ml-auto text-xs text-slate-500">{meta.unit}</span>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-2xl font-bold ${s.balance <= 0 ? "text-red-400" : s.balance < 50 ? "text-amber-300" : "text-white"}`}>
                            {s.balance.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                          </span>
                          <span className="text-xs text-slate-400">balance</span>
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between text-slate-400">
                            <span className="flex items-center gap-1">
                              <TrendingUp className="h-3 w-3 text-emerald-400" /> Total In
                            </span>
                            <span className="font-mono text-emerald-300">{fmt(s.totalIn, meta.unit)}</span>
                          </div>
                          <div className="flex justify-between text-slate-400">
                            <span className="flex items-center gap-1">
                              <TrendingDown className="h-3 w-3 text-red-400" /> Total Out
                            </span>
                            <span className="font-mono text-red-300">{fmt(s.totalOut, meta.unit)}</span>
                          </div>
                          <div className="border-t border-white/5 pt-1 space-y-1">
                            <div className="flex justify-between text-slate-400">
                              <span>Prod. In</span>
                              <span className="font-mono">{fmt(s.productionIn, meta.unit)}</span>
                            </div>
                            <div className="flex justify-between text-slate-400">
                              <span>Sold</span>
                              <span className="font-mono">{fmt(s.saleOut, meta.unit)}</span>
                            </div>
                            <div className="flex justify-between text-slate-400">
                              <span>Wastage</span>
                              <span className="font-mono text-red-300/60">{fmt(s.wastage, meta.unit)}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Movement stat pills */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Movements", value: summary?.totalMovements ?? 0, cls: "text-white" },
                  { label: "Confirmed", value: summary?.confirmedCount ?? 0, cls: "text-emerald-400" },
                  { label: "Pending Review", value: summary?.pendingCount ?? 0, cls: "text-amber-400" },
                  { label: "Cancelled", value: summary?.cancelledCount ?? 0, cls: "text-slate-500" },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-slate-900/60 border border-white/10 rounded-lg px-4 py-3">
                    <div className="text-xs text-slate-400">{kpi.label}</div>
                    <div className={`text-2xl font-bold mt-1 ${kpi.cls}`}>{kpi.value}</div>
                  </div>
                ))}
              </div>

              {/* Stock flow bar chart */}
              {chartData.length > 0 && (
                <Card className="bg-slate-900/60 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-300">Stock Flow by Type</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: "#1e293b",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Prod In" fill="#34d399" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="Sale Out" fill="#f87171" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="Wastage" fill="#fbbf24" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="Balance" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Movements tab ── */}
        <TabsContent value="movements" className="flex-1 p-4 sm:p-6 space-y-4 mt-0">
          <div className="flex flex-wrap gap-2">
            <Select value={stockTypeFilter} onValueChange={setStockTypeFilter}>
              <SelectTrigger className="w-36 h-8 text-sm bg-slate-800 border-slate-600">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Types</SelectItem>
                {STOCK_TYPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={movTypeFilter} onValueChange={setMovTypeFilter}>
              <SelectTrigger className="w-44 h-8 text-sm bg-slate-800 border-slate-600">
                <SelectValue placeholder="All Movements" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Movements</SelectItem>
                {MOVEMENT_TYPES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 h-8 text-sm bg-slate-800 border-slate-600">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loadingMovements ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded" />)}
            </div>
          ) : !movements?.length ? (
            <div className="text-center py-16 text-slate-500">
              <History className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <div className="text-base font-medium text-slate-400">No stock movements found</div>
              <p className="text-sm mt-1">Use Stock In / Stock Out / Adjust to record movements.</p>
            </div>
          ) : (
            <MovementsTable
              movements={movements}
              canManage={canManage}
              isAdmin={isAdmin}
              onConfirm={(mov) => setConfirmAction({ mov, action: "confirm" })}
              onCancel={(mov) => setConfirmAction({ mov, action: "cancel" })}
              onDelete={(mov) => setConfirmAction({ mov, action: "delete" })}
            />
          )}
        </TabsContent>

        {/* ── Pending tab ── */}
        <TabsContent value="pending" className="flex-1 p-4 sm:p-6 space-y-4 mt-0">
          {pendingCount === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <div className="text-base font-medium text-slate-400">No pending movements</div>
              <p className="text-sm mt-1">All adjustments have been reviewed.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {pendingCount} movement{pendingCount !== 1 ? "s" : ""} awaiting review
                  {!canManage && " — contact an admin or developer to review"}
                </span>
              </div>
              {canManage && (
                <MovementsTable
                  movements={(movements ?? []).filter((m) => m.status === "pending")}
                  canManage={canManage}
                  isAdmin={isAdmin}
                  onConfirm={(mov) => setConfirmAction({ mov, action: "confirm" })}
                  onCancel={(mov) => setConfirmAction({ mov, action: "cancel" })}
                  onDelete={(mov) => setConfirmAction({ mov, action: "delete" })}
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Add movement dialog ── */}
      <Dialog open={movDialog.open} onOpenChange={(o) => setMovDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="bg-slate-900 border-white/10 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              {movDialog.tab === "in" && (
                <><ArrowDownToLine className="h-4 w-4 text-emerald-400" /> Record Stock In</>
              )}
              {movDialog.tab === "out" && (
                <><ArrowUpFromLine className="h-4 w-4 text-red-400" /> Record Stock Out</>
              )}
              {movDialog.tab === "adjustment" && (
                <><SlidersHorizontal className="h-4 w-4 text-amber-400" /> Stock Adjustment</>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Project */}
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Project <span className="text-red-400">*</span></Label>
              <Select
                value={movForm.projectId}
                onValueChange={(v) => setMovForm((f) => ({ ...f, projectId: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {visibleProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stock type buttons */}
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Stock Type <span className="text-red-400">*</span></Label>
              <div className="grid grid-cols-3 gap-2">
                {STOCK_TYPES.map((st) => (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => setMovForm((f) => ({ ...f, stockType: st.value }))}
                    className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border text-xs font-medium transition-all ${
                      movForm.stockType === st.value
                        ? "border-sky-500 bg-sky-500/10 text-sky-300"
                        : "border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {st.icon}
                    <span>{st.label}</span>
                    <span className="text-slate-500 font-normal">{st.unit}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Movement type */}
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Movement Type <span className="text-red-400">*</span></Label>
              <Select
                value={movForm.movementType}
                onValueChange={(v) => setMovForm((f) => ({ ...f, movementType: v as MovementType }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {dialogMovTypes.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                      {m.requiresApproval ? " (requires approval)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantity + Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Quantity <span className="text-red-400">*</span></Label>
                <div className="flex">
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    className="bg-slate-800 border-slate-600 text-slate-100 rounded-r-none text-lg h-12 font-medium"
                    placeholder="0.0"
                    value={movForm.quantity}
                    onChange={(e) => setMovForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                  <div className="flex items-center px-3 bg-slate-700 border border-l-0 border-slate-600 rounded-r-md text-sm text-slate-300 font-medium min-w-[3.5rem] justify-center">
                    {unitForType(movForm.stockType)}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Date <span className="text-red-400">*</span></Label>
                <Input
                  type="date"
                  className="bg-slate-800 border-slate-600 text-slate-100 h-12"
                  value={movForm.movementDate}
                  onChange={(e) => setMovForm((f) => ({ ...f, movementDate: e.target.value }))}
                />
              </div>
            </div>

            {/* Production batch link */}
            {movForm.movementType === "production_in" && (
              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Link to Production Batch</Label>
                <Select
                  value={movForm.batchId}
                  onValueChange={(v) => setMovForm((f) => ({ ...f, batchId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600">
                    <SelectValue placeholder="Optional — select batch" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="__none__">No batch link</SelectItem>
                    {(productionBatches ?? [])
                      .filter((b) => !movForm.projectId || b.projectId === movForm.projectId)
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.batchNumber} ({b.batchDate})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Reference */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Reference No.</Label>
                <Input
                  className="bg-slate-800 border-slate-600 text-slate-100 h-9 text-sm"
                  placeholder="Invoice / PO / Sale"
                  value={movForm.referenceId}
                  onChange={(e) => setMovForm((f) => ({ ...f, referenceId: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Ref. Type</Label>
                <Select
                  value={movForm.referenceType}
                  onValueChange={(v) => setMovForm((f) => ({ ...f, referenceType: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="h-9 bg-slate-800 border-slate-600 text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="__none__">None</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="sale">Sale</SelectItem>
                    <SelectItem value="purchase">Purchase</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Notes</Label>
              <Textarea
                className="bg-slate-800 border-slate-600 text-slate-100 resize-none text-sm"
                placeholder="Optional remarks, source, or reason…"
                rows={2}
                value={movForm.notes}
                onChange={(e) => setMovForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {movDialog.tab === "adjustment" && (
              <p className="text-xs text-amber-400 flex items-start gap-1.5 bg-amber-500/5 border border-amber-500/20 rounded p-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {canManage
                  ? "Your adjustments are auto-confirmed. Staff-submitted adjustments need your approval."
                  : "This adjustment will be submitted as pending and requires admin/developer approval before affecting the stock balance."}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="text-slate-400">Cancel</Button>
            </DialogClose>
            <Button
              className={`text-white ${
                movDialog.tab === "in"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : movDialog.tab === "out"
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-amber-600 hover:bg-amber-500"
              }`}
              disabled={
                !movForm.projectId || !movForm.quantity || !movForm.movementDate || createMov.isPending
              }
              onClick={handleCreateMovement}
            >
              {createMov.isPending ? "Saving…" : "Record Movement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm / Cancel / Delete alert ── */}
      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent className="bg-slate-900 border-white/10 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {confirmAction?.action === "confirm" && "Confirm this movement?"}
              {confirmAction?.action === "cancel" && "Cancel this movement?"}
              {confirmAction?.action === "delete" && "Delete this movement?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {confirmAction?.action === "confirm" &&
                `Confirming will add this ${movementMeta(confirmAction.mov.movementType)?.label ?? ""} of ${fmt(confirmAction.mov.quantity, confirmAction.mov.unit)} to the confirmed stock balance.`}
              {confirmAction?.action === "cancel" &&
                "This movement will be cancelled and will not affect the stock balance."}
              {confirmAction?.action === "delete" &&
                "This will permanently hide the movement from all reports and history."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-300">
              Back
            </AlertDialogCancel>
            <AlertDialogAction
              className={`text-white ${
                confirmAction?.action === "confirm"
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-red-600 hover:bg-red-500"
              }`}
              onClick={handleConfirmAction}
            >
              {confirmAction?.action === "confirm"
                ? "Confirm"
                : confirmAction?.action === "cancel"
                  ? "Cancel Movement"
                  : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── MovementsTable ─────────────────────────────────────────────────────────────

function MovementsTable({
  movements,
  canManage,
  isAdmin,
  onConfirm,
  onCancel,
  onDelete,
}: {
  movements: StockMovement[];
  canManage: boolean;
  isAdmin: boolean;
  onConfirm: (m: StockMovement) => void;
  onCancel: (m: StockMovement) => void;
  onDelete: (m: StockMovement) => void;
}) {
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableHead className="text-slate-400 text-xs">Date</TableHead>
              <TableHead className="text-slate-400 text-xs">Stock Type</TableHead>
              <TableHead className="text-slate-400 text-xs">Movement</TableHead>
              <TableHead className="text-right text-slate-400 text-xs">Quantity</TableHead>
              <TableHead className="text-slate-400 text-xs hidden sm:table-cell">Project</TableHead>
              <TableHead className="text-slate-400 text-xs hidden md:table-cell">Reference</TableHead>
              <TableHead className="text-slate-400 text-xs hidden lg:table-cell">Recorded by</TableHead>
              <TableHead className="text-slate-400 text-xs">Status</TableHead>
              {canManage && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.map((m) => {
              const meta = stockTypeMeta(m.stockType);
              const movMeta = movementMeta(m.movementType);
              return (
                <TableRow key={m.id} className="border-white/5 hover:bg-white/[0.02]">
                  <TableCell className="text-xs text-slate-400 whitespace-nowrap">{m.movementDate}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 shrink-0">{meta.icon}</span>
                      <span className="text-xs text-slate-300">{meta.label}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-300">{movMeta?.label ?? m.movementType}</TableCell>
                  <TableCell className="text-right">
                    {directionCell(m.direction, m.quantity, m.unit)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-400 hidden sm:table-cell">
                    {m.projectName ?? m.projectId.slice(0, 8)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-col gap-0.5">
                      {m.referenceId ? (
                        <span className="text-xs font-mono text-slate-400">{m.referenceId}</span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                      {m.batchNumber && (
                        <span className="text-xs text-sky-400/70 font-mono">{m.batchNumber}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 hidden lg:table-cell">
                    {m.createdByName}
                  </TableCell>
                  <TableCell>{statusBadge(m.status)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        {m.status === "pending" && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/10"
                              title="Confirm"
                              onClick={() => onConfirm(m)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                              title="Cancel"
                              onClick={() => onCancel(m)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {m.status === "confirmed" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                            title="Cancel movement"
                            onClick={() => onCancel(m)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-400/40 hover:text-red-400 hover:bg-red-500/10"
                            title="Delete (admin)"
                            onClick={() => onDelete(m)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
