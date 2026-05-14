import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListSettlementRecords,
  useCreateSettlementRecord,
  useGetSettlementRecord,
  useUpdateSettlementRecord,
  useSetSettlementRecommendation,
  useOverrideSettlement,
  useFinalizeSettlement,
  useDisputeSettlement,
  useReopenSettlement,
  useArchiveSettlementRecord,
  useGetSettlementAudit,
  useGetSettlementComparison,
} from "@workspace/api-client-react";
import {
  useListProjects,
  useListPartners,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit,
  Eye,
  Flag,
  GitCompare,
  History,
  Lock,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  Unlock,
  AlertCircle,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtINR(v: string | number | null | undefined) {
  const n = parseFloat(String(v ?? "0"));
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "dd MMM yyyy, HH:mm"); } catch { return d; }
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft:       { label: "Draft",       color: "bg-zinc-700 text-zinc-300",      icon: Clock },
  recommended: { label: "Recommended", color: "bg-sky-900 text-sky-200",        icon: ShieldCheck },
  overridden:  { label: "Overridden",  color: "bg-amber-900 text-amber-200",    icon: Edit },
  finalized:   { label: "Finalized",   color: "bg-emerald-900 text-emerald-200",icon: Lock },
  disputed:    { label: "Disputed",    color: "bg-red-900 text-red-200",        icon: AlertTriangle },
};

const EVENT_CONFIG: Record<string, { label: string; color: string }> = {
  created:            { label: "Created",            color: "text-zinc-400" },
  updated:            { label: "Updated",            color: "text-zinc-400" },
  recommendation_set: { label: "Recommendation Set", color: "text-sky-400"  },
  overridden:         { label: "Override Applied",   color: "text-amber-400"},
  finalized:          { label: "Finalized",          color: "text-emerald-400"},
  disputed:           { label: "Disputed",           color: "text-red-400"  },
  reopened:           { label: "Reopened",           color: "text-violet-400"},
  archived:           { label: "Archived",           color: "text-zinc-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-zinc-700 text-zinc-300", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onClose,
  projectOptions,
  partnerOptions,
}: {
  open: boolean;
  onClose: () => void;
  projectOptions: Array<{ id: string; name: string }>;
  partnerOptions: Array<{ id: string; name: string }>;
}) {
  const qc = useQueryClient();
  const createMut = useCreateSettlementRecord();
  const [form, setForm] = useState({
    projectId: "",
    partnerId: "",
    settlementType: "fifty_pct",
    periodLabel: "",
    periodStart: "",
    periodEnd: "",
    recommendedAmount: "",
    notes: "",
  });

  const TYPES = [
    { value: "fifty_pct", label: "50% Revenue Model" },
    { value: "payable", label: "Partner Payable" },
    { value: "lca", label: "LCA Settlement" },
    { value: "loss_absorption", label: "Loss Absorption" },
    { value: "manual", label: "Manual" },
  ];

  async function handleSubmit() {
    if (!form.projectId || !form.periodLabel) return;
    await createMut.mutateAsync({
      data: {
        projectId: form.projectId,
        partnerId: form.partnerId || undefined,
        settlementType: form.settlementType,
        periodLabel: form.periodLabel,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
        recommendedAmount: form.recommendedAmount ? parseFloat(form.recommendedAmount) : undefined,
        notes: form.notes || undefined,
      },
    });
    qc.invalidateQueries({ queryKey: ["listSettlementRecords"] });
    onClose();
    setForm({ projectId: "", partnerId: "", settlementType: "fifty_pct", periodLabel: "", periodStart: "", periodEnd: "", recommendedAmount: "", notes: "" });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Settlement Record</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-400 text-xs">Project *</Label>
              <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-600">
                  {projectOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-zinc-100">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-zinc-400 text-xs">Partner (optional)</Label>
              <Select value={form.partnerId || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, partnerId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1">
                  <SelectValue placeholder="All partners" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-600">
                  <SelectItem value="__none__" className="text-zinc-400">No specific partner</SelectItem>
                  {partnerOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-zinc-100">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Settlement Type *</Label>
            <Select value={form.settlementType} onValueChange={(v) => setForm((f) => ({ ...f, settlementType: v }))}>
              <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-600">
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-zinc-100">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Period Label *</Label>
            <Input
              value={form.periodLabel}
              onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))}
              placeholder="e.g. FY 2024-25 Q3"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-zinc-400 text-xs">Period Start</Label>
              <Input type="date" value={form.periodStart} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" />
            </div>
            <div>
              <Label className="text-zinc-400 text-xs">Period End</Label>
              <Input type="date" value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Initial Recommended Amount (optional)</Label>
            <Input
              type="number"
              value={form.recommendedAmount}
              onChange={(e) => setForm((f) => ({ ...f, recommendedAmount: e.target.value }))}
              placeholder="₹ 0.00"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
            />
            <p className="text-zinc-500 text-xs mt-1">If provided, record moves directly to "recommended" status.</p>
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Context, source reference…" className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-100">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.projectId || !form.periodLabel || createMut.isPending}
            className="bg-emerald-700 hover:bg-emerald-600 text-white"
          >
            {createMut.isPending ? "Creating…" : "Create Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Override dialog ───────────────────────────────────────────────────────

function OverrideDialog({
  open,
  onClose,
  recordId,
  currentActual,
}: {
  open: boolean;
  onClose: () => void;
  recordId: string | null;
  currentActual: string | null;
}) {
  const qc = useQueryClient();
  const overrideMut = useOverrideSettlement();
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");

  async function handleSubmit() {
    if (!recordId || !amount || remarks.trim().length < 5) return;
    await overrideMut.mutateAsync({ id: recordId, data: { actualAmount: parseFloat(amount), overrideRemarks: remarks } });
    qc.invalidateQueries({ queryKey: ["listSettlementRecords"] });
    qc.invalidateQueries({ queryKey: ["getSettlementRecord", recordId] });
    qc.invalidateQueries({ queryKey: ["getSettlementAudit", recordId] });
    qc.invalidateQueries({ queryKey: ["getSettlementComparison", recordId] });
    onClose();
    setAmount(""); setRemarks("");
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-4 h-4 text-amber-400" /> Override Settlement
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 rounded-lg bg-amber-950/40 border border-amber-800/50 p-3 mb-2">
          <p className="text-amber-300 text-xs font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> No silent modification allowed</p>
          <p className="text-amber-200/70 text-xs">Override remarks are mandatory and permanently recorded in the immutable audit log. The system recommendation is preserved alongside the actual value.</p>
        </div>
        <div className="space-y-4">
          {currentActual && (
            <div className="text-sm text-zinc-400">Current actual: <span className="text-zinc-100 font-semibold">{fmtINR(currentActual)}</span></div>
          )}
          <div>
            <Label className="text-zinc-400 text-xs">Actual Settlement Amount *</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ 0.00" className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" />
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Override Remarks * <span className="text-red-400">(min 5 chars, required)</span></Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Explain the reason for overriding the system recommendation…"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              rows={3}
            />
            <p className="text-zinc-500 text-xs mt-1">{remarks.length} / 5 min chars</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-100">Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={!amount || remarks.trim().length < 5 || overrideMut.isPending}
            className="bg-amber-700 hover:bg-amber-600 text-white"
          >
            {overrideMut.isPending ? "Applying…" : "Apply Override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Finalize dialog ───────────────────────────────────────────────────────

function FinalizeDialog({
  open,
  onClose,
  recordId,
  record,
}: {
  open: boolean;
  onClose: () => void;
  recordId: string | null;
  record: any;
}) {
  const qc = useQueryClient();
  const finalizeMut = useFinalizeSettlement();
  const [notes, setNotes] = useState("");

  async function handleSubmit() {
    if (!recordId) return;
    await finalizeMut.mutateAsync({ id: recordId, data: { finalizationNotes: notes || undefined } });
    qc.invalidateQueries({ queryKey: ["listSettlementRecords"] });
    qc.invalidateQueries({ queryKey: ["getSettlementRecord", recordId] });
    qc.invalidateQueries({ queryKey: ["getSettlementAudit", recordId] });
    onClose();
    setNotes("");
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-400" /> Finalize Settlement
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 rounded-lg bg-emerald-950/40 border border-emerald-800/50 p-3 mb-2">
          <p className="text-emerald-300 text-xs font-medium flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Project Developer Final Authority</p>
          <p className="text-emerald-200/70 text-xs">Finalizing locks this record permanently. Only an admin can reopen it, and that action also creates an immutable audit entry.</p>
        </div>
        {record && (
          <div className="rounded-lg bg-zinc-800 border border-zinc-700 p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Recommended</span>
              <span className="text-sky-300 font-semibold">{fmtINR(record.recommendedAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Actual (to finalize)</span>
              <span className={`font-semibold ${record.isOverridden ? "text-amber-300" : "text-emerald-300"}`}>{fmtINR(record.actualAmount)}</span>
            </div>
            {record.isOverridden && (
              <div className="text-xs text-amber-400/80 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Override applied {record.overrideCount}× — "{record.overrideRemarks}"
              </div>
            )}
          </div>
        )}
        <div>
          <Label className="text-zinc-400 text-xs">Finalization Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any final notes for the record…" className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" rows={2} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-100">Cancel</Button>
          <Button onClick={handleSubmit} disabled={finalizeMut.isPending} className="bg-emerald-700 hover:bg-emerald-600 text-white">
            {finalizeMut.isPending ? "Finalizing…" : "Finalize Settlement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reopen dialog ─────────────────────────────────────────────────────────

function ReopenDialog({
  open,
  onClose,
  recordId,
}: {
  open: boolean;
  onClose: () => void;
  recordId: string | null;
}) {
  const qc = useQueryClient();
  const reopenMut = useReopenSettlement();
  const [remarks, setRemarks] = useState("");

  async function handleSubmit() {
    if (!recordId || remarks.trim().length < 5) return;
    await reopenMut.mutateAsync({ id: recordId, data: { remarks } });
    qc.invalidateQueries({ queryKey: ["listSettlementRecords"] });
    qc.invalidateQueries({ queryKey: ["getSettlementRecord", recordId] });
    qc.invalidateQueries({ queryKey: ["getSettlementAudit", recordId] });
    onClose();
    setRemarks("");
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-violet-300">
            <Unlock className="w-4 h-4" /> Reopen Finalized Settlement
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-lg bg-red-950/40 border border-red-800/50 p-3 mb-2">
          <p className="text-red-300 text-xs font-medium">Admin-only action.</p>
          <p className="text-red-200/70 text-xs mt-1">Reopening a finalized record is an exceptional action. The justification is permanently recorded in the immutable audit trail.</p>
        </div>
        <div>
          <Label className="text-zinc-400 text-xs">Justification * (min 5 chars)</Label>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Why is this finalized settlement being reopened?" className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" rows={3} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-100">Cancel</Button>
          <Button onClick={handleSubmit} disabled={remarks.trim().length < 5 || reopenMut.isPending} className="bg-violet-700 hover:bg-violet-600 text-white">
            {reopenMut.isPending ? "Reopening…" : "Reopen Settlement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dispute dialog ────────────────────────────────────────────────────────

function DisputeDialog({
  open,
  onClose,
  recordId,
}: {
  open: boolean;
  onClose: () => void;
  recordId: string | null;
}) {
  const qc = useQueryClient();
  const disputeMut = useDisputeSettlement();
  const [remarks, setRemarks] = useState("");

  async function handleSubmit() {
    if (!recordId || remarks.trim().length < 5) return;
    await disputeMut.mutateAsync({ id: recordId, data: { remarks } });
    qc.invalidateQueries({ queryKey: ["listSettlementRecords"] });
    onClose();
    setRemarks("");
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-300">
            <Flag className="w-4 h-4" /> Mark as Disputed
          </DialogTitle>
        </DialogHeader>
        <div>
          <Label className="text-zinc-400 text-xs">Dispute Reason * (min 5 chars)</Label>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Describe the dispute…" className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1" rows={3} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="text-zinc-400 hover:text-zinc-100">Cancel</Button>
          <Button onClick={handleSubmit} disabled={remarks.trim().length < 5 || disputeMut.isPending} className="bg-red-700 hover:bg-red-600 text-white">
            {disputeMut.isPending ? "Marking…" : "Mark Disputed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Comparison panel ──────────────────────────────────────────────────────

function ComparisonPanel({ recordId }: { recordId: string }) {
  const { data, isLoading } = useGetSettlementComparison(recordId);

  if (isLoading) return <div className="text-zinc-500 text-sm p-4">Loading comparison…</div>;
  if (!data) return <div className="text-zinc-500 text-sm p-4">No data</div>;

  const d = data as any;
  const diff = parseFloat(d.delta?.amount ?? "0");
  const pct = parseFloat(d.delta?.percentChange ?? "0");
  const isUp = diff > 0;
  const isDown = diff < 0;
  const unchanged = diff === 0;

  return (
    <div className="space-y-4">
      {/* Side-by-side amounts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-sky-950/40 border border-sky-800/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span className="text-sky-300 text-sm font-medium">System Recommendation</span>
          </div>
          <div className="text-2xl font-bold text-sky-100">{fmtINR(d.recommended?.amount)}</div>
          {d.recommended?.setAt && (
            <div className="text-xs text-sky-400/70 mt-1">Set {fmtDate(d.recommended.setAt)} by {d.recommended.setBy ?? "system"}</div>
          )}
          {d.recommended?.breakdown && (
            <div className="mt-3">
              <p className="text-xs text-zinc-500 mb-1">Breakdown</p>
              <div className="space-y-0.5">
                {Object.entries(d.recommended.breakdown).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-zinc-400 capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="text-zinc-200">{typeof v === "number" ? fmtINR(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`rounded-lg p-4 border ${d.isOverridden ? "bg-amber-950/40 border-amber-800/50" : "bg-emerald-950/40 border-emerald-800/50"}`}>
          <div className="flex items-center gap-2 mb-3">
            {d.isOverridden ? <Edit className="w-4 h-4 text-amber-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span className={`text-sm font-medium ${d.isOverridden ? "text-amber-300" : "text-emerald-300"}`}>
              {d.isOverridden ? `Actual (Override #${d.overrideCount})` : "Actual Settlement"}
            </span>
          </div>
          <div className={`text-2xl font-bold ${d.isOverridden ? "text-amber-100" : "text-emerald-100"}`}>{fmtINR(d.actual?.amount)}</div>
          {d.actual?.lastOverriddenAt && (
            <div className="text-xs text-amber-400/70 mt-1">Last overridden {fmtDate(d.actual.lastOverriddenAt)} by {d.actual.lastOverriddenBy} ({d.actual.lastOverriddenByRole})</div>
          )}
          {d.actual?.overrideRemarks && (
            <div className="mt-2 text-xs text-amber-200/70 italic">"{d.actual.overrideRemarks}"</div>
          )}
        </div>
      </div>

      {/* Delta */}
      <div className={`rounded-lg p-4 border flex items-center gap-4 ${unchanged ? "bg-zinc-800 border-zinc-600" : isUp ? "bg-emerald-950/30 border-emerald-800/40" : "bg-red-950/30 border-red-800/40"}`}>
        {unchanged ? <ArrowRight className="w-5 h-5 text-zinc-400" /> : isUp ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
        <div>
          <div className="text-sm font-medium text-zinc-200">
            {unchanged ? "No change from recommendation" : `${isUp ? "+" : ""}${fmtINR(diff)} (${isUp ? "+" : ""}${pct.toFixed(1)}%) from recommendation`}
          </div>
          <div className="text-xs text-zinc-400 capitalize">{d.delta?.direction}</div>
        </div>
      </div>

      {/* Finalization info */}
      {d.finalization && (
        <div className="rounded-lg bg-emerald-950/40 border border-emerald-800/50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span className="text-emerald-300 text-xs font-medium">Finalized</span>
          </div>
          <div className="text-xs text-zinc-300">
            By <strong>{d.finalization.finalizedBy}</strong> ({d.finalization.finalizedByRole}) on {fmtDate(d.finalization.finalizedAt)}
          </div>
          {d.finalization.notes && <div className="text-xs text-zinc-400 italic mt-1">"{d.finalization.notes}"</div>}
        </div>
      )}

      {/* Override timeline */}
      {d.overrideTimeline?.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 font-medium mb-2 uppercase tracking-wide">Override History ({d.overrideTimeline.length})</p>
          <div className="space-y-2">
            {d.overrideTimeline.map((ot: any, i: number) => (
              <div key={i} className="rounded-lg bg-zinc-800 border border-zinc-700 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-amber-300 font-medium">Override #{d.overrideTimeline.length - i}</span>
                  <span className="text-zinc-500">{fmtDate(ot.performedAt)}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-zinc-400">{fmtINR(ot.previousAmount)} <ArrowRight className="inline w-3 h-3" /> <span className="text-zinc-100">{fmtINR(ot.newAmount)}</span></span>
                </div>
                <div className="text-zinc-300">By <strong>{ot.performedBy}</strong> ({ot.performedByRole})</div>
                {ot.remarks && <div className="text-zinc-400 italic">"{ot.remarks}"</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit timeline ────────────────────────────────────────────────────────

function AuditTimeline({ recordId }: { recordId: string }) {
  const { data, isLoading } = useGetSettlementAudit(recordId);

  if (isLoading) return <div className="text-zinc-500 text-sm p-4">Loading audit trail…</div>;

  const events: any[] = (data as any)?.events ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-4 h-4 text-sky-400" />
        <span className="text-sm text-sky-300 font-medium">Immutable Audit Trail — {events.length} events</span>
        <span className="text-xs text-zinc-500">(append-only, never modified or deleted)</span>
      </div>
      {events.length === 0 && <p className="text-zinc-500 text-sm">No events yet.</p>}
      <div className="relative pl-5 space-y-0">
        {events.map((ev, i) => {
          const cfg = EVENT_CONFIG[ev.eventType] ?? { label: ev.eventType, color: "text-zinc-400" };
          return (
            <div key={ev.id} className="relative flex gap-3 pb-4">
              {/* Timeline line */}
              {i < events.length - 1 && (
                <div className="absolute left-0 top-4 bottom-0 w-px bg-zinc-700" style={{ left: "-12px" }} />
              )}
              <div className={`absolute w-2 h-2 rounded-full mt-1.5 bg-zinc-600 border border-zinc-500`} style={{ left: "-16px" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                  {ev.newStatus && <StatusBadge status={ev.newStatus} />}
                  <span className="text-zinc-600 text-xs ml-auto">{fmtDate(ev.performedAt)}</span>
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {ev.performedByName && <span>By <strong className="text-zinc-300">{ev.performedByName}</strong>{ev.performedByRole ? ` (${ev.performedByRole})` : ""}</span>}
                </div>
                {(ev.previousAmount != null || ev.newAmount != null) && (
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Amount: {fmtINR(ev.previousAmount)} <ArrowRight className="inline w-3 h-3" /> <span className="text-zinc-200">{fmtINR(ev.newAmount)}</span>
                  </div>
                )}
                {ev.remarks && (
                  <div className="text-xs text-zinc-400 italic mt-0.5 bg-zinc-800/50 rounded px-2 py-1">"{ev.remarks}"</div>
                )}
                {ev.metadata && (
                  <details className="mt-1">
                    <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-400">View metadata</summary>
                    <pre className="text-xs text-zinc-500 bg-zinc-900 rounded p-2 mt-1 overflow-x-auto">{JSON.stringify(ev.metadata, null, 2)}</pre>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail panel (right side) ─────────────────────────────────────────────

function RecordDetail({
  recordId,
  onOverride,
  onFinalize,
  onDispute,
  onReopen,
}: {
  recordId: string;
  onOverride: (id: string, actual: string | null) => void;
  onFinalize: (id: string, record: any) => void;
  onDispute: (id: string) => void;
  onReopen: (id: string) => void;
}) {
  const { role } = useRole();
  const isAdmin = role === "admin";
  const isAdminOrDev = role === "admin" || role === "developer";

  const { data, isLoading } = useGetSettlementRecord(recordId);
  const record = (data as any)?.record;

  if (isLoading) return <div className="text-zinc-500 text-sm p-6">Loading…</div>;
  if (!record) return <div className="text-zinc-500 text-sm p-6">Record not found.</div>;

  const isFinalized = record.status === "finalized";
  const isDraft = record.status === "draft";
  const canOverride = !isFinalized && !isDraft;
  const canFinalize = isAdminOrDev && !isFinalized && !isDraft && record.status !== "disputed";
  const canDispute = isAdminOrDev && !isFinalized;
  const canReopen = isAdmin && isFinalized;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold text-zinc-100">{record.periodLabel}</div>
          <div className="text-xs text-zinc-400 mt-0.5">
            {record.projectName} {record.partnerName ? `· ${record.partnerName}` : ""}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5 capitalize">{record.settlementType.replace("_", " ")} settlement</div>
        </div>
        <StatusBadge status={record.status} />
      </div>

      {/* Amounts summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-zinc-800 border border-zinc-700 p-3">
          <div className="text-xs text-zinc-500 mb-1">Recommended</div>
          <div className="text-lg font-bold text-sky-300">{fmtINR(record.recommendedAmount)}</div>
          {record.recommendedByName && <div className="text-xs text-zinc-500 mt-0.5">by {record.recommendedByName}</div>}
        </div>
        <div className={`rounded-lg border p-3 ${record.isOverridden ? "bg-amber-950/40 border-amber-800/50" : "bg-zinc-800 border-zinc-700"}`}>
          <div className="text-xs text-zinc-500 mb-1">Actual</div>
          <div className={`text-lg font-bold ${record.isOverridden ? "text-amber-300" : "text-zinc-100"}`}>{fmtINR(record.actualAmount)}</div>
          {record.isOverridden && <div className="text-xs text-amber-400/70 mt-0.5">Override #{record.overrideCount}</div>}
        </div>
      </div>

      {record.isOverridden && record.overrideRemarks && (
        <div className="rounded bg-amber-950/30 border border-amber-800/40 px-3 py-2 text-xs text-amber-200/80 italic">
          Override note: "{record.overrideRemarks}"
        </div>
      )}

      {isFinalized && (
        <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-3 text-xs text-emerald-300">
          <div className="flex items-center gap-1 font-medium mb-1"><Lock className="w-3 h-3" /> Finalized by {record.finalizedByName} ({record.finalizedByRole})</div>
          <div className="text-emerald-400/70">{fmtDate(record.finalizedAt)}</div>
          {record.finalizationNotes && <div className="text-emerald-300/70 mt-1 italic">"{record.finalizationNotes}"</div>}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {canOverride && (
          <Button size="sm" onClick={() => onOverride(record.id, record.actualAmount)} className="bg-amber-700 hover:bg-amber-600 text-white gap-1">
            <Edit className="w-3 h-3" /> Override
          </Button>
        )}
        {canFinalize && (
          <Button size="sm" onClick={() => onFinalize(record.id, record)} className="bg-emerald-700 hover:bg-emerald-600 text-white gap-1">
            <Lock className="w-3 h-3" /> Finalize
          </Button>
        )}
        {canDispute && (
          <Button size="sm" variant="outline" onClick={() => onDispute(record.id)} className="border-red-700 text-red-400 hover:bg-red-950 gap-1">
            <Flag className="w-3 h-3" /> Dispute
          </Button>
        )}
        {canReopen && (
          <Button size="sm" variant="outline" onClick={() => onReopen(record.id)} className="border-violet-700 text-violet-400 hover:bg-violet-950 gap-1">
            <Unlock className="w-3 h-3" /> Reopen
          </Button>
        )}
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="comparison">
        <TabsList className="bg-zinc-800 border-zinc-700 border">
          <TabsTrigger value="comparison" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-zinc-100 text-xs gap-1">
            <GitCompare className="w-3 h-3" /> Comparison
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-zinc-100 text-xs gap-1">
            <History className="w-3 h-3" /> Audit Trail
          </TabsTrigger>
        </TabsList>
        <TabsContent value="comparison" className="mt-3">
          <ComparisonPanel recordId={recordId} />
        </TabsContent>
        <TabsContent value="audit" className="mt-3">
          <AuditTimeline recordId={recordId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function FinalSettlement() {
  const { role } = useRole();
  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [filterProject, setFilterProject] = useState("");
  const [filterPartner, setFilterPartner] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{ id: string; actual: string | null } | null>(null);
  const [finalizeTarget, setFinalizeTarget] = useState<{ id: string; record: any } | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<string | null>(null);

  const { data: projectsData } = useListProjects();
  const { data: partnersData } = useListPartners();
  const projectOptions: Array<{ id: string; name: string }> = (projectsData as any)?.projects ?? [];
  const partnerOptions: Array<{ id: string; name: string }> = (partnersData as any)?.partners ?? [];

  const { data: listData, isLoading, refetch } = useListSettlementRecords({
    projectId: filterProject || undefined,
    partnerId: filterPartner || undefined,
    status: filterStatus || undefined,
    type: filterType || undefined,
  } as any);
  const records: any[] = (listData as any)?.records ?? [];

  const STATUSES = ["draft", "recommended", "overridden", "finalized", "disputed"];
  const TYPES = [
    { value: "fifty_pct", label: "50% Revenue" },
    { value: "payable", label: "Partner Payable" },
    { value: "lca", label: "LCA" },
    { value: "loss_absorption", label: "Loss Absorption" },
    { value: "manual", label: "Manual" },
  ];

  // Summary KPIs
  const total = records.length;
  const finalized = records.filter((r) => r.status === "finalized").length;
  const overridden = records.filter((r) => r.status === "overridden").length;
  const disputed = records.filter((r) => r.status === "disputed").length;
  const pending = records.filter((r) => ["draft", "recommended"].includes(r.status)).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Final Settlement</h1>
          <p className="text-zinc-400 text-sm mt-1">Manual override and finalization with full immutable audit trail</p>
        </div>
        {isAdminOrDev && (
          <Button onClick={() => setShowCreate(true)} className="bg-emerald-700 hover:bg-emerald-600 text-white gap-2">
            <Plus className="w-4 h-4" /> New Settlement Record
          </Button>
        )}
      </div>

      {/* Authority banner */}
      <div className="rounded-lg bg-zinc-900 border border-zinc-700 p-4 flex flex-wrap gap-6">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-sky-400" />
          <span className="text-zinc-400">Any partner may</span>
          <span className="text-zinc-200 font-medium">override recommendations</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-zinc-400">Project Developer has</span>
          <span className="text-zinc-200 font-medium">final authority to finalize</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="w-4 h-4 text-violet-400" />
          <span className="text-zinc-200 font-medium">All actions create immutable audit records</span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Records", value: total, color: "text-zinc-100" },
          { label: "Pending", value: pending, color: "text-sky-300" },
          { label: "Overridden", value: overridden, color: "text-amber-300" },
          { label: "Disputed", value: disputed, color: "text-red-300" },
          { label: "Finalized", value: finalized, color: "text-emerald-300" },
        ].map((k) => (
          <Card key={k.label} className="bg-zinc-900 border-zinc-700">
            <CardContent className="pt-4 pb-3">
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select value={filterProject || "__all__"} onValueChange={(v) => setFilterProject(v === "__all__" ? "" : v)}>
          <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 w-48">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-600">
            <SelectItem value="__all__" className="text-zinc-400">All projects</SelectItem>
            {projectOptions.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-zinc-100">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterPartner || "__all__"} onValueChange={(v) => setFilterPartner(v === "__all__" ? "" : v)}>
          <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 w-44">
            <SelectValue placeholder="All partners" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-600">
            <SelectItem value="__all__" className="text-zinc-400">All partners</SelectItem>
            {partnerOptions.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-zinc-100">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus || "__all__"} onValueChange={(v) => setFilterStatus(v === "__all__" ? "" : v)}>
          <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-600">
            <SelectItem value="__all__" className="text-zinc-400">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-zinc-100 capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterType || "__all__"} onValueChange={(v) => setFilterType(v === "__all__" ? "" : v)}>
          <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 w-44">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-600">
            <SelectItem value="__all__" className="text-zinc-400">All types</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-zinc-100">{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="ghost" size="icon" onClick={() => refetch()} className="text-zinc-400 hover:text-zinc-100">
          <RefreshCcw className="w-4 h-4" />
        </Button>
      </div>

      {/* Main layout: table + detail panel */}
      <div className={`grid gap-4 ${selectedId ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Records table */}
        <Card className="bg-zinc-900 border-zinc-700">
          <CardHeader className="py-3 px-4 border-b border-zinc-700">
            <CardTitle className="text-sm text-zinc-300">{records.length} settlement record{records.length !== 1 ? "s" : ""}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-zinc-500 text-sm p-6">Loading…</div>
            ) : records.length === 0 ? (
              <div className="text-zinc-500 text-sm p-6 text-center">
                No settlement records found.
                {isAdminOrDev && <div className="mt-2"><Button size="sm" onClick={() => setShowCreate(true)} className="bg-emerald-700 hover:bg-emerald-600 text-white gap-1"><Plus className="w-3 h-3" />Create one</Button></div>}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-700 hover:bg-zinc-800/30">
                    <TableHead className="text-zinc-400 text-xs">Period / Project</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Recommended</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Actual</TableHead>
                    <TableHead className="text-zinc-400 text-xs">Status</TableHead>
                    <TableHead className="text-zinc-400 text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow
                      key={r.id}
                      className={`border-zinc-800 cursor-pointer transition-colors ${selectedId === r.id ? "bg-zinc-800/60" : "hover:bg-zinc-800/30"}`}
                      onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                    >
                      <TableCell className="py-2">
                        <div className="font-medium text-zinc-200 text-sm">{r.periodLabel}</div>
                        <div className="text-xs text-zinc-500">
                          {r.projectName ?? "—"}{r.partnerName ? ` · ${r.partnerName}` : ""}
                        </div>
                        <div className="text-xs text-zinc-600 capitalize mt-0.5">{r.settlementType?.replace("_", " ")}</div>
                      </TableCell>
                      <TableCell className="text-sky-300 text-sm font-medium py-2">
                        {fmtINR(r.recommendedAmount)}
                      </TableCell>
                      <TableCell className={`text-sm font-medium py-2 ${r.isOverridden ? "text-amber-300" : "text-zinc-200"}`}>
                        {fmtINR(r.actualAmount)}
                        {r.isOverridden && <div className="text-xs text-amber-400/60">Override #{r.overrideCount}</div>}
                      </TableCell>
                      <TableCell className="py-2">
                        <StatusBadge status={r.status} />
                        {r.status === "finalized" && (
                          <div className="text-xs text-zinc-500 mt-0.5">{fmtDate(r.finalizedAt)}</div>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <Button size="icon" variant="ghost" className="w-7 h-7 text-zinc-400 hover:text-zinc-100" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>
                          <Eye className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Detail panel */}
        {selectedId && (
          <Card className="bg-zinc-900 border-zinc-700">
            <CardHeader className="py-3 px-4 border-b border-zinc-700 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-zinc-300">Settlement Detail</CardTitle>
              <Button size="icon" variant="ghost" className="w-6 h-6 text-zinc-500 hover:text-zinc-100" onClick={() => setSelectedId(null)}>×</Button>
            </CardHeader>
            <CardContent className="p-4 overflow-y-auto max-h-[75vh]">
              <RecordDetail
                recordId={selectedId}
                onOverride={(id, actual) => setOverrideTarget({ id, actual })}
                onFinalize={(id, rec) => setFinalizeTarget({ id, record: rec })}
                onDispute={(id) => setDisputeTarget(id)}
                onReopen={(id) => setReopenTarget(id)}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialogs */}
      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        projectOptions={projectOptions}
        partnerOptions={partnerOptions}
      />
      <OverrideDialog
        open={!!overrideTarget}
        onClose={() => setOverrideTarget(null)}
        recordId={overrideTarget?.id ?? null}
        currentActual={overrideTarget?.actual ?? null}
      />
      <FinalizeDialog
        open={!!finalizeTarget}
        onClose={() => setFinalizeTarget(null)}
        recordId={finalizeTarget?.id ?? null}
        record={finalizeTarget?.record}
      />
      <DisputeDialog
        open={!!disputeTarget}
        onClose={() => setDisputeTarget(null)}
        recordId={disputeTarget}
      />
      <ReopenDialog
        open={!!reopenTarget}
        onClose={() => setReopenTarget(null)}
        recordId={reopenTarget}
      />
    </div>
  );
}
