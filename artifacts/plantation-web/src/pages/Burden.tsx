import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBurdenSummary,
  useListBurdenRules,
  useCreateBurdenRule,
  useUpdateBurdenRule,
  useListBurdenRecords,
  useCreateBurdenRecord,
  useWaiveBurdenRecord,
  useMarkBurdenRecordRecovered,
  useListExpenditures,
  useListProjects,
  useGetImbalanceSummary,
  useListImbalanceLedger,
  useGetImbalancePartnerSummary,
  useCreateImbalanceEntry,
  useSeedImbalanceLedger,
  getGetBurdenSummaryQueryKey,
  getListBurdenRulesQueryKey,
  getListBurdenRecordsQueryKey,
} from "@workspace/api-client-react";
import type {
  BurdenRule,
  BurdenRecord,
  Project,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Pencil,
  X,
  ChevronDown,
  ChevronUp,
  Scale,
  HandCoins,
  RefreshCw,
  Wallet,
  Users,
  List,
  Minus,
  Layers,
  Loader2,
  Download,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const BEARER_LABELS: Record<string, string> = {
  developer: "Developer",
  landowner: "Landowner",
  shared: "Shared",
  proportional: "Proportional",
};

const ADJUSTMENT_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  balanced: { label: "Balanced", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  developer_advance: { label: "Developer Advance", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: TrendingUp },
  landowner_advance: { label: "Landowner Advance", color: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: TrendingDown },
  waived: { label: "Waived", color: "bg-slate-500/15 text-slate-400 border-slate-500/30", icon: X },
};

const RECOVERY_CONFIG: Record<string, { label: string; color: string }> = {
  none: { label: "N/A", color: "text-slate-500" },
  pending: { label: "Pending", color: "text-amber-400" },
  in_recovery: { label: "In Recovery", color: "text-blue-400" },
  recovered: { label: "Recovered", color: "text-emerald-400" },
  waived: { label: "Waived", color: "text-slate-400" },
};

function AdjustmentBadge({ status }: { status: string }) {
  const cfg = ADJUSTMENT_CONFIG[status] ?? ADJUSTMENT_CONFIG.balanced;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function RecoveryBadge({ status }: { status: string }) {
  const cfg = RECOVERY_CONFIG[status] ?? RECOVERY_CONFIG.none;
  return <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>;
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 mb-1">{title}</p>
            <p className="text-xl font-bold text-white truncate">{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg ${color} flex-shrink-0 ml-3`}>
            <Icon size={18} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Summary Tab ───────────────────────────────────────────────────────────────

function SummaryTab({ projectId }: { projectId: string | null }) {
  const params = projectId ? { projectId } : undefined;
  const { data, isLoading } = useGetBurdenSummary(params);

  if (isLoading)
    return <p className="text-slate-400 text-sm py-8 text-center">Loading…</p>;
  if (!data)
    return (
      <p className="text-slate-500 text-sm py-8 text-center">No data available.</p>
    );

  const t = data.totals;

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="Developer Advance"
          value={formatINR(t.developerAdvanceAmount)}
          sub="developer overpaid"
          icon={TrendingUp}
          color="bg-blue-500/20 text-blue-400"
        />
        <KpiCard
          title="Landowner Advance"
          value={formatINR(t.landownerAdvanceAmount)}
          sub="landowner overpaid"
          icon={TrendingDown}
          color="bg-amber-500/20 text-amber-400"
        />
        <KpiCard
          title="Pending Recovery"
          value={formatINR(t.recoverableAmount)}
          sub={`${t.recordCount} records`}
          icon={AlertTriangle}
          color="bg-rose-500/20 text-rose-400"
        />
        <KpiCard
          title="Recovered"
          value={formatINR(t.recoveredAmount)}
          sub={`waived: ${formatINR(t.waivedAmount)}`}
          icon={CheckCircle2}
          color="bg-emerald-500/20 text-emerald-400"
        />
      </div>

      {/* Per-Project Table */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-200">
            Per-Project Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.projects.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">
              No burden records yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-xs">Project</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Total Spend</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Dev Advance</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">LO Advance</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Recoverable</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Recovered</TableHead>
                  <TableHead className="text-slate-400 text-xs text-center">Records</TableHead>
                  <TableHead className="text-slate-400 text-xs text-center">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.projects.map((p) => (
                  <TableRow key={p.projectId} className="border-slate-700/50 hover:bg-slate-800/40">
                    <TableCell className="text-slate-200 text-sm font-medium">
                      {p.projectName}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm text-right">
                      {formatINR(p.totalAmount)}
                    </TableCell>
                    <TableCell className="text-blue-400 text-sm text-right font-medium">
                      {formatINR(p.developerAdvanceAmount)}
                    </TableCell>
                    <TableCell className="text-amber-400 text-sm text-right font-medium">
                      {formatINR(p.landownerAdvanceAmount)}
                    </TableCell>
                    <TableCell className="text-rose-400 text-sm text-right font-medium">
                      {formatINR(p.recoverableAmount)}
                    </TableCell>
                    <TableCell className="text-emerald-400 text-sm text-right">
                      {formatINR(p.recoveredAmount)}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm text-center">
                      {p.recordCount}
                    </TableCell>
                    <TableCell className="text-center">
                      {p.pendingCount > 0 ? (
                        <span className="text-xs text-amber-400 font-medium">
                          {p.pendingCount}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Concept note */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-xs text-slate-500 leading-relaxed">
        <strong className="text-slate-400">How this works:</strong> Each
        expenditure is analysed against the active burden rule for its
        category. The rule determines who <em>should</em> bear the cost
        (Developer / Landowner / Shared %). The system then compares that
        expectation against who <em>actually</em> paid, and calculates the
        resulting advance (overpayment) that the other party must eventually
        reimburse.
      </div>
    </div>
  );
}

// ── Waive Dialog ──────────────────────────────────────────────────────────────

function WaiveDialog({
  record,
  open,
  onClose,
  onDone,
}: {
  record: BurdenRecord;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const waiveMutation = useWaiveBurdenRecord();

  function submit() {
    waiveMutation.mutate(
      { id: record.id, data: { notes: notes || undefined } },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Waive Imbalance</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-slate-400">
            This will write off the{" "}
            <strong className="text-white">{formatINR(record.recoverableAmount)}</strong>{" "}
            imbalance on this record. This action cannot be undone.
          </p>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Reason / Notes (optional)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for waiving…"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={waiveMutation.isPending}
            className="bg-rose-600 hover:bg-rose-700"
          >
            {waiveMutation.isPending ? "Waiving…" : "Waive Imbalance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Recover Dialog ────────────────────────────────────────────────────────────

function RecoverDialog({
  record,
  open,
  onClose,
  onDone,
}: {
  record: BurdenRecord;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const remaining =
    Math.max(0, record.recoverableAmount - record.recoveredAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [notes, setNotes] = useState("");
  const recoverMutation = useMarkBurdenRecordRecovered();

  function submit() {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) return;
    recoverMutation.mutate(
      { id: record.id, data: { amount: numAmount, notes: notes || undefined } },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Record Recovery Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-slate-800 p-3 text-xs text-slate-400 grid grid-cols-2 gap-2">
            <span>Recoverable:</span>
            <span className="text-white font-medium text-right">
              {formatINR(record.recoverableAmount)}
            </span>
            <span>Already Recovered:</span>
            <span className="text-emerald-400 font-medium text-right">
              {formatINR(record.recoveredAmount)}
            </span>
            <span>Remaining:</span>
            <span className="text-amber-400 font-medium text-right">
              {formatINR(remaining)}
            </span>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Recovery Amount (₹)
            </label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0.01}
              max={remaining}
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Notes (optional)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment reference, date, etc."
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={recoverMutation.isPending || !parseFloat(amount)}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {recoverMutation.isPending ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Burden Record Dialog ───────────────────────────────────────────────────

function AddRecordDialog({
  open,
  onClose,
  onDone,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  projects: Project[];
}) {
  const [projectId, setProjectId] = useState("");
  const [expenditureId, setExpenditureId] = useState("");
  const [notes, setNotes] = useState("");

  const { data: expenditureData } = useListExpenditures(
    projectId ? { projectId, status: "approved" } : undefined,
  );

  const createMutation = useCreateBurdenRecord();

  function reset() {
    setProjectId("");
    setExpenditureId("");
    setNotes("");
  }

  function submit() {
    if (!expenditureId) return;
    createMutation.mutate(
      { data: { expenditureId, notes: notes || undefined } },
      {
        onSuccess: () => {
          onDone();
          onClose();
          reset();
        },
      },
    );
  }

  const expenditures = expenditureData?.expenditures ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Add Burden Record</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-xs text-slate-400">
            Select an approved expenditure to analyse. The system will
            automatically match the applicable burden rule and compute the
            expected vs actual split.
          </p>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-white">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Expenditure
            </label>
            <Select
              value={expenditureId}
              onValueChange={setExpenditureId}
              disabled={!projectId}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue placeholder="Select expenditure…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {expenditures.length === 0 ? (
                  <SelectItem value="_none" disabled className="text-slate-500">
                    No approved expenditures
                  </SelectItem>
                ) : (
                  expenditures.map((e) => (
                    <SelectItem key={e.id} value={e.id} className="text-white">
                      {e.description} — {formatINR(e.amount)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Notes (optional)
            </label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context…"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>

          {createMutation.error && (
            <p className="text-xs text-rose-400">
              {String((createMutation.error as { message?: string })?.message ?? "Failed to create record.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              reset();
            }}
            className="text-slate-400"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!expenditureId || createMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {createMutation.isPending ? "Analysing…" : "Create Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ledger Tab ────────────────────────────────────────────────────────────────

function LedgerTab({
  projectId,
  canEdit,
  projects,
}: {
  projectId: string | null;
  canEdit: boolean;
  projects: Project[];
}) {
  const qc = useQueryClient();
  const params = projectId ? { projectId } : undefined;
  const { data, isLoading } = useListBurdenRecords(params);

  const [filterStatus, setFilterStatus] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [waiveRecord, setWaiveRecord] = useState<BurdenRecord | null>(null);
  const [recoverRecord, setRecoverRecord] = useState<BurdenRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const records = useMemo(() => {
    const all = data?.records ?? [];
    if (filterStatus === "all") return all;
    if (filterStatus === "imbalanced")
      return all.filter(
        (r) =>
          r.adjustmentStatus === "developer_advance" ||
          r.adjustmentStatus === "landowner_advance",
      );
    return all.filter((r) => r.adjustmentStatus === filterStatus);
  }, [data, filterStatus]);

  function refresh() {
    qc.invalidateQueries({
      queryKey: getListBurdenRecordsQueryKey(params ?? undefined),
    });
    qc.invalidateQueries({
      queryKey: getGetBurdenSummaryQueryKey(params ?? undefined),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-48 bg-slate-800 border-slate-600 text-white text-sm h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="all" className="text-white">
                All Records
              </SelectItem>
              <SelectItem value="imbalanced" className="text-white">
                Imbalanced Only
              </SelectItem>
              <SelectItem value="balanced" className="text-white">
                Balanced
              </SelectItem>
              <SelectItem value="developer_advance" className="text-white">
                Developer Advance
              </SelectItem>
              <SelectItem value="landowner_advance" className="text-white">
                Landowner Advance
              </SelectItem>
              <SelectItem value="waived" className="text-white">
                Waived
              </SelectItem>
            </SelectContent>
          </Select>
          {data && (
            <span className="text-xs text-slate-500">
              {records.length} of {data.records.length} records
            </span>
          )}
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-xs h-8"
          >
            <Plus size={14} className="mr-1" />
            Analyse Expenditure
          </Button>
        )}
      </div>

      <Card className="bg-slate-900 border-slate-700">
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-slate-400 text-sm text-center py-10">Loading…</p>
          ) : records.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-10">
              No records match the current filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-xs w-8" />
                  <TableHead className="text-slate-400 text-xs">Expenditure</TableHead>
                  <TableHead className="text-slate-400 text-xs">Category</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Total</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Exp. Dev</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Exp. LO</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Act. Dev</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Act. LO</TableHead>
                  <TableHead className="text-slate-400 text-xs">Status</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Imbalance</TableHead>
                  <TableHead className="text-slate-400 text-xs">Recovery</TableHead>
                  {canEdit && (
                    <TableHead className="text-slate-400 text-xs text-right">
                      Actions
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => {
                  const isExpanded = expandedId === r.id;
                  const imbalance = Math.max(
                    r.developerImbalanceAmount,
                    r.landownerImbalanceAmount,
                  );
                  const canAct =
                    canEdit &&
                    r.adjustmentStatus !== "balanced" &&
                    r.adjustmentStatus !== "waived" &&
                    r.recoveryStatus !== "recovered";

                  return [
                    <TableRow
                      key={r.id}
                      className="border-slate-700/50 hover:bg-slate-800/40 cursor-pointer"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : r.id)
                      }
                    >
                      <TableCell className="text-slate-500">
                        {isExpanded ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </TableCell>
                      <TableCell className="text-slate-200 text-sm max-w-[180px] truncate">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>{r.expenditureDescription ?? r.expenditureId.slice(0, 8)}</span>
                            </TooltipTrigger>
                            <TooltipContent className="bg-slate-800 border-slate-600 text-white text-xs">
                              {r.projectName && (
                                <div className="text-slate-400">{r.projectName}</div>
                              )}
                              <div>Phase: {r.lifecyclePhaseSnapshot}</div>
                              <div>Rule: {r.ruleId ? r.ruleId.slice(0, 8) : "default"}</div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                          {r.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-slate-300 text-sm text-right font-medium">
                        {formatINR(r.totalAmount)}
                      </TableCell>
                      <TableCell className="text-blue-400 text-xs text-right">
                        {formatINR(r.expectedDeveloperAmount)}
                      </TableCell>
                      <TableCell className="text-amber-400 text-xs text-right">
                        {formatINR(r.expectedLandownerAmount)}
                      </TableCell>
                      <TableCell className="text-blue-300 text-xs text-right">
                        {formatINR(r.actualDeveloperAmount)}
                      </TableCell>
                      <TableCell className="text-amber-300 text-xs text-right">
                        {formatINR(r.actualLandownerAmount)}
                      </TableCell>
                      <TableCell>
                        <AdjustmentBadge status={r.adjustmentStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        {r.adjustmentStatus === "balanced" ||
                        r.adjustmentStatus === "waived" ? (
                          <span className="text-slate-600 text-xs">—</span>
                        ) : (
                          <span className="text-rose-400 text-sm font-medium">
                            {formatINR(imbalance)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RecoveryBadge status={r.recoveryStatus} />
                        {r.recoveryStatus === "in_recovery" && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            {formatINR(r.recoveredAmount)} so far
                          </div>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {canAct && (
                              <>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-emerald-400 hover:bg-emerald-500/10"
                                        onClick={() => setRecoverRecord(r)}
                                      >
                                        <RefreshCw size={13} />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-slate-800 border-slate-600 text-xs">
                                      Record recovery payment
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-rose-400 hover:bg-rose-500/10"
                                        onClick={() => setWaiveRecord(r)}
                                      >
                                        <X size={13} />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent className="bg-slate-800 border-slate-600 text-xs">
                                      Waive imbalance
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>,
                    isExpanded && (
                      <TableRow
                        key={`${r.id}-detail`}
                        className="border-slate-700/50 bg-slate-800/30"
                      >
                        <TableCell
                          colSpan={canEdit ? 12 : 11}
                          className="py-3 px-6"
                        >
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                            <div>
                              <div className="text-slate-500 mb-0.5">
                                Expected Bearer
                              </div>
                              <div className="text-slate-200">
                                {BEARER_LABELS[r.expectedBearerType] ??
                                  r.expectedBearerType}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-0.5">
                                Actual Payer
                              </div>
                              <div className="text-slate-200">
                                {r.actualPayerName ?? "—"}{" "}
                                {r.actualPayerRole && (
                                  <span className="text-slate-500">
                                    ({r.actualPayerRole})
                                  </span>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-0.5">
                                Lifecycle Phase
                              </div>
                              <div className="text-slate-200">
                                {r.lifecyclePhaseSnapshot}
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-0.5">
                                Recorded By
                              </div>
                              <div className="text-slate-200">
                                {r.createdByName ?? "—"}
                              </div>
                            </div>
                            {r.notes && (
                              <div className="col-span-2">
                                <div className="text-slate-500 mb-0.5">
                                  Notes
                                </div>
                                <div className="text-slate-300">{r.notes}</div>
                              </div>
                            )}
                            {r.recoveryNotes && (
                              <div className="col-span-2">
                                <div className="text-slate-500 mb-0.5">
                                  Recovery Notes
                                </div>
                                <div className="text-slate-300">
                                  {r.recoveryNotes}
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ),
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {waiveRecord && (
        <WaiveDialog
          record={waiveRecord}
          open={true}
          onClose={() => setWaiveRecord(null)}
          onDone={refresh}
        />
      )}
      {recoverRecord && (
        <RecoverDialog
          record={recoverRecord}
          open={true}
          onClose={() => setRecoverRecord(null)}
          onDone={refresh}
        />
      )}
      <AddRecordDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={refresh}
        projects={projects}
      />
    </div>
  );
}

// ── Rule Form Dialog ──────────────────────────────────────────────────────────

function RuleFormDialog({
  rule,
  open,
  onClose,
  onDone,
  projects,
}: {
  rule: BurdenRule | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  projects: Project[];
}) {
  const isEdit = !!rule;
  const today = new Date().toISOString().slice(0, 10);

  const [projectId, setProjectId] = useState(rule?.projectId ?? "");
  const [category, setCategory] = useState(rule?.category ?? "");
  const [bearerType, setBearerType] = useState<BurdenRule["bearerType"]>(rule?.bearerType ?? "developer");
  const [developerPct, setDeveloperPct] = useState(String(rule?.developerPct ?? 50));
  const [landownerPct, setLandownerPct] = useState(String(rule?.landownerPct ?? 50));
  const [lifecyclePhase, setLifecyclePhase] = useState(rule?.lifecyclePhase ?? "all");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(rule?.effectiveFrom ?? today);
  const [effectiveTo, setEffectiveTo] = useState(rule?.effectiveTo ?? "");
  const [error, setError] = useState("");

  const createMutation = useCreateBurdenRule();
  const updateMutation = useUpdateBurdenRule();
  const isPending = createMutation.isPending || updateMutation.isPending;

  function submit() {
    setError("");
    if (!projectId) { setError("Project is required."); return; }
    if (!bearerType) { setError("Bearer type is required."); return; }
    if (!effectiveFrom) { setError("Effective from date is required."); return; }

    const devPct = parseFloat(developerPct);
    const loPct = parseFloat(landownerPct);

    if (bearerType === "shared") {
      if (isNaN(devPct) || isNaN(loPct)) {
        setError("Developer % and Landowner % are required for Shared type.");
        return;
      }
      if (Math.abs(devPct + loPct - 100) > 0.1) {
        setError(`Percentages must sum to 100 (got ${devPct + loPct}).`);
        return;
      }
    }

    const payload = {
      projectId,
      category: category || undefined,
      bearerType: bearerType as BurdenRule["bearerType"],
      developerPct: bearerType === "shared" ? devPct : undefined,
      landownerPct: bearerType === "shared" ? loPct : undefined,
      lifecyclePhase,
      description: description || undefined,
      effectiveFrom,
      effectiveTo: effectiveTo || undefined,
    };

    if (isEdit) {
      updateMutation.mutate(
        { id: rule.id, data: payload },
        { onSuccess: () => { onDone(); onClose(); } },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        { onSuccess: () => { onDone(); onClose(); } },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? "Edit Burden Rule" : "New Burden Rule"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Project */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Project <span className="text-rose-400">*</span>
            </label>
            <Select value={projectId} onValueChange={setProjectId} disabled={isEdit}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-white">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Category{" "}
              <span className="text-slate-500">(blank = applies to all categories)</span>
            </label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. maintenance, labour, inputs…"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>

          {/* Bearer Type */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Bearer Type <span className="text-rose-400">*</span>
            </label>
            <Select value={bearerType} onValueChange={(v) => setBearerType(v as BurdenRule["bearerType"])}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="developer" className="text-white">
                  Developer (developer bears 100%)
                </SelectItem>
                <SelectItem value="landowner" className="text-white">
                  Landowner (landowner bears 100%)
                </SelectItem>
                <SelectItem value="shared" className="text-white">
                  Shared (fixed % split)
                </SelectItem>
                <SelectItem value="proportional" className="text-white">
                  Proportional (based on ownership share)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* % split — only for shared */}
          {bearerType === "shared" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Developer % <span className="text-rose-400">*</span>
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={developerPct}
                  onChange={(e) => {
                    setDeveloperPct(e.target.value);
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setLandownerPct(String(100 - v));
                  }}
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Landowner % <span className="text-rose-400">*</span>
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={landownerPct}
                  onChange={(e) => {
                    setLandownerPct(e.target.value);
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setDeveloperPct(String(100 - v));
                  }}
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
            </div>
          )}

          {/* Lifecycle Phase */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Lifecycle Phase
            </label>
            <Select value={lifecyclePhase} onValueChange={setLifecyclePhase}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="all" className="text-white">
                  All phases
                </SelectItem>
                <SelectItem value="prematurity" className="text-white">
                  Prematurity
                </SelectItem>
                <SelectItem value="mature_production" className="text-white">
                  Mature Production
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief rationale for this rule…"
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                Effective From <span className="text-rose-400">*</span>
              </label>
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                Effective To{" "}
                <span className="text-slate-500">(leave blank = open-ended)</span>
              </label>
              <Input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 rounded px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-slate-400">
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isPending ? "Saving…" : isEdit ? "Update Rule" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rules Tab ─────────────────────────────────────────────────────────────────

function RulesTab({
  projectId,
  canEdit,
  projects,
}: {
  projectId: string | null;
  canEdit: boolean;
  projects: Project[];
}) {
  const qc = useQueryClient();
  const params = useMemo(
    () =>
      ({
        ...(projectId ? { projectId } : {}),
        includeInactive: false,
      } as { projectId?: string; includeInactive?: boolean }),
    [projectId],
  );

  const { data, isLoading } = useListBurdenRules(params);
  const updateMutation = useUpdateBurdenRule();

  const [formOpen, setFormOpen] = useState(false);
  const [editRule, setEditRule] = useState<BurdenRule | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: getListBurdenRulesQueryKey(params) });
  }

  function deactivate(rule: BurdenRule) {
    updateMutation.mutate(
      { id: rule.id, data: { isActive: false } },
      { onSuccess: refresh },
    );
  }

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Rules determine the expected burden split per expenditure category
          and lifecycle phase. More specific rules (matching category) take
          priority over general rules.
        </p>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => {
              setEditRule(null);
              setFormOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-xs h-8 ml-4 flex-shrink-0"
          >
            <Plus size={14} className="mr-1" />
            New Rule
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-400 text-sm text-center py-10">Loading…</p>
      ) : rules.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="py-10 text-center">
            <Scale size={32} className="text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm mb-1">No burden rules configured</p>
            <p className="text-slate-500 text-xs">
              Without rules, the system defaults all costs to the Developer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className="bg-slate-900 border-slate-700 hover:border-slate-600 transition-colors"
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-200">
                        {rule.category ? (
                          <>
                            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded">
                              {rule.category}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-400 italic text-xs">
                            All categories
                          </span>
                        )}
                      </span>
                      <span className="text-slate-600">·</span>
                      <Badge
                        className={`text-xs font-normal border ${
                          rule.bearerType === "developer"
                            ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                            : rule.bearerType === "landowner"
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                            : rule.bearerType === "shared"
                            ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                            : "bg-teal-500/15 text-teal-400 border-teal-500/30"
                        }`}
                      >
                        {BEARER_LABELS[rule.bearerType]}
                        {rule.bearerType === "shared" &&
                          rule.developerPct !== null &&
                          ` (Dev ${rule.developerPct}% / LO ${rule.landownerPct}%)`}
                      </Badge>
                      {rule.lifecyclePhase !== "all" && (
                        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                          {rule.lifecyclePhase === "prematurity"
                            ? "Prematurity only"
                            : "Mature Production only"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      <span>
                        From {rule.effectiveFrom}
                        {rule.effectiveTo ? ` → ${rule.effectiveTo}` : " (open-ended)"}
                      </span>
                      {rule.description && (
                        <>
                          <span>·</span>
                          <span>{rule.description}</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {projects.find((p) => p.id === rule.projectId)?.name ?? rule.projectId}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-slate-400 hover:text-white"
                              onClick={() => {
                                setEditRule(rule);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil size={13} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="bg-slate-800 border-slate-600 text-xs">
                            Edit rule
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-rose-400 hover:bg-rose-500/10"
                              onClick={() => deactivate(rule)}
                            >
                              <X size={13} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="bg-slate-800 border-slate-600 text-xs">
                            Deactivate rule
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RuleFormDialog
        rule={editRule}
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditRule(null);
        }}
        onDone={refresh}
        projects={projects}
      />
    </div>
  );
}

// ── Imbalances Tab ────────────────────────────────────────────────────────────

const ENTRY_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  burden_imbalance: { label: "Imbalance", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  recovery: { label: "Recovery", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  waiver: { label: "Waiver", color: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  manual: { label: "Manual", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  carry_forward: { label: "Carry-forward", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
};

function EntryTypeBadge({ type }: { type: string }) {
  const cfg = ENTRY_TYPE_CONFIG[type] ?? { label: type, color: "bg-slate-500/15 text-slate-400" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function BalanceAmount({ amount, className = "" }: { amount: number; className?: string }) {
  const isNeg = amount < 0;
  return (
    <span className={`font-mono font-semibold ${isNeg ? "text-red-400" : amount > 0 ? "text-emerald-400" : "text-slate-400"} ${className}`}>
      {isNeg ? <Minus size={12} className="inline mr-0.5" /> : null}
      {formatINR(Math.abs(amount))}
    </span>
  );
}

function ImbalancesTab({
  projectId,
  canEdit,
  isAdmin,
  projects,
}: {
  projectId: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  projects: Project[];
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<"overview" | "partners" | "ledger">("overview");
  const [ledgerRole, setLedgerRole] = useState<string>("");
  const [ledgerProject, setLedgerProject] = useState<string>(projectId ?? "");

  // Manual entry dialog state
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualForm, setManualForm] = useState({
    projectId: projectId ?? "",
    developerAmount: "",
    landownerAmount: "",
    description: "",
    notes: "",
    period: new Date().toISOString().slice(0, 7),
  });

  const { data: summary, isLoading: summaryLoading } = useGetImbalanceSummary(
    projectId ? { projectId } : undefined,
  );
  const { data: partnerData, isLoading: partnerLoading } = useGetImbalancePartnerSummary();
  const { data: ledgerData, isLoading: ledgerLoading } = useListImbalanceLedger({
    projectId: ledgerProject || undefined,
    partyRole: (ledgerRole || undefined) as "developer" | "landowner" | undefined,
  });

  const seedMutation = useSeedImbalanceLedger({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getImbalanceSummary"] });
        qc.invalidateQueries({ queryKey: ["listImbalanceLedger"] });
      },
    },
  });

  const createEntryMutation = useCreateImbalanceEntry({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getImbalanceSummary"] });
        qc.invalidateQueries({ queryKey: ["listImbalanceLedger"] });
        setShowManualDialog(false);
        setManualForm((f) => ({ ...f, description: "", notes: "", developerAmount: "", landownerAmount: "" }));
      },
    },
  });

  const summaryProjects = summary?.projects ?? [];
  const totals = summary?.totals;
  const ledgerEntries = ledgerData?.entries ?? [];
  const partnerList = partnerData?.partners ?? [];

  function handleCreateEntry() {
    const devAmt = parseFloat(manualForm.developerAmount);
    const loAmt = parseFloat(manualForm.landownerAmount);
    if (!manualForm.projectId || isNaN(devAmt) || isNaN(loAmt) || !manualForm.description.trim()) return;
    createEntryMutation.mutate({
      data: {
        projectId: manualForm.projectId,
        developerAmount: devAmt,
        landownerAmount: loAmt,
        description: manualForm.description.trim(),
        notes: manualForm.notes || undefined,
        period: manualForm.period || undefined,
      },
    });
  }

  return (
    <div className="space-y-4">
      {/* Sub-nav + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
          {(
            [
              { id: "overview", label: "Balance Overview", Icon: Wallet },
              { id: "partners", label: "Partners", Icon: Users },
              { id: "ledger", label: "Ledger", Icon: List },
            ] as { id: "overview" | "partners" | "ledger"; label: string; Icon: React.ElementType }[]
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                view === id
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-700 text-xs gap-1.5"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
              >
                {seedMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Seed from Records
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-xs gap-1.5"
                onClick={() => setShowManualDialog(true)}
              >
                <Plus size={12} />
                Manual Entry
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Balance Overview ────────────────────────────────────────────────────── */}
      {view === "overview" && (
        <div className="space-y-4">
          {/* Totals KPIs */}
          {totals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-400 mb-1">Developer Balance</p>
                  <BalanceAmount amount={totals.totalDeveloperBalance} className="text-lg" />
                  <p className="text-xs text-slate-500 mt-1">
                    {totals.totalDeveloperBalance > 0 ? "Owed to developer" : totals.totalDeveloperBalance < 0 ? "Developer owes" : "Balanced"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-400 mb-1">Landowner Balance</p>
                  <BalanceAmount amount={totals.totalLandownerBalance} className="text-lg" />
                  <p className="text-xs text-slate-500 mt-1">
                    {totals.totalLandownerBalance > 0 ? "Owed to landowner" : totals.totalLandownerBalance < 0 ? "Landowner owes" : "Balanced"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-xs text-slate-400 mb-1">Projects Tracked</p>
                  <p className="text-2xl font-bold text-white">{totals.projectCount}</p>
                </CardContent>
              </Card>
              <Card className={`border ${totals.negativeCount > 0 ? "bg-red-900/20 border-red-700/40" : "bg-slate-800 border-slate-700"}`}>
                <CardContent className="p-4">
                  <p className="text-xs text-slate-400 mb-1">Negative Balances</p>
                  <p className={`text-2xl font-bold ${totals.negativeCount > 0 ? "text-red-400" : "text-slate-400"}`}>
                    {totals.negativeCount}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">projects with deficit</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Per-project breakdown */}
          {summaryLoading ? (
            <div className="flex items-center justify-center h-24 text-slate-500">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading…
            </div>
          ) : summaryProjects.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-8 text-center">
                <Layers size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400 font-medium">No imbalance data yet</p>
                <p className="text-slate-500 text-sm mt-1">
                  Create burden records or use "Seed from Records" to populate the ledger.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400">Project</TableHead>
                    <TableHead className="text-slate-400">Developer</TableHead>
                    <TableHead className="text-slate-400">Developer Partner</TableHead>
                    <TableHead className="text-slate-400">Landowner</TableHead>
                    <TableHead className="text-slate-400">Landowner Partner</TableHead>
                    <TableHead className="text-slate-400 text-right">Entries</TableHead>
                    <TableHead className="text-slate-400 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryProjects.map((p) => {
                    const hasNeg = p.developerBalance < 0 || p.landownerBalance < 0;
                    return (
                      <TableRow key={p.projectId} className={`border-slate-700 ${hasNeg ? "bg-red-900/10" : ""}`}>
                        <TableCell className="text-white font-medium">{p.projectName}</TableCell>
                        <TableCell><BalanceAmount amount={p.developerBalance} /></TableCell>
                        <TableCell className="text-slate-400 text-sm">{p.developerPartnerName ?? "—"}</TableCell>
                        <TableCell><BalanceAmount amount={p.landownerBalance} /></TableCell>
                        <TableCell className="text-slate-400 text-sm">{p.landownerPartnerName ?? "—"}</TableCell>
                        <TableCell className="text-right text-slate-400">{p.entryCount}</TableCell>
                        <TableCell className="text-right">
                          {hasNeg ? (
                            <span className="inline-flex items-center gap-1 text-xs text-red-400">
                              <AlertTriangle size={12} /> Negative
                            </span>
                          ) : p.developerBalance === 0 && p.landownerBalance === 0 ? (
                            <span className="text-xs text-slate-500">Zero</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                              <CheckCircle2 size={12} /> Positive
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── Partner Summary ──────────────────────────────────────────────────────── */}
      {view === "partners" && (
        <div className="space-y-3">
          {partnerLoading ? (
            <div className="flex items-center justify-center h-24 text-slate-500">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading…
            </div>
          ) : partnerList.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-8 text-center">
                <Users size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400 font-medium">No partner imbalance data</p>
                <p className="text-slate-500 text-sm mt-1">
                  Partners appear here once active agreements link them to projects with imbalance records.
                </p>
              </CardContent>
            </Card>
          ) : (
            partnerList.map((partner) => (
              <Card
                key={partner.partnerId}
                className={`border ${partner.isNegative ? "bg-red-900/15 border-red-700/40" : "bg-slate-800 border-slate-700"}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-full ${partner.isNegative ? "bg-red-500/15" : "bg-emerald-500/15"}`}>
                        <Users size={14} className={partner.isNegative ? "text-red-400" : "text-emerald-400"} />
                      </div>
                      <CardTitle className="text-white text-base">{partner.partnerName}</CardTitle>
                      <div className="flex gap-1">
                        {partner.roles.map((r: string) => (
                          <Badge key={r} variant="outline" className="text-xs border-slate-600 text-slate-400 capitalize">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500 mb-0.5">Net Balance</p>
                      <BalanceAmount amount={partner.totalBalance} className="text-base" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="rounded border border-slate-700 overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-700 hover:bg-transparent">
                          <TableHead className="text-slate-500 text-xs">Project</TableHead>
                          <TableHead className="text-slate-500 text-xs">Role</TableHead>
                          <TableHead className="text-slate-500 text-xs text-right">Balance</TableHead>
                          <TableHead className="text-slate-500 text-xs text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {partner.projects.map((pp: { projectId: string; projectName: string; role: string; balance: number; isNegative: boolean }) => (
                          <TableRow key={`${pp.projectId}-${pp.role}`} className="border-slate-700">
                            <TableCell className="text-slate-300 text-sm">{pp.projectName}</TableCell>
                            <TableCell className="text-slate-400 text-sm capitalize">{pp.role}</TableCell>
                            <TableCell className="text-right"><BalanceAmount amount={pp.balance} /></TableCell>
                            <TableCell className="text-right">
                              {pp.isNegative ? (
                                <span className="text-xs text-red-400 flex items-center gap-1 justify-end">
                                  <AlertTriangle size={11} /> Deficit
                                </span>
                              ) : pp.balance === 0 ? (
                                <span className="text-xs text-slate-500">Neutral</span>
                              ) : (
                                <span className="text-xs text-emerald-400 flex items-center gap-1 justify-end">
                                  <CheckCircle2 size={11} /> Credit
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── Transaction Ledger ───────────────────────────────────────────────────── */}
      {view === "ledger" && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={ledgerProject} onValueChange={setLedgerProject}>
              <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="" className="text-slate-300">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-300">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ledgerRole} onValueChange={setLedgerRole}>
              <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-slate-300 text-sm h-8">
                <SelectValue placeholder="All parties" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="" className="text-slate-300">All parties</SelectItem>
                <SelectItem value="developer" className="text-slate-300">Developer</SelectItem>
                <SelectItem value="landowner" className="text-slate-300">Landowner</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-slate-500 ml-1">
              {ledgerEntries.length} entries
            </span>
          </div>

          {ledgerLoading ? (
            <div className="flex items-center justify-center h-24 text-slate-500">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading…
            </div>
          ) : ledgerEntries.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-8 text-center">
                <List size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-slate-400 font-medium">No ledger entries</p>
                <p className="text-slate-500 text-sm mt-1">Entries are created automatically when burden records have imbalances.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400 w-28">Date</TableHead>
                    <TableHead className="text-slate-400 w-24">Party</TableHead>
                    <TableHead className="text-slate-400 w-32">Type</TableHead>
                    <TableHead className="text-slate-400">Description</TableHead>
                    <TableHead className="text-slate-400 text-right w-36">Amount</TableHead>
                    <TableHead className="text-slate-400 text-right w-40">Running Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerEntries.map((e) => (
                    <TableRow
                      key={e.id}
                      className={`border-slate-700 ${e.isNegativeBalance ? "bg-red-900/10" : ""}`}
                    >
                      <TableCell className="text-slate-400 text-xs">
                        {fmtDate(e.createdAt as unknown as string)}
                        {e.period && (
                          <span className="block text-slate-600">{e.period}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs font-medium ${e.partyRole === "developer" ? "text-blue-400" : "text-amber-400"}`}>
                          {e.partyRole === "developer" ? "Developer" : "Landowner"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <EntryTypeBadge type={e.entryType} />
                      </TableCell>
                      <TableCell className="text-slate-300 text-sm">
                        {e.description}
                        {e.notes && <span className="block text-xs text-slate-500">{e.notes}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono text-sm font-semibold ${e.amount > 0 ? "text-emerald-400" : e.amount < 0 ? "text-red-400" : "text-slate-400"}`}>
                          {e.amount > 0 ? "+" : ""}{formatINR(e.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {e.isNegativeBalance && (
                            <AlertTriangle size={12} className="text-red-400 shrink-0" />
                          )}
                          <BalanceAmount amount={e.runningBalance} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* ── Manual Entry Dialog ──────────────────────────────────────────────────── */}
      {isAdmin && (
        <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
          <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white">Manual Imbalance Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded p-3">
                Creates a paired entry for both developer and landowner. Positive = credit (owed to party), negative = debit (party owes). The two amounts should normally sum to zero.
              </p>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Project</label>
                <Select
                  value={manualForm.projectId}
                  onValueChange={(v) => setManualForm((f) => ({ ...f, projectId: v }))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-300">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-slate-300">{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Developer Amount (signed)</label>
                  <Input
                    type="number"
                    placeholder="e.g. 50000 or -50000"
                    value={manualForm.developerAmount}
                    onChange={(e) => setManualForm((f) => ({ ...f, developerAmount: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-slate-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Landowner Amount (signed)</label>
                  <Input
                    type="number"
                    placeholder="e.g. -50000 or 50000"
                    value={manualForm.landownerAmount}
                    onChange={(e) => setManualForm((f) => ({ ...f, landownerAmount: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-slate-300"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Description</label>
                <Input
                  placeholder="Reason for manual adjustment"
                  value={manualForm.description}
                  onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-slate-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Period (YYYY-MM)</label>
                  <Input
                    placeholder="2026-05"
                    value={manualForm.period}
                    onChange={(e) => setManualForm((f) => ({ ...f, period: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-slate-300"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Notes (optional)</label>
                  <Input
                    placeholder="Additional notes"
                    value={manualForm.notes}
                    onChange={(e) => setManualForm((f) => ({ ...f, notes: e.target.value }))}
                    className="bg-slate-800 border-slate-700 text-slate-300"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowManualDialog(false)}
                className="border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={handleCreateEntry}
                disabled={createEntryMutation.isPending}
              >
                {createEntryMutation.isPending && <Loader2 size={14} className="animate-spin mr-1.5" />}
                Create Entry
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Burden() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const canEdit = role === "admin" || role === "developer";

  const { data: projects = [] } = useListProjects();

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-blue-500/15">
          <ArrowLeftRight size={20} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">
            Operational Burden Accounting
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Expected vs actual cost bearing — tracks who should bear each cost
            and who actually did, computing imbalances and recovery status.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary">
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger
            value="summary"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
          >
            <HandCoins size={14} className="mr-1.5" />
            Summary
          </TabsTrigger>
          <TabsTrigger
            value="ledger"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
          >
            <ArrowLeftRight size={14} className="mr-1.5" />
            Ledger
          </TabsTrigger>
          <TabsTrigger
            value="rules"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
          >
            <Scale size={14} className="mr-1.5" />
            Rules
          </TabsTrigger>
          <TabsTrigger
            value="imbalances"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
          >
            <Wallet size={14} className="mr-1.5" />
            Imbalances
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <SummaryTab projectId={selectedProjectId} />
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <LedgerTab
            projectId={selectedProjectId}
            canEdit={canEdit}
            projects={projects}
          />
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <RulesTab
            projectId={selectedProjectId}
            canEdit={canEdit}
            projects={projects}
          />
        </TabsContent>

        <TabsContent value="imbalances" className="mt-4">
          <ImbalancesTab
            projectId={selectedProjectId}
            canEdit={canEdit}
            isAdmin={role === "admin"}
            projects={projects}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
