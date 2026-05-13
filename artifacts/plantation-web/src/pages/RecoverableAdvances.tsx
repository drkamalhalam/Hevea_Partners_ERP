import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import {
  useGetAdvanceSummary,
  useListAdvances,
  useGetAdvance,
  useCreateAdvance,
  useUpdateAdvance,
  useAcknowledgeAdvance,
  useRecordAdvanceRecovery,
  useWriteOffAdvance,
  useListProjects,
  useListPartners,
  getListAdvancesQueryKey,
  getGetAdvanceSummaryQueryKey,
  getGetAdvanceQueryKey,
} from "@workspace/api-client-react";
import type {
  RecoverableAdvance,
  RecoverableAdvanceDetail,
  AdvanceSummary,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogClose,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronDown,
  Plus,
  RefreshCw,
  HandCoins,
  Info,
  Calendar,
  Link2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  acknowledged: "Acknowledged",
  in_recovery: "In Recovery",
  recovered: "Recovered",
  written_off: "Written Off",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  raised: "Raised",
  acknowledged: "Acknowledged",
  payment: "Payment",
  deduction: "Deduction",
  written_off: "Written Off",
  note: "Note",
  recovered: "Fully Recovered",
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 border-amber-200",
    acknowledged: "bg-blue-100 text-blue-800 border-blue-200",
    in_recovery: "bg-indigo-100 text-indigo-800 border-indigo-200",
    recovered: "bg-emerald-100 text-emerald-800 border-emerald-200",
    written_off: "bg-slate-100 text-slate-500 border-slate-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        styles[status] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    developer: "bg-sky-100 text-sky-800",
    landowner: "bg-orange-100 text-orange-800",
    other: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium capitalize",
        styles[role] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {role.replace(/_/g, " ")}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    raised: "bg-blue-50 text-blue-700",
    acknowledged: "bg-sky-50 text-sky-700",
    payment: "bg-emerald-50 text-emerald-700",
    deduction: "bg-purple-50 text-purple-700",
    written_off: "bg-slate-100 text-slate-500",
    note: "bg-slate-50 text-slate-600",
    recovered: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-xs font-medium",
        styles[type] ?? "bg-slate-100 text-slate-600",
      )}
    >
      {EVENT_TYPE_LABELS[type] ?? type}
    </span>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  alert,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  alert?: boolean;
}) {
  return (
    <Card className={cn("bg-slate-800 border-slate-700", alert && "border-amber-500/50")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 mb-1">{title}</p>
            <p className={cn("text-xl font-bold", alert ? "text-amber-400" : "text-slate-100")}>
              {value}
            </p>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </div>
          <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", alert ? "text-amber-400" : "text-slate-500")} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── New Advance Dialog ────────────────────────────────────────────────────────

function NewAdvanceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const { data: projects } = useListProjects();
  const { data: partners } = useListPartners();
  const createMutation = useCreateAdvance();

  const [form, setForm] = useState({
    projectId: "",
    advancedByPartnerId: "",
    advancedByName: "",
    advancedByRole: "developer",
    responsiblePartyRole: "landowner",
    responsiblePartnerId: "",
    responsiblePartnerName: "",
    originalAmount: "",
    description: "",
    advancedDate: todayStr(),
    dueDate: "",
    recoveryMethod: "",
    notes: "",
  });

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function handleSubmit() {
    if (!form.projectId || !form.advancedByName || !form.description || !form.advancedDate) {
      toast({ title: "Required fields missing", variant: "destructive" });
      return;
    }
    const amount = parseFloat(form.originalAmount);
    if (!amount || amount <= 0) {
      toast({ title: "Amount must be positive", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      {
        data: {
          projectId: form.projectId,
          advancedByPartnerId: form.advancedByPartnerId || undefined,
          advancedByName: form.advancedByName,
          advancedByRole: form.advancedByRole as "developer" | "landowner" | "other",
          responsiblePartyRole: form.responsiblePartyRole as "developer" | "landowner",
          responsiblePartnerId: form.responsiblePartnerId || undefined,
          responsiblePartnerName: form.responsiblePartnerName || undefined,
          originalAmount: amount,
          description: form.description,
          advancedDate: form.advancedDate,
          dueDate: form.dueDate || undefined,
          recoveryMethod: (form.recoveryMethod || undefined) as
            | "direct_payment"
            | "share_deduction"
            | "settlement"
            | undefined,
          notes: form.notes || undefined,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Advance recorded" });
          onCreated();
          onClose();
        },
        onError: () => toast({ title: "Failed to create advance", variant: "destructive" }),
      },
    );
  }

  const activePartners = (partners ?? []).filter((p: { isActive?: boolean }) => p.isActive !== false);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Record Recoverable Advance</DialogTitle>
          <p className="text-xs text-slate-400">
            Documents a temporary payment made on behalf of another party. This does{" "}
            <strong>not</strong> create or alter any ownership rights.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label className="text-slate-300 text-xs">Project *</Label>
            <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 mt-1">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {(projects ?? []).map((p: { id: string; name: string }) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-100">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label className="text-slate-300 text-xs">Description *</Label>
            <Input
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              placeholder="e.g. Developer paid landowner-side fertilizer cost"
              value={form.description}
              onChange={field("description")}
            />
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Amount Paid (₹) *</Label>
            <Input
              type="number"
              min="1"
              step="0.01"
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              placeholder="0.00"
              value={form.originalAmount}
              onChange={field("originalAmount")}
            />
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Advanced Date *</Label>
            <Input
              type="date"
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              value={form.advancedDate}
              onChange={field("advancedDate")}
            />
          </div>

          <div className="col-span-2 border-t border-slate-700 pt-2">
            <p className="text-xs text-slate-400 font-medium mb-2">Who paid?</p>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Payer Name *</Label>
            <Input
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              placeholder="Name of party who paid"
              value={form.advancedByName}
              onChange={field("advancedByName")}
            />
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Payer Role</Label>
            <Select
              value={form.advancedByRole}
              onValueChange={(v) => setForm((f) => ({ ...f, advancedByRole: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="developer" className="text-slate-100">Developer</SelectItem>
                <SelectItem value="landowner" className="text-slate-100">Landowner</SelectItem>
                <SelectItem value="other" className="text-slate-100">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label className="text-slate-300 text-xs">Link to Partner (optional)</Label>
            <Select
              value={form.advancedByPartnerId}
              onValueChange={(v) => setForm((f) => ({ ...f, advancedByPartnerId: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 mt-1">
                <SelectValue placeholder="Select partner (optional)" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="" className="text-slate-400">None</SelectItem>
                {activePartners.map((p: { id: string; name: string }) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-100">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 border-t border-slate-700 pt-2">
            <p className="text-xs text-slate-400 font-medium mb-2">Who is responsible?</p>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Responsible Party Role</Label>
            <Select
              value={form.responsiblePartyRole}
              onValueChange={(v) => setForm((f) => ({ ...f, responsiblePartyRole: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="developer" className="text-slate-100">Developer</SelectItem>
                <SelectItem value="landowner" className="text-slate-100">Landowner</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Responsible Partner Name</Label>
            <Input
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              placeholder="Optional"
              value={form.responsiblePartnerName}
              onChange={field("responsiblePartnerName")}
            />
          </div>

          <div className="col-span-2 border-t border-slate-700 pt-2">
            <p className="text-xs text-slate-400 font-medium mb-2">Recovery details (optional)</p>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Expected Recovery Date</Label>
            <Input
              type="date"
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              value={form.dueDate}
              onChange={field("dueDate")}
            />
          </div>

          <div>
            <Label className="text-slate-300 text-xs">Recovery Method</Label>
            <Select
              value={form.recoveryMethod}
              onValueChange={(v) => setForm((f) => ({ ...f, recoveryMethod: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 mt-1">
                <SelectValue placeholder="Not specified" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="" className="text-slate-400">Not specified</SelectItem>
                <SelectItem value="direct_payment" className="text-slate-100">Direct Payment</SelectItem>
                <SelectItem value="share_deduction" className="text-slate-100">Share Deduction</SelectItem>
                <SelectItem value="settlement" className="text-slate-100">Settlement</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label className="text-slate-300 text-xs">Notes</Label>
            <Textarea
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1 resize-none"
              rows={2}
              placeholder="Context or remarks..."
              value={form.notes}
              onChange={field("notes")}
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="text-slate-400">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            {createMutation.isPending ? "Saving..." : "Record Advance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record Recovery Dialog ────────────────────────────────────────────────────

function RecordRecoveryDialog({
  advance,
  open,
  onClose,
  onDone,
}: {
  advance: RecoverableAdvance;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const recoverMutation = useRecordAdvanceRecovery();
  const [form, setForm] = useState({
    amount: "",
    method: "direct_payment",
    notes: "",
    eventDate: todayStr(),
  });

  const remaining = advance.remainingAmount;

  function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    if (amount > remaining) {
      toast({ title: `Amount exceeds remaining balance (${fmtINR(remaining)})`, variant: "destructive" });
      return;
    }
    recoverMutation.mutate(
      {
        id: advance.id,
        data: {
          amount,
          method: form.method as "direct_payment" | "share_deduction" | "settlement",
          notes: form.notes || undefined,
          eventDate: form.eventDate,
        },
      },
      {
        onSuccess: () => {
          toast({ title: amount >= remaining ? "Advance fully recovered" : "Recovery recorded" });
          onDone();
          onClose();
        },
        onError: () => toast({ title: "Failed to record recovery", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Record Recovery</DialogTitle>
          <p className="text-xs text-slate-400">
            Remaining: <strong className="text-slate-200">{fmtINR(remaining)}</strong>
          </p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-slate-300 text-xs">Amount Recovered (₹)</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              placeholder={remaining.toString()}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-slate-300 text-xs">Recovery Method</Label>
            <Select
              value={form.method}
              onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-100 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="direct_payment" className="text-slate-100">Direct Payment</SelectItem>
                <SelectItem value="share_deduction" className="text-slate-100">Share Deduction</SelectItem>
                <SelectItem value="settlement" className="text-slate-100">Settlement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-300 text-xs">Date</Label>
            <Input
              type="date"
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              value={form.eventDate}
              onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-slate-300 text-xs">Notes</Label>
            <Input
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1"
              placeholder="Optional"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="text-slate-400">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={recoverMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {recoverMutation.isPending ? "Saving..." : "Record Recovery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Write-Off Dialog ──────────────────────────────────────────────────────────

function WriteOffDialog({
  advance,
  open,
  onClose,
  onDone,
}: {
  advance: RecoverableAdvance;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const writeOffMutation = useWriteOffAdvance();
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Write Off Advance</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div className="rounded-md bg-amber-900/30 border border-amber-600/30 p-3 text-xs text-amber-200">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
            Writing off this advance forfeits recovery of{" "}
            <strong>{fmtINR(advance.remainingAmount)}</strong>. This has{" "}
            <strong>no effect on ownership or equity.</strong>
          </div>
          <div>
            <Label className="text-slate-300 text-xs">Notes / Reason</Label>
            <Textarea
              className="bg-slate-800 border-slate-600 text-slate-100 mt-1 resize-none"
              rows={3}
              placeholder="Why is this advance being written off?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="text-slate-400">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() =>
              writeOffMutation.mutate(
                { id: advance.id, data: { notes: notes || undefined } },
                {
                  onSuccess: () => {
                    toast({ title: "Advance written off" });
                    onDone();
                    onClose();
                  },
                  onError: () => toast({ title: "Failed to write off advance", variant: "destructive" }),
                },
              )
            }
            disabled={writeOffMutation.isPending}
            className="bg-red-700 hover:bg-red-600 text-white"
          >
            {writeOffMutation.isPending ? "Writing off..." : "Write Off"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Advance Detail Drawer ─────────────────────────────────────────────────────

function AdvanceDetailPanel({
  advanceId,
  onClose,
}: {
  advanceId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useGetAdvance(advanceId);
  const advance = data as RecoverableAdvanceDetail | undefined;

  if (isLoading) {
    return (
      <div className="p-4 text-slate-400 text-sm">Loading…</div>
    );
  }
  if (!advance) return null;

  return (
    <div className="bg-slate-800/60 border-t border-slate-700 p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-100">{advance.description}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Project: {advance.projectName ?? advance.projectId}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-slate-400 h-7 px-2" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-slate-500">Original</p>
          <p className="text-slate-200 font-medium">{fmtINR(advance.originalAmount)}</p>
        </div>
        <div>
          <p className="text-slate-500">Recovered</p>
          <p className="text-emerald-400 font-medium">{fmtINR(advance.recoveredAmount)}</p>
        </div>
        <div>
          <p className="text-slate-500">Remaining</p>
          <p
            className={cn(
              "font-medium",
              advance.remainingAmount > 0 ? "text-amber-400" : "text-emerald-400",
            )}
          >
            {fmtINR(advance.remainingAmount)}
          </p>
        </div>
      </div>

      {advance.notes && (
        <p className="text-xs text-slate-400 italic">{advance.notes}</p>
      )}

      {advance.recoveryNotes && (
        <p className="text-xs text-slate-400 italic border-l-2 border-slate-600 pl-2">
          Recovery notes: {advance.recoveryNotes}
        </p>
      )}

      <div>
        <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wide">
          Adjustment History
        </p>
        <div className="space-y-2">
          {(advance.events ?? []).map((ev, i) => (
            <div key={ev.id} className="flex items-start gap-2">
              <div className="flex flex-col items-center">
                <div className="h-2 w-2 rounded-full bg-slate-500 mt-1.5 shrink-0" />
                {i < (advance.events ?? []).length - 1 && (
                  <div className="w-px flex-1 bg-slate-700 mt-1" />
                )}
              </div>
              <div className="pb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <EventTypeBadge type={ev.eventType} />
                  {ev.amount !== undefined && ev.amount !== null && (
                    <span className="text-xs font-medium text-slate-200">
                      {fmtINR(ev.amount)}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">{fmtDate(ev.eventDate)}</span>
                  {ev.recordedByName && (
                    <span className="text-xs text-slate-600">· {ev.recordedByName}</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{ev.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab({
  projectFilter,
}: {
  projectFilter: string | undefined;
}) {
  const { data, isLoading } = useGetAdvanceSummary(projectFilter ? { projectId: projectFilter } : {});
  const summary = data as AdvanceSummary | undefined;

  if (isLoading) {
    return <div className="text-slate-400 text-sm py-8 text-center">Loading summary…</div>;
  }
  if (!summary) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Total Outstanding"
          value={fmtINR(summary.totalOutstanding)}
          sub={`${summary.pendingCount + summary.inRecoveryCount} open advance${summary.pendingCount + summary.inRecoveryCount !== 1 ? "s" : ""}`}
          icon={HandCoins}
          alert={summary.totalOutstanding > 0}
        />
        <KpiCard
          title="Overdue"
          value={fmtINR(summary.totalOverdue)}
          sub="Past expected recovery date"
          icon={AlertTriangle}
          alert={summary.totalOverdue > 0}
        />
        <KpiCard
          title="In Recovery"
          value={summary.inRecoveryCount.toString()}
          sub={`advance${summary.inRecoveryCount !== 1 ? "s" : ""} partially paid`}
          icon={RefreshCw}
        />
        <KpiCard
          title="Recovered"
          value={fmtINR(summary.totalRecovered)}
          sub="Fully repaid"
          icon={CheckCircle2}
        />
      </div>

      {summary.byPartyRole.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {summary.byPartyRole.map((r) => (
            <Card key={r.role} className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <RoleBadge role={r.role} />
                  <span className="text-xs text-slate-400">responsible side</span>
                </div>
                <p className="text-lg font-bold text-slate-100">{fmtINR(r.outstanding)}</p>
                <p className="text-xs text-slate-500">{r.count} open advance{r.count !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {summary.byProject.length > 0 && (
        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">Per-Project Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-xs">Project</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Outstanding</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Overdue</TableHead>
                  <TableHead className="text-slate-400 text-xs text-right">Advances</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byProject.map((p) => (
                  <TableRow key={p.projectId} className="border-slate-700 hover:bg-slate-700/30">
                    <TableCell className="text-slate-200 text-sm">{p.projectName}</TableCell>
                    <TableCell className="text-right text-sm font-medium text-amber-400">
                      {fmtINR(p.outstanding)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {p.overdue > 0 ? (
                        <span className="text-red-400">{fmtINR(p.overdue)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-slate-400 text-sm">{p.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {summary.totalOutstanding === 0 && summary.advanceCount === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          No advances recorded yet.
        </div>
      )}

      <div className="rounded-md bg-slate-800/50 border border-slate-700 p-3 text-xs text-slate-500 flex gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-600" />
        <span>
          Recoverable advances track temporary payments made on behalf of another party. Recovery
          does not affect land ownership or equity shares.
        </span>
      </div>
    </div>
  );
}

// ── Advances List Tab ─────────────────────────────────────────────────────────

function AdvancesTab({
  role,
  projectFilter,
  onRefresh,
}: {
  role: string;
  projectFilter: string | undefined;
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recoverTarget, setRecoverTarget] = useState<RecoverableAdvance | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<RecoverableAdvance | null>(null);

  const acknowledgeAdvance = useAcknowledgeAdvance();

  const params = {
    ...(projectFilter ? { projectId: projectFilter } : {}),
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(partyFilter !== "all" ? { responsiblePartyRole: partyFilter } : {}),
  };

  const { data, isLoading } = useListAdvances(params);
  const advances = (data ?? []) as RecoverableAdvance[];

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getListAdvancesQueryKey(params) });
    queryClient.invalidateQueries({ queryKey: getGetAdvanceSummaryQueryKey() });
    if (expandedId) {
      queryClient.invalidateQueries({ queryKey: getGetAdvanceQueryKey(expandedId) });
    }
    onRefresh();
  }

  function handleAcknowledge(a: RecoverableAdvance) {
    acknowledgeAdvance.mutate(
      { id: a.id, data: {} },
      {
        onSuccess: () => {
          toast({ title: "Advance acknowledged" });
          invalidateAll();
        },
        onError: () => toast({ title: "Failed to acknowledge", variant: "destructive" }),
      },
    );
  }

  const isAdminDev = role === "admin" || role === "developer";

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-300 h-8 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            <SelectItem value="all" className="text-slate-300 text-xs">All statuses</SelectItem>
            <SelectItem value="pending" className="text-slate-300 text-xs">Pending</SelectItem>
            <SelectItem value="acknowledged" className="text-slate-300 text-xs">Acknowledged</SelectItem>
            <SelectItem value="in_recovery" className="text-slate-300 text-xs">In Recovery</SelectItem>
            <SelectItem value="recovered" className="text-slate-300 text-xs">Recovered</SelectItem>
            <SelectItem value="written_off" className="text-slate-300 text-xs">Written Off</SelectItem>
          </SelectContent>
        </Select>

        <Select value={partyFilter} onValueChange={setPartyFilter}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-300 h-8 text-xs w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            <SelectItem value="all" className="text-slate-300 text-xs">All responsible parties</SelectItem>
            <SelectItem value="developer" className="text-slate-300 text-xs">Developer responsible</SelectItem>
            <SelectItem value="landowner" className="text-slate-300 text-xs">Landowner responsible</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-slate-500 ml-auto">
          {advances.length} advance{advances.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
      ) : advances.length === 0 ? (
        <div className="text-slate-500 text-sm py-8 text-center">No advances found.</div>
      ) : (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700 hover:bg-transparent">
                <TableHead className="text-slate-400 text-xs w-6" />
                <TableHead className="text-slate-400 text-xs">Description</TableHead>
                <TableHead className="text-slate-400 text-xs">Payer → Responsible</TableHead>
                <TableHead className="text-slate-400 text-xs text-right">Original</TableHead>
                <TableHead className="text-slate-400 text-xs text-right">Remaining</TableHead>
                <TableHead className="text-slate-400 text-xs">Status</TableHead>
                <TableHead className="text-slate-400 text-xs">Date</TableHead>
                {isAdminDev && <TableHead className="text-slate-400 text-xs" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {advances.map((a) => (
                <>
                  <TableRow
                    key={a.id}
                    className={cn(
                      "border-slate-700 cursor-pointer hover:bg-slate-700/30",
                      expandedId === a.id && "bg-slate-700/30",
                    )}
                    onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                  >
                    <TableCell className="py-2 px-3">
                      {expandedId === a.id ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <p className="text-sm text-slate-200 leading-tight">{a.description}</p>
                      {a.projectName && (
                        <p className="text-xs text-slate-500">{a.projectName}</p>
                      )}
                      {a.isOverdue && a.status !== "recovered" && a.status !== "written_off" && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-red-400 mt-0.5">
                          <AlertTriangle className="h-3 w-3" /> Overdue
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        <RoleBadge role={a.advancedByRole} />
                        <span className="text-slate-500 text-xs">→</span>
                        <RoleBadge role={a.responsiblePartyRole} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {a.advancedByName}
                        {a.responsiblePartnerName ? ` → ${a.responsiblePartnerName}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm text-slate-300">
                      {fmtINR(a.originalAmount)}
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm">
                      {a.remainingAmount > 0 ? (
                        <span className="text-amber-400">{fmtINR(a.remainingAmount)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="py-2 text-xs text-slate-400">
                      {fmtDate(a.advancedDate)}
                      {a.dueDate && (
                        <p className="text-slate-600">Due: {fmtDate(a.dueDate)}</p>
                      )}
                    </TableCell>
                    {isAdminDev && (
                      <TableCell className="py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {a.status === "pending" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-sky-400 hover:text-sky-300 hover:bg-sky-900/30"
                                  onClick={() => handleAcknowledge(a)}
                                  disabled={acknowledgeAdvance.isPending}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Acknowledge</TooltipContent>
                            </Tooltip>
                          )}
                          {(a.status === "pending" ||
                            a.status === "acknowledged" ||
                            a.status === "in_recovery") && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30"
                                    onClick={() => setRecoverTarget(a)}
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Record Recovery</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-900/30"
                                    onClick={() => setWriteOffTarget(a)}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Write Off</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  {expandedId === a.id && (
                    <TableRow key={`${a.id}-detail`} className="border-slate-700">
                      <TableCell colSpan={isAdminDev ? 8 : 7} className="p-0">
                        <AdvanceDetailPanel
                          advanceId={a.id}
                          onClose={() => setExpandedId(null)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {recoverTarget && (
        <RecordRecoveryDialog
          advance={recoverTarget}
          open
          onClose={() => setRecoverTarget(null)}
          onDone={invalidateAll}
        />
      )}
      {writeOffTarget && (
        <WriteOffDialog
          advance={writeOffTarget}
          open
          onClose={() => setWriteOffTarget(null)}
          onDone={invalidateAll}
        />
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RecoverableAdvances() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const { data: projects } = useListProjects();

  const [tab, setTab] = useState("dashboard");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [showNewDialog, setShowNewDialog] = useState(false);

  const isAdminDev = role === "admin" || role === "developer";
  const activeProjectId = projectFilter !== "all" ? projectFilter : undefined;

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: getGetAdvanceSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAdvancesQueryKey() });
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <HandCoins className="h-6 w-6 text-indigo-400" />
            Recoverable Advances
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Track temporary payments made on behalf of another party, with full reimbursement history.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-300 h-8 text-xs w-48">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-600">
              <SelectItem value="all" className="text-slate-300 text-xs">All projects</SelectItem>
              {(projects ?? []).map((p: { id: string; name: string }) => (
                <SelectItem key={p.id} value={p.id} className="text-slate-300 text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdminDev && (
            <Button
              size="sm"
              className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white text-xs gap-1.5"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Advance
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="dashboard" className="data-[state=active]:bg-slate-700 text-slate-300 text-xs">
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="advances" className="data-[state=active]:bg-slate-700 text-slate-300 text-xs">
            Advances
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab projectFilter={activeProjectId} />
        </TabsContent>

        <TabsContent value="advances" className="mt-4">
          <AdvancesTab
            role={role ?? "employee"}
            projectFilter={activeProjectId}
            onRefresh={refreshAll}
          />
        </TabsContent>
      </Tabs>

      {showNewDialog && (
        <NewAdvanceDialog
          open
          onClose={() => setShowNewDialog(false)}
          onCreated={refreshAll}
        />
      )}
    </div>
  );
}
