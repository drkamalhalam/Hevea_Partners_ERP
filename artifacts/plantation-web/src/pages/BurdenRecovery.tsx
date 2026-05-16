import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useGetBurdenRecoverySummary,
  useListBurdenRecoveryAdjustments,
  useCreateBurdenRecoveryAdjustment,
  useUpdateBurdenRecoveryAdjustment,
  useRecordBurdenRecoveryEvent,
  useListBurdenRecoveryEvents,
  useListProjects,
  useListPartners,
  getGetBurdenRecoverySummaryQueryKey,
  getListBurdenRecoveryAdjustmentsQueryKey,
  getListBurdenRecoveryEventsQueryKey,
} from "@workspace/api-client-react";
import type {
  BurdenRecoveryAdjustment,
  BurdenRecoveryEvent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ShieldAlert,
  Scale,
  Plus,
  Pencil,
  ArrowDownCircle,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  History,
  IndianRupee,
  UserX,
  RefreshCw,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(recovered: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.round((recovered / total) * 100))}%`;
}

// ── Status helpers ────────────────────────────────────────────────────────────

type RecoveryStatus = "pending" | "partial" | "recovered" | "waived";

function statusInfo(status: string): {
  label: string;
  cls: string;
  icon: React.ElementType;
} {
  const map: Record<RecoveryStatus, { label: string; cls: string; icon: React.ElementType }> = {
    pending: { label: "Pending", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: Clock },
    partial: { label: "Partial", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: RefreshCw },
    recovered: { label: "Recovered", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
    waived: { label: "Waived", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", icon: XCircle },
  };
  return map[status as RecoveryStatus] ?? map.pending;
}

function progressBar(recovered: number, total: number) {
  const pct = total > 0 ? Math.min(100, (recovered / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-blue-500" : "bg-zinc-600",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-zinc-500 shrink-0">{fmtPct(recovered, total)}</span>
    </div>
  );
}

// ── Empty form state ──────────────────────────────────────────────────────────

const EMPTY_ADJ = {
  projectId: "",
  sourcePartnerId: "",
  targetPartnerId: "",
  description: "",
  costCategory: "",
  totalAmount: "",
  recoverableAmount: "",
  periodLabel: "",
  periodStart: "",
  periodEnd: "",
  notes: "",
};

const EMPTY_EVENT = {
  amountRecovered: "",
  recoveryDate: new Date().toISOString().slice(0, 10),
  recoveryRef: "",
  notes: "",
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function BurdenRecovery() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [filterProjectId, setFilterProjectId] = useState("");
  const [filterStatus, setFilterStatus] = useState("active"); // active = pending+partial
  const [activeTab, setActiveTab] = useState("pending");

  const [addDialog, setAddDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<BurdenRecoveryAdjustment | null>(null);
  const [adjForm, setAdjForm] = useState({ ...EMPTY_ADJ });

  const [recordTarget, setRecordTarget] = useState<BurdenRecoveryAdjustment | null>(null);
  const [eventForm, setEventForm] = useState({ ...EMPTY_EVENT });

  const [waivedTarget, setWaivedTarget] = useState<BurdenRecoveryAdjustment | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Queries
  const { data: projects = [] } = useListProjects({});
  const summaryQuery = useGetBurdenRecoverySummary(
    { projectId: filterProjectId || undefined },
    {
      query: {
        queryKey: getGetBurdenRecoverySummaryQueryKey({
          projectId: filterProjectId || undefined,
        }),
      },
    },
  );
  const summary = summaryQuery.data;

  const adjQuery = useListBurdenRecoveryAdjustments(
    { projectId: filterProjectId || undefined },
    {
      query: {
        queryKey: getListBurdenRecoveryAdjustmentsQueryKey({
          projectId: filterProjectId || undefined,
        }),
      },
    },
  );
  const allAdjustments = adjQuery.data ?? [];

  // Mutations
  const createAdj = useCreateBurdenRecoveryAdjustment();
  const updateAdj = useUpdateBurdenRecoveryAdjustment();
  const recordEvent = useRecordBurdenRecoveryEvent();

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["getBurdenRecoverySummary"] });
    qc.invalidateQueries({ queryKey: ["listBurdenRecoveryAdjustments"] });
  }

  // Tab-filtered adjustments
  const tabAdjs = useMemo(() => {
    if (activeTab === "pending") return allAdjustments.filter((a) => a.recoveryStatus === "pending");
    if (activeTab === "partial") return allAdjustments.filter((a) => a.recoveryStatus === "partial");
    if (activeTab === "recovered") return allAdjustments.filter((a) => a.recoveryStatus === "recovered");
    if (activeTab === "waived") return allAdjustments.filter((a) => a.recoveryStatus === "waived");
    return allAdjustments;
  }, [allAdjustments, activeTab]);

  // Pending alerts (top-of-page)
  const pendingAlerts = allAdjustments.filter(
    (a) => a.recoveryStatus === "pending" || a.recoveryStatus === "partial",
  );

  // Form helpers
  function openAdd() {
    setAdjForm({ ...EMPTY_ADJ });
    setAddDialog(true);
  }

  function openEdit(adj: BurdenRecoveryAdjustment) {
    setAdjForm({
      projectId: adj.projectId,
      sourcePartnerId: adj.sourcePartnerId,
      targetPartnerId: adj.targetPartnerId,
      description: adj.description,
      costCategory: adj.costCategory ?? "",
      totalAmount: String(adj.totalAmount),
      recoverableAmount: String(adj.recoverableAmount),
      periodLabel: adj.periodLabel,
      periodStart: adj.periodStart,
      periodEnd: adj.periodEnd,
      notes: adj.notes ?? "",
    });
    setEditTarget(adj);
  }

  function openRecord(adj: BurdenRecoveryAdjustment) {
    setEventForm({
      ...EMPTY_EVENT,
      amountRecovered: String(Math.max(0, adj.recoverableAmount - adj.recoveredAmount)),
    });
    setRecordTarget(adj);
  }

  async function handleCreate() {
    const total = parseFloat(adjForm.totalAmount);
    const recoverable = parseFloat(adjForm.recoverableAmount);
    if (isNaN(total) || isNaN(recoverable)) return;
    try {
      await createAdj.mutateAsync({
        data: {
          projectId: adjForm.projectId,
          sourcePartnerId: adjForm.sourcePartnerId,
          targetPartnerId: adjForm.targetPartnerId,
          description: adjForm.description,
          costCategory: adjForm.costCategory || undefined,
          totalAmount: total,
          recoverableAmount: recoverable,
          periodLabel: adjForm.periodLabel,
          periodStart: adjForm.periodStart,
          periodEnd: adjForm.periodEnd,
          notes: adjForm.notes || undefined,
        },
      });
      setAddDialog(false);
      invalidateAll();
    } catch {}
  }

  async function handleUpdate() {
    if (!editTarget) return;
    const total = parseFloat(adjForm.totalAmount);
    const recoverable = parseFloat(adjForm.recoverableAmount);
    try {
      await updateAdj.mutateAsync({
        id: editTarget.id,
        data: {
          description: adjForm.description,
          costCategory: adjForm.costCategory || undefined,
          totalAmount: !isNaN(total) ? total : undefined,
          recoverableAmount: !isNaN(recoverable) ? recoverable : undefined,
          periodLabel: adjForm.periodLabel,
          periodStart: adjForm.periodStart,
          periodEnd: adjForm.periodEnd,
          notes: adjForm.notes || undefined,
        },
      });
      setEditTarget(null);
      invalidateAll();
    } catch {}
  }

  async function handleWaive() {
    if (!waivedTarget) return;
    await updateAdj.mutateAsync({
      id: waivedTarget.id,
      data: { recoveryStatus: "waived" },
    });
    setWaivedTarget(null);
    invalidateAll();
  }

  async function handleRecordEvent() {
    if (!recordTarget) return;
    const amt = parseFloat(eventForm.amountRecovered);
    if (isNaN(amt) || amt <= 0) return;
    try {
      await recordEvent.mutateAsync({
        id: recordTarget.id,
        data: {
          amountRecovered: amt,
          recoveryDate: eventForm.recoveryDate,
          recoveryRef: eventForm.recoveryRef || undefined,
          notes: eventForm.notes || undefined,
        },
      });
      setRecordTarget(null);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["listBurdenRecoveryEvents"] });
    } catch {}
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Scale className="w-6 h-6 text-orange-400" />
            Burden Recovery Adjustments
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Operational costs temporarily paid by a non-landowner participant in the 50% revenue model.
            Recovery is deducted from the landowner&apos;s share.{" "}
            <span className="text-amber-400 font-medium">No ownership rights are created.</span>
          </p>
        </div>
        {isAdminOrDev && (
          <Button
            className="bg-orange-500 hover:bg-orange-400 text-white font-semibold"
            onClick={openAdd}
          >
            <Plus className="w-4 h-4 mr-1" />
            New Adjustment
          </Button>
        )}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-zinc-400 text-sm shrink-0">Project:</Label>
          <Select value={filterProjectId || "__all__"} onValueChange={(v) => setFilterProjectId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-56 bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="__all__" className="text-zinc-200">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Pending Alerts ─────────────────────────────────────────────── */}
      {pendingAlerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <AlertCircle className="w-4 h-4" />
            {pendingAlerts.length} adjustment{pendingAlerts.length > 1 ? "s" : ""} pending recovery
          </div>
          {pendingAlerts.slice(0, 3).map((adj) => (
            <AlertCard key={adj.id} adj={adj} isAdminOrDev={isAdminOrDev} onRecord={openRecord} />
          ))}
          {pendingAlerts.length > 3 && (
            <p className="text-xs text-zinc-600 pl-1">
              +{pendingAlerts.length - 3} more — see &ldquo;Pending&rdquo; tab below
            </p>
          )}
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total Recoverable"
          value={summary ? fmt(summary.totalRecoverable) : "—"}
          sub="All active adjustments"
          color="orange"
          icon={<IndianRupee className="w-4 h-4" />}
        />
        <KpiCard
          label="Total Recovered"
          value={summary ? fmt(summary.totalRecovered) : "—"}
          sub="Deducted from landowner share"
          color="emerald"
          icon={<CheckCircle2 className="w-4 h-4" />}
        />
        <KpiCard
          label="Outstanding Remaining"
          value={summary ? fmt(summary.totalRemaining) : "—"}
          sub={`${(summary?.pendingCount ?? 0) + (summary?.partialCount ?? 0)} open adjustments`}
          color={(summary?.totalRemaining ?? 0) > 0 ? "amber" : "zinc"}
          icon={<Clock className="w-4 h-4" />}
        />
        <KpiCard
          label="Ownership Transfer"
          value="None"
          sub="Invariant enforced — always zero"
          color="zinc"
          icon={<UserX className="w-4 h-4" />}
        />
      </div>

      {/* ── Ownership Firewall Notice ───────────────────────────────────── */}
      <div className="flex items-start gap-3 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-4 py-3">
        <ShieldAlert className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-zinc-400">
          <strong className="text-zinc-300">Ownership Firewall:</strong>{" "}
          Recording a burden recovery adjustment, or settling it, does not constitute an investment,
          loan, or contribution. It creates no equity, ownership share, or claim on project assets.
          The <code className="bg-zinc-700 px-1 rounded text-blue-300">is_ownership_creating</code> flag
          is permanently set to <code className="bg-zinc-700 px-1 rounded text-emerald-300">false</code> and
          cannot be overridden.
        </p>
      </div>

      {/* ── Adjustments Table (tabbed) ──────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-800 border border-zinc-700">
          <TabsTrigger value="pending" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Pending ({summary?.pendingCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="partial" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Partial ({summary?.partialCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="recovered" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Recovered ({summary?.recoveredCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="waived" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Waived ({summary?.waivedCount ?? 0})
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            All ({allAdjustments.length})
          </TabsTrigger>
        </TabsList>

        {["pending", "partial", "recovered", "waived", "all"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <AdjustmentsTable
              adjustments={activeTab === tab ? tabAdjs : []}
              isAdminOrDev={isAdminOrDev}
              isAdmin={isAdmin}
              onEdit={openEdit}
              onRecord={openRecord}
              onWaive={setWaivedTarget}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* ── Add Adjustment Dialog ───────────────────────────────────────── */}
      <AdjFormDialog
        open={addDialog}
        onClose={() => setAddDialog(false)}
        title="New Burden Recovery Adjustment"
        form={adjForm}
        setForm={setAdjForm}
        projects={projects}
        onSubmit={handleCreate}
        isPending={createAdj.isPending}
        submitLabel="Create Adjustment"
        showProjectPartner
      />

      {/* ── Edit Adjustment Dialog ──────────────────────────────────────── */}
      <AdjFormDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Adjustment — ${editTarget?.periodLabel ?? ""}`}
        form={adjForm}
        setForm={setAdjForm}
        projects={projects}
        onSubmit={handleUpdate}
        isPending={updateAdj.isPending}
        submitLabel="Save Changes"
        showProjectPartner={false}
      />

      {/* ── Record Recovery Dialog ──────────────────────────────────────── */}
      <Dialog open={!!recordTarget} onOpenChange={(o) => !o && setRecordTarget(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Record Recovery</DialogTitle>
          </DialogHeader>
          {recordTarget && (
            <div className="space-y-4 py-2">
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 space-y-1">
                <div className="text-xs text-zinc-500">Adjustment</div>
                <div className="text-zinc-200 text-sm">{recordTarget.description}</div>
                <div className="text-xs text-zinc-500 mt-1">
                  Payer: <span className="text-zinc-300">{recordTarget.sourcePartnerName}</span>
                  {" · "}Landowner: <span className="text-zinc-300">{recordTarget.targetPartnerName}</span>
                </div>
                <div className="flex justify-between text-xs pt-1">
                  <span className="text-zinc-500">Recoverable: <span className="text-white">{fmt(recordTarget.recoverableAmount)}</span></span>
                  <span className="text-zinc-500">Recovered: <span className="text-emerald-400">{fmt(recordTarget.recoveredAmount)}</span></span>
                  <span className="text-zinc-500">Remaining: <span className="text-amber-400">{fmt(recordTarget.remainingAmount ?? 0)}</span></span>
                </div>
                {progressBar(recordTarget.recoveredAmount, recordTarget.recoverableAmount)}
              </div>

              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Amount to Recover (₹)</Label>
                <Input
                  type="number"
                  min={0.01}
                  step={100}
                  value={eventForm.amountRecovered}
                  onChange={(e) => setEventForm((f) => ({ ...f, amountRecovered: e.target.value }))}
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
                <p className="text-xs text-zinc-600">
                  Cannot exceed remaining: {fmt(recordTarget.remainingAmount ?? 0)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Recovery Date</Label>
                <Input
                  type="date"
                  value={eventForm.recoveryDate}
                  onChange={(e) => setEventForm((f) => ({ ...f, recoveryDate: e.target.value }))}
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Reference (optional)</Label>
                <Input
                  value={eventForm.recoveryRef}
                  onChange={(e) => setEventForm((f) => ({ ...f, recoveryRef: e.target.value }))}
                  placeholder="Invoice no., cheque no., ledger ref…"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Notes (optional)</Label>
                <Input
                  value={eventForm.notes}
                  onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" className="text-zinc-400" onClick={() => setRecordTarget(null)}>Cancel</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-400 text-white font-semibold"
              onClick={handleRecordEvent}
              disabled={recordEvent.isPending}
            >
              {recordEvent.isPending ? "Recording…" : "Record Recovery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Waive Confirm ──────────────────────────────────────────────── */}
      <AlertDialog open={!!waivedTarget} onOpenChange={(o) => !o && setWaivedTarget(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Waive Recovery?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Mark this adjustment as <strong>Waived</strong> — the payer voluntarily forgoes recovery.
              This does not create any ownership right or claim. The adjustment will remain visible in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 text-zinc-300 border-zinc-600">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-zinc-600 hover:bg-zinc-500 text-white"
              onClick={handleWaive}
            >
              Waive Recovery
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Pending Alert Card ────────────────────────────────────────────────────────

function AlertCard({
  adj,
  isAdminOrDev,
  onRecord,
}: {
  adj: BurdenRecoveryAdjustment;
  isAdminOrDev: boolean;
  onRecord: (a: BurdenRecoveryAdjustment) => void;
}) {
  const si = statusInfo(adj.recoveryStatus);
  const SIcon = si.icon;
  return (
    <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
      <SIcon className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-zinc-200 text-sm font-medium truncate">{adj.description}</span>
          {adj.costCategory && (
            <span className="text-xs text-zinc-600 shrink-0">[{adj.costCategory}]</span>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-0.5">
          Payer: <span className="text-zinc-300">{adj.sourcePartnerName}</span>
          {" · "}Landowner: <span className="text-zinc-300">{adj.targetPartnerName}</span>
          {" · "}{adj.projectName}
          {" · "}{adj.periodLabel}
        </div>
        <div className="flex items-center gap-4 mt-1.5">
          <div className="text-xs text-zinc-500">
            Remaining: <span className="text-amber-400 font-medium">{fmt(adj.remainingAmount ?? 0)}</span>
            <span className="text-zinc-700"> / {fmt(adj.recoverableAmount)}</span>
          </div>
          <div className="flex-1">{progressBar(adj.recoveredAmount, adj.recoverableAmount)}</div>
        </div>
      </div>
      {isAdminOrDev && adj.recoveryStatus !== "recovered" && adj.recoveryStatus !== "waived" && (
        <Button
          size="sm"
          className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 h-7 px-3 text-xs shrink-0"
          onClick={() => onRecord(adj)}
        >
          <ArrowDownCircle className="w-3 h-3 mr-1" />
          Record
        </Button>
      )}
    </div>
  );
}

// ── Adjustments Table ─────────────────────────────────────────────────────────

function AdjustmentsTable({
  adjustments,
  isAdminOrDev,
  isAdmin,
  onEdit,
  onRecord,
  onWaive,
  expandedIds,
  onToggleExpand,
}: {
  adjustments: BurdenRecoveryAdjustment[];
  isAdminOrDev: boolean;
  isAdmin: boolean;
  onEdit: (a: BurdenRecoveryAdjustment) => void;
  onRecord: (a: BurdenRecoveryAdjustment) => void;
  onWaive: (a: BurdenRecoveryAdjustment) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  if (adjustments.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-zinc-600 mt-2">
        <Scale className="w-8 h-8 mb-2" />
        <p className="text-sm">No adjustments in this category.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-2">
      {adjustments.map((adj) => (
        <AdjRow
          key={adj.id}
          adj={adj}
          isAdminOrDev={isAdminOrDev}
          isAdmin={isAdmin}
          onEdit={onEdit}
          onRecord={onRecord}
          onWaive={onWaive}
          expanded={expandedIds.has(adj.id)}
          onToggle={() => onToggleExpand(adj.id)}
        />
      ))}
    </div>
  );
}

function AdjRow({
  adj,
  isAdminOrDev,
  isAdmin,
  onEdit,
  onRecord,
  onWaive,
  expanded,
  onToggle,
}: {
  adj: BurdenRecoveryAdjustment;
  isAdminOrDev: boolean;
  isAdmin: boolean;
  onEdit: (a: BurdenRecoveryAdjustment) => void;
  onRecord: (a: BurdenRecoveryAdjustment) => void;
  onWaive: (a: BurdenRecoveryAdjustment) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const si = statusInfo(adj.recoveryStatus);
  const SIcon = si.icon;
  const isOpen = adj.recoveryStatus === "pending" || adj.recoveryStatus === "partial";

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <div className={cn(
        "rounded-lg border transition-colors",
        isOpen ? "border-amber-500/20 bg-amber-500/5" : "border-zinc-700/60 bg-zinc-800/30",
      )}>
        {/* Row summary */}
        <div className="flex items-start gap-3 px-4 py-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300 mt-0.5 shrink-0">
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200 text-sm font-medium">{adj.description}</span>
                  {adj.costCategory && (
                    <Badge variant="outline" className="text-xs bg-zinc-700/50 text-zinc-400 border-zinc-600">
                      {adj.costCategory}
                    </Badge>
                  )}
                  <Badge variant="outline" className={cn("text-xs", si.cls)}>
                    <SIcon className="w-3 h-3 mr-1" />
                    {si.label}
                  </Badge>
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  <span className="text-zinc-400">{adj.projectName}</span>
                  {" · "}{adj.periodLabel}
                  {" · "}Payer: <span className="text-zinc-300">{adj.sourcePartnerName}</span>
                  {" → "}Landowner: <span className="text-zinc-300">{adj.targetPartnerName}</span>
                </div>
              </div>

              {/* Amounts column */}
              <div className="text-right shrink-0">
                <div className="text-white font-semibold">{fmt(adj.recoverableAmount)}</div>
                <div className="text-xs text-zinc-500">
                  <span className="text-emerald-400">{fmt(adj.recoveredAmount)}</span> recovered
                  {(adj.remainingAmount ?? 0) > 0 && (
                    <> · <span className="text-amber-400">{fmt(adj.remainingAmount ?? 0)}</span> left</>
                  )}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-2">{progressBar(adj.recoveredAmount, adj.recoverableAmount)}</div>

            {/* Action buttons */}
            {isAdminOrDev && (
              <div className="flex items-center gap-2 mt-2">
                {isOpen && (
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30"
                    onClick={() => onRecord(adj)}
                  >
                    <ArrowDownCircle className="w-3 h-3 mr-1" />
                    Record Recovery
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-zinc-400 hover:text-zinc-300"
                  onClick={() => onEdit(adj)}
                >
                  <Pencil className="w-3 h-3" />
                </Button>
                {isAdmin && isOpen && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-zinc-500 hover:text-zinc-400"
                    onClick={() => onWaive(adj)}
                  >
                    <XCircle className="w-3 h-3 mr-1" />
                    Waive
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expanded: event history */}
        <CollapsibleContent>
          <div className="px-4 pb-3 border-t border-zinc-700/40">
            <EventHistory adjustmentId={adj.id} />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Event History (inline) ────────────────────────────────────────────────────

function EventHistory({ adjustmentId }: { adjustmentId: string }) {
  const eventsQuery = useListBurdenRecoveryEvents(adjustmentId, {
    query: {
      queryKey: getListBurdenRecoveryEventsQueryKey(adjustmentId),
    },
  });
  const events = eventsQuery.data ?? [];

  if (eventsQuery.isLoading) {
    return <div className="py-3 text-xs text-zinc-600">Loading events…</div>;
  }

  if (events.length === 0) {
    return (
      <div className="py-3 text-xs text-zinc-600 flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" />
        No recovery events recorded yet.
      </div>
    );
  }

  return (
    <div className="pt-3 space-y-2">
      <div className="text-xs text-zinc-500 font-medium flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" />
        Recovery Events
      </div>
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-700/50 hover:bg-transparent">
            <TableHead className="text-zinc-600 text-xs h-7">Date</TableHead>
            <TableHead className="text-zinc-600 text-xs h-7 text-right">Amount</TableHead>
            <TableHead className="text-zinc-600 text-xs h-7">Reference</TableHead>
            <TableHead className="text-zinc-600 text-xs h-7">Recorded by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((ev) => (
            <TableRow key={ev.id} className="border-zinc-700/30 hover:bg-zinc-800/30">
              <TableCell className="text-zinc-400 text-xs py-1.5">{ev.recoveryDate}</TableCell>
              <TableCell className="text-emerald-400 text-xs py-1.5 text-right font-medium">
                {fmt(ev.amountRecovered)}
              </TableCell>
              <TableCell className="text-zinc-500 text-xs py-1.5">{ev.recoveryRef ?? "—"}</TableCell>
              <TableCell className="text-zinc-500 text-xs py-1.5">{ev.recordedByName}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Adjustment Form Dialog ────────────────────────────────────────────────────

function AdjFormDialog({
  open,
  onClose,
  title,
  form,
  setForm,
  projects,
  onSubmit,
  isPending,
  submitLabel,
  showProjectPartner,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  form: typeof EMPTY_ADJ;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_ADJ>>;
  projects: { id: string; name: string }[];
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
  showProjectPartner: boolean;
}) {
  // Self-fetch project-scoped partner list
  const { data: scopedPartnersData } = useListPartners(
    form.projectId ? { projectId: form.projectId } : undefined,
  );
  const allPartners: { id: string; name: string; role: string }[] =
    (scopedPartnersData as any)?.partners ?? (Array.isArray(scopedPartnersData) ? scopedPartnersData : []);
  const landowners = allPartners.filter((p) => p.role === "landowner");
  const totalAmt = parseFloat(form.totalAmount);
  const recAmt = parseFloat(form.recoverableAmount);
  const splitNotice =
    !isNaN(totalAmt) && !isNaN(recAmt) && recAmt < totalAmt
      ? `${fmt(totalAmt - recAmt)} absorbed by payer / other parties`
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-700 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">

          {/* Ownership firewall notice */}
          <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-zinc-400">
              This adjustment records a cost recovery only. It <strong className="text-zinc-300">does not create ownership rights</strong> for the payer.
            </p>
          </div>

          {showProjectPartner && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Project</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-zinc-300 text-sm">Original Payer</Label>
                  <Select value={form.sourcePartnerId} onValueChange={(v) => setForm((f) => ({ ...f, sourcePartnerId: v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                      <SelectValue placeholder="Participant who paid" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {allPartners.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                          {p.name} ({p.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-zinc-600">The participant who temporarily paid</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-300 text-sm">Landowner (Payer)</Label>
                  <Select value={form.targetPartnerId} onValueChange={(v) => setForm((f) => ({ ...f, targetPartnerId: v }))}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                      <SelectValue placeholder="Landowner to deduct from" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      {landowners.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-zinc-600">Deducted from their 50% share</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Tapping labour advance — March 2025"
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Cost Category (optional)</Label>
            <Input
              value={form.costCategory}
              onChange={(e) => setForm((f) => ({ ...f, costCategory: e.target.value }))}
              placeholder="e.g. tapping labour, fertiliser, transport"
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Total Cost Paid (₹)</Label>
              <Input
                type="number"
                min={0.01}
                step={1000}
                value={form.totalAmount}
                onChange={(e) => setForm((f) => ({ ...f, totalAmount: e.target.value }))}
                placeholder="Full amount paid by payer"
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Recoverable from Landowner (₹)</Label>
              <Input
                type="number"
                min={0.01}
                step={1000}
                value={form.recoverableAmount}
                onChange={(e) => setForm((f) => ({ ...f, recoverableAmount: e.target.value }))}
                placeholder="Portion charged to this landowner"
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
              {splitNotice && (
                <p className="text-xs text-blue-400">{splitNotice}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Period Label</Label>
            <Input
              value={form.periodLabel}
              onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))}
              placeholder='e.g. "FY 2024-25 Q1"'
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Period Start</Label>
              <Input
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Period End</Label>
              <Input
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Notes (optional)</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-zinc-400" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-orange-500 hover:bg-orange-400 text-white font-semibold"
            onClick={onSubmit}
            disabled={isPending}
          >
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }: {
  label: string;
  value: string;
  sub?: string;
  color: "orange" | "emerald" | "amber" | "zinc";
  icon: React.ReactNode;
}) {
  const colorMap = {
    orange: "text-orange-400",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    zinc: "text-zinc-500",
  };
  return (
    <Card className="bg-zinc-800/50 border-zinc-700">
      <CardContent className="p-3">
        <div className={cn("flex items-center gap-1.5 mb-1 text-xs", colorMap[color])}>
          {icon}{label}
        </div>
        <div className="font-bold text-white text-base">{value}</div>
        {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
