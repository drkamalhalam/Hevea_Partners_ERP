import { useState, useMemo } from "react";
import { format, parseISO, startOfDay, isToday } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProductionBatches,
  useCreateProductionBatch,
  useCloseProductionBatch,
  useReopenProductionBatch,
  useListProductionEntries,
  useCreateProductionEntry,
  useUpdateProductionEntry,
  useDeleteProductionEntry,
  useGetProductionLogSummary,
  useListProjects,
  getListProductionBatchesQueryKey,
  getListProductionEntriesQueryKey,
  getGetProductionLogSummaryQueryKey,
  getListProductionBatchesQueryOptions,
} from "@workspace/api-client-react";
import type { ProductionBatch, ProductionEntry } from "@workspace/api-client-react";
import { CreateProductionEntryBodyUnit, UpdateProductionEntryBodyUnit } from "@workspace/api-client-react";
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
  Plus,
  FlaskConical,
  Layers,
  Package,
  ChevronDown,
  ChevronRight,
  Lock,
  Unlock,
  Trash2,
  Pencil,
  ClipboardList,
  BarChart3,
  History,
  LayoutGrid,
  Check,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProductionType = "latex" | "rubber_sheet" | "rubber_scrap";
type BatchStatus = "open" | "closed" | "voided";

const PRODUCTION_TYPES: { value: ProductionType; label: string; unit: string; icon: React.ReactNode; color: string }[] = [
  { value: "latex", label: "Latex", unit: "litres", icon: <FlaskConical className="h-4 w-4" />, color: "sky" },
  { value: "rubber_sheet", label: "Rubber Sheet", unit: "kg", icon: <Layers className="h-4 w-4" />, color: "emerald" },
  { value: "rubber_scrap", label: "Rubber Scrap", unit: "kg", icon: <Package className="h-4 w-4" />, color: "amber" },
];

function typeLabel(t: string) {
  return PRODUCTION_TYPES.find((x) => x.value === t)?.label ?? t;
}
function typeUnit(t: string) {
  return PRODUCTION_TYPES.find((x) => x.value === t)?.unit ?? "";
}

function statusBadge(status: BatchStatus) {
  if (status === "open") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Open</Badge>;
  if (status === "closed") return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-xs">Closed</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Voided</Badge>;
}

function fmt(n: number, unit: string) {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${unit}`;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProductionLog() {
  const { role, assignedProjectIds, canAccessAllProjects } = useRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  const isAdmin = role === "admin";
  const isDeveloper = role === "developer";
  const canManage = isAdmin || isDeveloper;
  const canOperate = canManage || role === "employee" || role === "operational_staff";

  // ── Filters ───────────────────────────────────────────────────────────────
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [historyFrom, setHistoryFrom] = useState<string>("");
  const [historyTo, setHistoryTo] = useState<string>("");

  const { data: projects } = useListProjects();

  const effectiveProjectId = projectFilter !== "all" ? projectFilter : undefined;

  // ── Data fetches ──────────────────────────────────────────────────────────
  const { data: todayBatches, isLoading: loadingToday } = useListProductionBatches(
    { projectId: effectiveProjectId, date: dateFilter },
  );

  const { data: allBatches, isLoading: loadingHistory } = useListProductionBatches(
    { projectId: effectiveProjectId, status: statusFilter !== "all" ? statusFilter as BatchStatus : undefined },
  );

  const { data: summary } = useGetProductionLogSummary({ projectId: effectiveProjectId });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createBatch = useCreateProductionBatch();
  const closeBatch = useCloseProductionBatch();
  const reopenBatch = useReopenProductionBatch();
  const createEntry = useCreateProductionEntry();
  const updateEntry = useUpdateProductionEntry();
  const deleteEntry = useDeleteProductionEntry();

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: getListProductionBatchesQueryKey() });
    qc.invalidateQueries({ queryKey: getListProductionEntriesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetProductionLogSummaryQueryKey() });
  }

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [newBatchForm, setNewBatchForm] = useState({ projectId: "", batchDate: format(new Date(), "yyyy-MM-dd"), notes: "" });

  const [entryDialogBatch, setEntryDialogBatch] = useState<ProductionBatch | null>(null);
  const [entryForm, setEntryForm] = useState({ productionType: "latex" as ProductionType, quantity: "", unit: "litres", productionDate: format(new Date(), "yyyy-MM-dd"), remarks: "" });
  const [editingEntry, setEditingEntry] = useState<ProductionEntry | null>(null);
  const [editForm, setEditForm] = useState({ quantity: "", unit: "", remarks: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<ProductionEntry | null>(null);

  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});

  // ── Handlers ──────────────────────────────────────────────────────────────
  function toggleBatch(id: string) {
    setExpandedBatches((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleCreateBatch() {
    if (!newBatchForm.projectId || !newBatchForm.batchDate) return;
    try {
      await createBatch.mutateAsync({ data: { projectId: newBatchForm.projectId, batchDate: newBatchForm.batchDate, notes: newBatchForm.notes || undefined } });
      toast({ title: "Batch created" });
      setNewBatchOpen(false);
      setNewBatchForm({ projectId: "", batchDate: format(new Date(), "yyyy-MM-dd"), notes: "" });
      invalidateAll();
    } catch {
      toast({ title: "Failed to create batch", variant: "destructive" });
    }
  }

  function openEntryDialog(batch: ProductionBatch) {
    setEntryDialogBatch(batch);
    setEntryForm({ productionType: "latex", quantity: "", unit: "litres", productionDate: batch.batchDate, remarks: "" });
  }

  function handleTypeChange(t: ProductionType) {
    setEntryForm((f) => ({ ...f, productionType: t, unit: typeUnit(t) }));
  }

  async function handleCreateEntry() {
    if (!entryDialogBatch || !entryForm.quantity || !entryForm.productionDate) return;
    try {
      await createEntry.mutateAsync({
        data: {
          batchId: entryDialogBatch.id,
          projectId: entryDialogBatch.projectId,
          productionType: entryForm.productionType,
          quantity: Number(entryForm.quantity),
          unit: entryForm.unit as CreateProductionEntryBodyUnit,
          productionDate: entryForm.productionDate,
          remarks: entryForm.remarks || undefined,
        },
      });
      toast({ title: "Entry recorded" });
      setEntryDialogBatch(null);
      invalidateAll();
    } catch {
      toast({ title: "Failed to record entry", variant: "destructive" });
    }
  }

  async function handleCloseBatch(batchId: string) {
    try {
      await closeBatch.mutateAsync({ id: batchId });
      toast({ title: "Batch closed" });
      invalidateAll();
    } catch {
      toast({ title: "Failed to close batch", variant: "destructive" });
    }
  }

  async function handleReopenBatch(batchId: string) {
    try {
      await reopenBatch.mutateAsync({ id: batchId });
      toast({ title: "Batch reopened" });
      invalidateAll();
    } catch {
      toast({ title: "Failed to reopen batch", variant: "destructive" });
    }
  }

  function startEdit(entry: ProductionEntry) {
    setEditingEntry(entry);
    setEditForm({ quantity: String(entry.quantity), unit: entry.unit, remarks: entry.remarks ?? "" });
  }

  async function handleSaveEdit() {
    if (!editingEntry) return;
    try {
      await updateEntry.mutateAsync({
        id: editingEntry.id,
        data: { quantity: Number(editForm.quantity), unit: (editForm.unit || undefined) as UpdateProductionEntryBodyUnit | undefined, remarks: editForm.remarks || undefined },
      });
      toast({ title: "Entry updated" });
      setEditingEntry(null);
      invalidateAll();
    } catch {
      toast({ title: "Failed to update entry", variant: "destructive" });
    }
  }

  async function handleDeleteEntry() {
    if (!deleteConfirm) return;
    try {
      await deleteEntry.mutateAsync({ id: deleteConfirm.id });
      toast({ title: "Entry removed" });
      setDeleteConfirm(null);
      invalidateAll();
    } catch {
      toast({ title: "Failed to remove entry", variant: "destructive" });
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const visibleProjects = useMemo(() => {
    if (!projects) return [];
    if (canAccessAllProjects) return projects;
    return projects.filter((p) => assignedProjectIds.includes(p.id));
  }, [projects, canAccessAllProjects, assignedProjectIds]);

  const dashChartData = useMemo(() => {
    if (!summary?.projects) return [];
    return summary.projects.map((p) => ({
      name: p.projectName ?? p.projectId.slice(0, 8),
      Latex: Number(p.totalLatexLitres.toFixed(2)),
      Sheets: Number(p.totalSheetKg.toFixed(2)),
      Scrap: Number(p.totalScrapKg.toFixed(2)),
    }));
  }, [summary]);

  // ── Render helpers ────────────────────────────────────────────────────────

  function BatchCard({ batch, showExpand = true }: { batch: ProductionBatch; showExpand?: boolean }) {
    const expanded = expandedBatches[batch.id];

    // Fetch entries when expanded
    const { data: batchEntries } = useListProductionEntries(
      { batchId: batch.id },
      { query: { enabled: !!expanded, queryKey: getListProductionEntriesQueryKey({ batchId: batch.id }) } },
    );

    return (
      <div className="border border-white/10 rounded-lg overflow-hidden bg-slate-900/60">
        {/* Batch Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
          onClick={() => showExpand && toggleBatch(batch.id)}
        >
          {showExpand && (
            <span className="text-slate-500 shrink-0">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-slate-100">{batch.batchNumber}</span>
              {statusBadge(batch.status as BatchStatus)}
              <span className="text-xs text-slate-500">{batch.projectName ?? batch.projectId.slice(0, 8)}</span>
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-400">
              <span className="flex items-center gap-1"><FlaskConical className="h-3 w-3 text-sky-400" />{fmt(batch.totalLatexLitres, "L")}</span>
              <span className="flex items-center gap-1"><Layers className="h-3 w-3 text-emerald-400" />{fmt(batch.totalSheetKg, "kg")}</span>
              <span className="flex items-center gap-1"><Package className="h-3 w-3 text-amber-400" />{fmt(batch.totalScrapKg, "kg")}</span>
              <span className="text-slate-500">{batch.entryCount} {batch.entryCount === 1 ? "entry" : "entries"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canOperate && batch.status === "open" && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                onClick={(e) => { e.stopPropagation(); openEntryDialog(batch); }}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            )}
            {canManage && batch.status === "open" && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-500/10"
                onClick={(e) => { e.stopPropagation(); handleCloseBatch(batch.id); }}>
                <Lock className="h-3 w-3 mr-1" /> Close
              </Button>
            )}
            {isAdmin && batch.status === "closed" && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-500/10"
                onClick={(e) => { e.stopPropagation(); handleReopenBatch(batch.id); }}>
                <Unlock className="h-3 w-3 mr-1" /> Reopen
              </Button>
            )}
          </div>
        </div>

        {/* Entries */}
        {expanded && (
          <div className="border-t border-white/5 bg-slate-950/40">
            {!batchEntries ? (
              <div className="px-4 py-3 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            ) : batchEntries.length === 0 ? (
              <div className="px-4 py-4 text-center text-sm text-slate-500">
                No entries yet. {batch.status === "open" && canOperate && "Add the first entry above."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-white/5">
                      <th className="text-left px-4 py-2 font-medium">Type</th>
                      <th className="text-right px-4 py-2 font-medium">Quantity</th>
                      <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Date</th>
                      <th className="text-left px-3 py-2 font-medium hidden md:table-cell">By</th>
                      <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Remarks</th>
                      {canManage && <th className="px-3 py-2 w-16" />}
                    </tr>
                  </thead>
                  <tbody>
                    {batchEntries.map((e) =>
                      editingEntry?.id === e.id ? (
                        <tr key={e.id} className="border-b border-white/5 bg-slate-800/40">
                          <td className="px-4 py-2">
                            <span className="text-xs text-slate-300">{typeLabel(e.productionType)}</span>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1 justify-end">
                              <Input
                                type="number"
                                className="h-7 w-20 text-xs text-right bg-slate-800 border-slate-600"
                                value={editForm.quantity}
                                onChange={(ev) => setEditForm((f) => ({ ...f, quantity: ev.target.value }))}
                              />
                              <span className="text-xs text-slate-400">{e.unit}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 hidden sm:table-cell">
                            <Input
                              type="date"
                              className="h-7 w-32 text-xs bg-slate-800 border-slate-600"
                              value={editForm.unit}
                              onChange={(ev) => setEditForm((f) => ({ ...f, unit: ev.target.value }))}
                            />
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-xs text-slate-400">{e.enteredByName}</td>
                          <td className="px-3 py-2 hidden lg:table-cell">
                            <Input
                              className="h-7 text-xs bg-slate-800 border-slate-600"
                              placeholder="Remarks"
                              value={editForm.remarks}
                              onChange={(ev) => setEditForm((f) => ({ ...f, remarks: ev.target.value }))}
                            />
                          </td>
                          {canManage && (
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-400" onClick={handleSaveEdit}><Check className="h-3 w-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-400" onClick={() => setEditingEntry(null)}><X className="h-3 w-3" /></Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ) : (
                        <tr key={e.id} className="border-b border-white/5 hover:bg-white/3 group">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              {e.productionType === "latex" && <FlaskConical className="h-3.5 w-3.5 text-sky-400 shrink-0" />}
                              {e.productionType === "rubber_sheet" && <Layers className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                              {e.productionType === "rubber_scrap" && <Package className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                              <span className="text-slate-200 text-xs">{typeLabel(e.productionType)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-slate-100">
                            {fmt(e.quantity, e.unit)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400 hidden sm:table-cell">
                            {e.productionDate}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400 hidden md:table-cell">{e.enteredByName}</td>
                          <td className="px-3 py-2 text-xs text-slate-500 hidden lg:table-cell">{e.remarks ?? "—"}</td>
                          {canManage && (
                            <td className="px-3 py-2">
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {batch.status === "open" && (
                                  <Button size="icon" variant="ghost" className="h-6 w-6 text-slate-400" onClick={() => startEdit(e)}><Pencil className="h-3 w-3" /></Button>
                                )}
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400" onClick={() => setDeleteConfirm(e)}><Trash2 className="h-3 w-3" /></Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {batch.closedAt && (
              <div className="px-4 py-2 text-xs text-slate-500 border-t border-white/5">
                Closed {format(parseISO(batch.closedAt), "dd MMM yyyy HH:mm")} by {batch.closedByName}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-slate-950 text-slate-100">
      {/* Page header */}
      <div className="border-b border-white/10 bg-slate-900/50 px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-white flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-emerald-400" />
              Production Log
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">Record and track latex, sheet, and scrap production</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Project filter */}
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
              <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-500 text-white shrink-0" onClick={() => setNewBatchOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> New Batch
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-b border-white/10">
        {[
          { label: "Latex", value: summary?.totalLatexLitres ?? 0, unit: "L", icon: <FlaskConical className="h-4 w-4 text-sky-400" />, color: "sky" },
          { label: "Rubber Sheet", value: summary?.totalSheetKg ?? 0, unit: "kg", icon: <Layers className="h-4 w-4 text-emerald-400" />, color: "emerald" },
          { label: "Rubber Scrap", value: summary?.totalScrapKg ?? 0, unit: "kg", icon: <Package className="h-4 w-4 text-amber-400" />, color: "amber" },
          { label: "Total Batches", value: summary?.totalBatches ?? 0, unit: "", icon: <LayoutGrid className="h-4 w-4 text-purple-400" />, color: "purple" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-slate-900/60 px-4 py-3 flex items-center gap-3">
            <div className="shrink-0 p-2 rounded-lg bg-slate-800">{kpi.icon}</div>
            <div className="min-w-0">
              <div className="text-xs text-slate-400">{kpi.label}</div>
              <div className="text-lg font-semibold text-white truncate">
                {kpi.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                {kpi.unit && <span className="text-xs text-slate-400 ml-1 font-normal">{kpi.unit}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="records" className="flex-1 flex flex-col">
        <div className="border-b border-white/10 bg-slate-900/30 px-4 sm:px-6">
          <TabsList className="bg-transparent border-0 gap-0 h-10">
            {[
              { value: "records", label: "Daily Records", icon: <ClipboardList className="h-3.5 w-3.5" /> },
              { value: "history", label: "History", icon: <History className="h-3.5 w-3.5" /> },
              { value: "dashboard", label: "Dashboard", icon: <BarChart3 className="h-3.5 w-3.5" /> },
            ].map((t) => (
              <TabsTrigger key={t.value} value={t.value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-400 data-[state=active]:text-emerald-300 data-[state=active]:bg-transparent text-slate-400 text-sm h-10 px-4 flex items-center gap-1.5">
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ── Records Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="records" className="flex-1 p-4 sm:p-6 space-y-4 mt-0">
          {/* Date picker */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-slate-400 whitespace-nowrap">Production date</Label>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-40 h-8 text-sm bg-slate-800 border-slate-600"
              />
            </div>
            {dateFilter !== format(new Date(), "yyyy-MM-dd") && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-400" onClick={() => setDateFilter(format(new Date(), "yyyy-MM-dd"))}>
                Today
              </Button>
            )}
          </div>

          {loadingToday ? (
            <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
          ) : !todayBatches?.length ? (
            <div className="text-center py-16 text-slate-500">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <div className="text-base font-medium text-slate-400">No batches for {dateFilter === format(new Date(), "yyyy-MM-dd") ? "today" : dateFilter}</div>
              {canOperate && (
                <Button size="sm" className="mt-4 bg-emerald-600 hover:bg-emerald-500" onClick={() => { setNewBatchForm((f) => ({ ...f, batchDate: dateFilter })); setNewBatchOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" /> Create Batch
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {todayBatches.map((b) => <BatchCard key={b.id} batch={b} />)}
            </div>
          )}
        </TabsContent>

        {/* ── History Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="history" className="flex-1 p-4 sm:p-6 space-y-4 mt-0">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 h-8 text-sm bg-slate-800 border-slate-600">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="voided">Voided</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loadingHistory ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
          ) : !allBatches?.length ? (
            <div className="text-center py-16 text-slate-500">
              <History className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <div className="text-base font-medium text-slate-400">No production batches found</div>
            </div>
          ) : (
            <div className="space-y-2">
              {allBatches.map((b) => <BatchCard key={b.id} batch={b} />)}
            </div>
          )}
        </TabsContent>

        {/* ── Dashboard Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="dashboard" className="flex-1 p-4 sm:p-6 space-y-6 mt-0">
          {/* Per-project breakdown cards */}
          {!summary?.projects?.length ? (
            <div className="text-center py-16 text-slate-500">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <div className="text-base font-medium text-slate-400">No production data yet</div>
            </div>
          ) : (
            <>
              {/* Chart */}
              {dashChartData.length > 0 && (
                <Card className="bg-slate-900/60 border-white/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-300">Production by Project</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={dashChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Latex" fill="#38bdf8" name="Latex (L)" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="Sheets" fill="#34d399" name="Sheets (kg)" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="Scrap" fill="#fbbf24" name="Scrap (kg)" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Project breakdown table */}
              <Card className="bg-slate-900/60 border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-300">Project-wise Summary</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/5 hover:bg-transparent">
                          <TableHead className="text-slate-400 text-xs">Project</TableHead>
                          <TableHead className="text-right text-slate-400 text-xs"><FlaskConical className="h-3 w-3 inline mr-1 text-sky-400" />Latex (L)</TableHead>
                          <TableHead className="text-right text-slate-400 text-xs"><Layers className="h-3 w-3 inline mr-1 text-emerald-400" />Sheets (kg)</TableHead>
                          <TableHead className="text-right text-slate-400 text-xs"><Package className="h-3 w-3 inline mr-1 text-amber-400" />Scrap (kg)</TableHead>
                          <TableHead className="text-right text-slate-400 text-xs hidden sm:table-cell">Batches</TableHead>
                          <TableHead className="text-right text-slate-400 text-xs hidden md:table-cell">Entries</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {summary.projects.map((p) => (
                          <TableRow key={p.projectId} className="border-white/5 hover:bg-white/3">
                            <TableCell className="text-sm text-slate-200 font-medium">{p.projectName ?? p.projectId.slice(0, 8)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-sky-300">{p.totalLatexLitres.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-emerald-300">{p.totalSheetKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-amber-300">{p.totalScrapKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</TableCell>
                            <TableCell className="text-right text-sm text-slate-400 hidden sm:table-cell">{p.batchCount}</TableCell>
                            <TableCell className="text-right text-sm text-slate-400 hidden md:table-cell">{p.totalEntries}</TableCell>
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
      </Tabs>

      {/* ── New Batch Dialog ─────────────────────────────────────────────── */}
      <Dialog open={newBatchOpen} onOpenChange={setNewBatchOpen}>
        <DialogContent className="bg-slate-900 border-white/10 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">New Production Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Project <span className="text-red-400">*</span></Label>
              <Select value={newBatchForm.projectId} onValueChange={(v) => setNewBatchForm((f) => ({ ...f, projectId: v }))}>
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
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Production Date <span className="text-red-400">*</span></Label>
              <Input
                type="date"
                className="bg-slate-800 border-slate-600 text-slate-100"
                value={newBatchForm.batchDate}
                onChange={(e) => setNewBatchForm((f) => ({ ...f, batchDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-300">Notes</Label>
              <Textarea
                className="bg-slate-800 border-slate-600 text-slate-100 resize-none"
                placeholder="Optional batch notes…"
                rows={2}
                value={newBatchForm.notes}
                onChange={(e) => setNewBatchForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <p className="text-xs text-slate-500">A batch number (e.g. BATCH-20240513-001) will be auto-generated.</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="text-slate-400">Cancel</Button>
            </DialogClose>
            <Button
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              disabled={!newBatchForm.projectId || !newBatchForm.batchDate || createBatch.isPending}
              onClick={handleCreateBatch}
            >
              {createBatch.isPending ? "Creating…" : "Create Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Entry Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!entryDialogBatch} onOpenChange={(open) => !open && setEntryDialogBatch(null)}>
        <DialogContent className="bg-slate-900 border-white/10 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Record Production Entry</DialogTitle>
          </DialogHeader>
          {entryDialogBatch && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-800/50 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-400">Batch: </span>
                <span className="font-mono text-slate-100">{entryDialogBatch.batchNumber}</span>
                <span className="text-slate-500 ml-2">· {entryDialogBatch.projectName}</span>
              </div>

              {/* Production type — large buttons for mobile */}
              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Production Type <span className="text-red-400">*</span></Label>
                <div className="grid grid-cols-3 gap-2">
                  {PRODUCTION_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => handleTypeChange(t.value)}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border text-xs font-medium transition-all ${
                        entryForm.productionType === t.value
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      {t.icon}
                      <span>{t.label}</span>
                      <span className="text-slate-500 font-normal">{t.unit}</span>
                    </button>
                  ))}
                </div>
              </div>

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
                      value={entryForm.quantity}
                      onChange={(e) => setEntryForm((f) => ({ ...f, quantity: e.target.value }))}
                    />
                    <div className="flex items-center px-3 bg-slate-700 border border-l-0 border-slate-600 rounded-r-md text-sm text-slate-300 font-medium">
                      {entryForm.unit}
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-slate-300">Date <span className="text-red-400">*</span></Label>
                  <Input
                    type="date"
                    className="bg-slate-800 border-slate-600 text-slate-100 h-12"
                    value={entryForm.productionDate}
                    onChange={(e) => setEntryForm((f) => ({ ...f, productionDate: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm text-slate-300">Remarks</Label>
                <Textarea
                  className="bg-slate-800 border-slate-600 text-slate-100 resize-none"
                  placeholder="Field condition, weather, batch notes…"
                  rows={2}
                  value={entryForm.remarks}
                  onChange={(e) => setEntryForm((f) => ({ ...f, remarks: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" className="text-slate-400">Cancel</Button>
            </DialogClose>
            <Button
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              disabled={!entryForm.quantity || !entryForm.productionDate || createEntry.isPending}
              onClick={handleCreateEntry}
            >
              {createEntry.isPending ? "Saving…" : "Save Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent className="bg-slate-900 border-white/10 text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove Entry?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This will soft-delete the {deleteConfirm && typeLabel(deleteConfirm.productionType)} entry of{" "}
              {deleteConfirm && fmt(deleteConfirm.quantity, deleteConfirm.unit)}.
              The batch totals will be updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-500 text-white" onClick={handleDeleteEntry}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
