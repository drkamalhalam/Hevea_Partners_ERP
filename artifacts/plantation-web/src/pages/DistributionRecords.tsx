/**
 * DistributionRecords.tsx
 *
 * Distribution Record & Payment History System
 *
 * Four views:
 *   Dashboard    — KPI cards + payment rate + by-status breakdown + bar chart
 *   History      — Full records list with partner payment history drill-down
 *   Pending      — Pending payable report (balance > 0)
 *   Archive      — Complete settlement archive (all historical, permanent)
 *
 * Rules enforced in UI:
 *   - Permanent records (isPermanentRecord=true) cannot be archived
 *   - Only admin/developer may create, record payments, carry-forward, archive
 *   - All records are permanently preserved — no hard deletes exposed
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import {
  useListDistributionRecords,
  useCreateDistributionRecord,
  useGetDistributionRecord,
  useUpdateDistributionRecord,
  useRecordDistributionPayment,
  useCarryForwardDistributionRecord,
  useArchiveDistributionRecord,
  useListDistributionPaymentEvents,
  useGetDistributionSummary,
  useGetDistributionPendingPayable,
  useGetDistributionArchive,
} from "@workspace/api-client-react";
import type { DistributionRecord, DistributionPaymentEvent } from "@workspace/api-client-react";
import { useListProjects } from "@workspace/api-client-react";
import { useListPartners } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Database, Plus, CreditCard, ArrowDownToLine, Archive, Eye, RefreshCw,
  CheckCircle, AlertCircle, Clock, TrendingDown, FileText, History,
  IndianRupee, Percent, ChevronRight, Shield, Lock,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────

const fmt = (v: string | number | null | undefined) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    Number(v ?? 0)
  );

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_STYLES: Record<string, string> = {
  draft:          "bg-slate-700 text-slate-200",
  pending:        "bg-amber-900/60 text-amber-300",
  partial:        "bg-blue-900/60 text-blue-300",
  paid:           "bg-emerald-900/60 text-emerald-300",
  carried_forward:"bg-purple-900/60 text-purple-300",
  archived:       "bg-slate-800 text-slate-400",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending", partial: "Partial", paid: "Paid",
  carried_forward: "Carried Forward", archived: "Archived",
};

const EVENT_ICONS: Record<string, React.ReactNode> = {
  created:               <Plus size={12} />,
  payment_recorded:      <CheckCircle size={12} className="text-emerald-400" />,
  partial_payment:       <CreditCard size={12} className="text-blue-400" />,
  status_changed:        <RefreshCw size={12} className="text-slate-400" />,
  carried_forward:       <ArrowDownToLine size={12} className="text-purple-400" />,
  carry_forward_received:<ArrowDownToLine size={12} className="text-indigo-400" />,
  proof_attached:        <FileText size={12} className="text-cyan-400" />,
  archived:              <Archive size={12} className="text-slate-500" />,
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-slate-700 text-slate-300"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function KpiCard({ label, value, sub, icon, accent }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; accent?: string;
}) {
  return (
    <Card className="bg-slate-800/60 border-slate-700">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${accent ?? "text-white"}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
          </div>
          <div className="text-slate-500">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Record row ─────────────────────────────────────────────────────────────

function RecordRow({ rec, onSelect }: { rec: DistributionRecord; onSelect: () => void }) {
  const pending = parseFloat(rec.pendingPayable ?? "0");
  const paid    = parseFloat(rec.totalPaid ?? "0");
  const total   = parseFloat(rec.settlementRecommendation ?? "0");
  const pct     = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/60 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{rec.accountingPeriodLabel}</p>
          <p className="text-xs text-slate-400 truncate">{rec.projectName ?? rec.projectId} {rec.partnerName ? `· ${rec.partnerName}` : ""}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {rec.isPermanentRecord && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Lock size={10} className="text-amber-400" />
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Permanently preserved</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <StatusBadge status={rec.status} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
        <div>
          <p className="text-slate-500">Recommended</p>
          <p className="text-slate-200 font-medium">{fmt(rec.settlementRecommendation)}</p>
        </div>
        <div>
          <p className="text-slate-500">Paid</p>
          <p className="text-emerald-400 font-medium">{fmt(rec.totalPaid)}</p>
        </div>
        <div>
          <p className="text-slate-500">Pending</p>
          <p className={pending > 0 ? "text-amber-400 font-medium" : "text-slate-400 font-medium"}>{fmt(rec.pendingPayable)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <span className="text-xs text-slate-500">{pct}%</span>
      </div>
    </button>
  );
}

// ── Event timeline ─────────────────────────────────────────────────────────

function EventTimeline({ events }: { events: DistributionPaymentEvent[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-slate-500 text-center py-4">No events recorded yet</p>;
  }
  return (
    <div className="relative pl-5">
      <div className="absolute left-2 top-0 bottom-0 w-px bg-slate-700" />
      <div className="space-y-3">
        {events.map((ev, i) => (
          <div key={ev.id} className="relative">
            <div className="absolute -left-3 top-0.5 w-4 h-4 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center">
              {EVENT_ICONS[ev.eventType] ?? <div className="w-1.5 h-1.5 bg-slate-500 rounded-full" />}
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-slate-200 capitalize">{ev.eventType.replace(/_/g, " ")}</span>
                <span className="text-xs text-slate-500 shrink-0">{fmtDate(ev.performedAt)}</span>
              </div>
              {ev.paymentAmount && (
                <p className="text-xs text-emerald-400 mt-0.5">Payment: {fmt(ev.paymentAmount)} · Cumulative: {fmt(ev.cumulativePaid)} · Remaining: {fmt(ev.remainingBalance)}</p>
              )}
              {ev.remarks && <p className="text-xs text-slate-400 mt-0.5 italic">{ev.remarks}</p>}
              {ev.performedByName && <p className="text-xs text-slate-600 mt-0.5">by {ev.performedByName} ({ev.performedByRole})</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────

function DetailPanel({ id, onClose, canEdit }: { id: string; onClose: () => void; canEdit: boolean }) {
  const { data, refetch } = useGetDistributionRecord(id);
  const { data: eventsData } = useListDistributionPaymentEvents(id);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [payAmt, setPayAmt] = useState("");
  const [payDate, setPayDate] = useState("");
  const [payRef, setPayRef] = useState("");
  const [payRemarks, setPayRemarks] = useState("");
  const [payProof, setPayProof] = useState("");
  const [cfRemarks, setCfRemarks] = useState("");

  const recordPayment = useRecordDistributionPayment();
  const carryForward  = useCarryForwardDistributionRecord();

  const rec    = data?.record;
  const events = eventsData?.events ?? [];

  if (!rec) return <div className="flex items-center justify-center h-full"><p className="text-slate-400 text-sm">Loading…</p></div>;

  const pending = parseFloat(rec.pendingPayable ?? "0");
  const paid    = parseFloat(rec.totalPaid ?? "0");
  const total   = parseFloat(rec.settlementRecommendation ?? "0");
  const pct     = total > 0 ? Math.round((paid / total) * 100) : 0;

  const handlePayment = async () => {
    await recordPayment.mutateAsync({
      id,
      data: {
        paymentAmount: parseFloat(payAmt),
        paymentDate: payDate || undefined,
        paymentRef: payRef || undefined,
        remarks: payRemarks || undefined,
        paymentProofUrl: payProof || undefined,
      },
    });
    setPaymentOpen(false);
    setPayAmt(""); setPayDate(""); setPayRef(""); setPayRemarks(""); setPayProof("");
    refetch();
  };

  const handleCarryForward = async () => {
    await carryForward.mutateAsync({ id, data: { remarks: cfRemarks || undefined } });
    setCfOpen(false);
    setCfRemarks("");
    refetch();
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 border-l border-slate-700">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-white">{rec.accountingPeriodLabel}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {rec.projectName ?? rec.projectId}
            {rec.partnerName ? ` · ${rec.partnerName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={rec.status} />
          {rec.isPermanentRecord && <Lock size={12} className="text-amber-400" />}
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xs">✕</button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Financial summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/60 rounded-lg p-2.5">
              <p className="text-xs text-slate-500">Gross Revenue</p>
              <p className="text-sm font-semibold text-white">{fmt(rec.grossRevenue)}</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2.5">
              <p className="text-xs text-slate-500">Recommended</p>
              <p className="text-sm font-semibold text-slate-200">{fmt(rec.settlementRecommendation)}</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2.5">
              <p className="text-xs text-slate-500">Prior Carry-Forward</p>
              <p className="text-sm font-semibold text-purple-400">{fmt(rec.priorCarryForward)}</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2.5">
              <p className="text-xs text-slate-500">Total Paid</p>
              <p className="text-sm font-semibold text-emerald-400">{fmt(rec.totalPaid)}</p>
            </div>
          </div>

          {/* Progress */}
          <div className="bg-slate-800/60 rounded-lg p-3">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-400">Payment progress</span>
              <span className="text-white font-medium">{pct}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="flex justify-between text-xs mt-1.5">
              <span className="text-emerald-400">{fmt(rec.totalPaid)} paid</span>
              {pending > 0 && <span className="text-amber-400">{fmt(rec.pendingPayable)} pending</span>}
            </div>
          </div>

          {/* Carry-forward balance */}
          {parseFloat(rec.carryForwardBalance ?? "0") > 0 && (
            <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg p-3">
              <p className="text-xs text-purple-400 font-medium">Carry-Forward Balance</p>
              <p className="text-lg font-bold text-purple-300">{fmt(rec.carryForwardBalance)}</p>
              {rec.status === "carried_forward" && (
                <p className="text-xs text-purple-500 mt-1">This balance has been rolled to the next period</p>
              )}
            </div>
          )}

          {/* Settlement type & period */}
          <div className="bg-slate-800/40 rounded-lg p-3 text-xs space-y-1.5">
            {rec.settlementType && (
              <div className="flex justify-between">
                <span className="text-slate-500">Settlement Type</span>
                <span className="text-slate-300 font-mono capitalize">{rec.settlementType.replace(/_/g, " ")}</span>
              </div>
            )}
            {rec.periodStart && (
              <div className="flex justify-between">
                <span className="text-slate-500">Period</span>
                <span className="text-slate-300">{fmtDate(rec.periodStart)} – {fmtDate(rec.periodEnd)}</span>
              </div>
            )}
            {rec.lastPaymentDate && (
              <div className="flex justify-between">
                <span className="text-slate-500">Last Payment</span>
                <span className="text-slate-300">{fmtDate(rec.lastPaymentDate)} {rec.lastPaymentRef ? `· #${rec.lastPaymentRef}` : ""}</span>
              </div>
            )}
            {rec.paymentProofUrl && (
              <div className="flex justify-between">
                <span className="text-slate-500">Proof</span>
                <a href={rec.paymentProofUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline truncate max-w-[180px]">View proof</a>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-500">Permanent Record</span>
              <span className={rec.isPermanentRecord ? "text-amber-400" : "text-slate-500"}>{rec.isPermanentRecord ? "Yes – preserved" : "No"}</span>
            </div>
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {rec.status !== "paid" && rec.status !== "archived" && rec.status !== "carried_forward" && (
                <Button size="sm" variant="outline" className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/30 text-xs" onClick={() => setPaymentOpen(true)}>
                  <CreditCard size={12} className="mr-1.5" /> Record Payment
                </Button>
              )}
              {rec.status !== "paid" && rec.status !== "archived" && rec.status !== "carried_forward" && (
                <Button size="sm" variant="outline" className="border-purple-700 text-purple-400 hover:bg-purple-900/30 text-xs" onClick={() => setCfOpen(true)}>
                  <ArrowDownToLine size={12} className="mr-1.5" /> Carry Forward
                </Button>
              )}
            </div>
          )}

          {rec.notes && (
            <div className="bg-slate-800/40 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-1">Notes</p>
              <p className="text-xs text-slate-300 whitespace-pre-line">{rec.notes}</p>
            </div>
          )}

          <Separator className="bg-slate-700" />

          {/* Event timeline */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
              <History size={12} /> Payment Event Trail
            </p>
            <EventTimeline events={events} />
          </div>
        </div>
      </ScrollArea>

      {/* Record Payment Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-slate-300 text-xs">Amount (₹) *</Label>
              <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="number" min="0.01" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="e.g. 50000" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Payment Date</Label>
              <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Reference No.</Label>
              <Input className="bg-slate-800 border-slate-600 text-white mt-1" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Cheque / NEFT / UPI ref" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Payment Proof URL</Label>
              <Input className="bg-slate-800 border-slate-600 text-white mt-1" value={payProof} onChange={e => setPayProof(e.target.value)} placeholder="https://…" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Remarks</Label>
              <Textarea className="bg-slate-800 border-slate-600 text-white mt-1 resize-none text-xs" rows={2} value={payRemarks} onChange={e => setPayRemarks(e.target.value)} />
            </div>
            <div className="bg-amber-900/20 border border-amber-800/40 rounded p-2 text-xs text-amber-300">
              Pending balance: {fmt(rec.pendingPayable)} · Recording payment marks this record as permanent
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-slate-400" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-600 text-white" disabled={!payAmt || parseFloat(payAmt) <= 0 || recordPayment.isPending} onClick={handlePayment}>
              {recordPayment.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Carry Forward Dialog */}
      <Dialog open={cfOpen} onOpenChange={setCfOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Carry Forward Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-purple-900/20 border border-purple-800/40 rounded-lg p-3 text-sm">
              <p className="text-purple-300">Balance of <span className="font-bold">{fmt(rec.pendingPayable)}</span> will be carried forward to the next period.</p>
              <p className="text-purple-500 text-xs mt-1">This action is permanent — the record will be marked as carried forward.</p>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Remarks</Label>
              <Textarea className="bg-slate-800 border-slate-600 text-white mt-1 resize-none text-xs" rows={2} value={cfRemarks} onChange={e => setCfRemarks(e.target.value)} placeholder="Reason for carry-forward…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-slate-400" onClick={() => setCfOpen(false)}>Cancel</Button>
            <Button className="bg-purple-700 hover:bg-purple-600 text-white" disabled={carryForward.isPending} onClick={handleCarryForward}>
              {carryForward.isPending ? "Processing…" : "Carry Forward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Create dialog ──────────────────────────────────────────────────────────

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { data: projectsData } = useListProjects();
  const { data: partnersData  } = useListPartners();
  const create = useCreateDistributionRecord();

  const [form, setForm] = useState({
    projectId: "__none__",
    partnerId: "__none__",
    accountingPeriodLabel: "",
    periodStart: "",
    periodEnd: "",
    settlementType: "__none__",
    grossRevenue: "",
    settlementRecommendation: "",
    priorCarryForward: "",
    notes: "",
  });

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    await create.mutateAsync({
      data: {
        projectId: form.projectId === "__none__" ? "" : form.projectId,
        partnerId: form.partnerId === "__none__" ? undefined : form.partnerId,
        accountingPeriodLabel: form.accountingPeriodLabel,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
        settlementType: form.settlementType === "__none__" ? undefined : form.settlementType,
        grossRevenue: form.grossRevenue ? parseFloat(form.grossRevenue) : undefined,
        settlementRecommendation: form.settlementRecommendation ? parseFloat(form.settlementRecommendation) : undefined,
        priorCarryForward: form.priorCarryForward ? parseFloat(form.priorCarryForward) : undefined,
        notes: form.notes || undefined,
      },
    });
    onCreated();
    onClose();
    setForm({ projectId: "__none__", partnerId: "__none__", accountingPeriodLabel: "", periodStart: "", periodEnd: "", settlementType: "__none__", grossRevenue: "", settlementRecommendation: "", priorCarryForward: "", notes: "" });
  };

  const projects = (projectsData as { projects?: { id: string; name: string }[] })?.projects ?? [];
  const partners = (partnersData as { partners?: { id: string; name: string }[] })?.partners ?? [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">New Distribution Record</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-3 pr-2">
            <div>
              <Label className="text-slate-300 text-xs">Project *</Label>
              <Select value={form.projectId} onValueChange={v => set("projectId", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="__none__" className="text-slate-400">— Select —</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id} className="text-white">{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Partner</Label>
              <Select value={form.partnerId} onValueChange={v => set("partnerId", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1"><SelectValue placeholder="All partners" /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="__none__" className="text-slate-400">— All Partners —</SelectItem>
                  {partners.map(p => <SelectItem key={p.id} value={p.id} className="text-white">{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Accounting Period Label *</Label>
              <Input className="bg-slate-800 border-slate-600 text-white mt-1" value={form.accountingPeriodLabel} onChange={e => set("accountingPeriodLabel", e.target.value)} placeholder="e.g. FY 2024–25 Q3" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-slate-300 text-xs">Period Start</Label>
                <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="date" value={form.periodStart} onChange={e => set("periodStart", e.target.value)} />
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Period End</Label>
                <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="date" value={form.periodEnd} onChange={e => set("periodEnd", e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Settlement Type</Label>
              <Select value={form.settlementType} onValueChange={v => set("settlementType", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="__none__" className="text-slate-400">— None —</SelectItem>
                  <SelectItem value="fifty_pct" className="text-white">50% Revenue Split</SelectItem>
                  <SelectItem value="payable" className="text-white">Payable</SelectItem>
                  <SelectItem value="lca" className="text-white">LCA</SelectItem>
                  <SelectItem value="loss_absorption" className="text-white">Loss Absorption</SelectItem>
                  <SelectItem value="manual" className="text-white">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-slate-300 text-xs">Gross Revenue (₹)</Label>
                <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="number" min="0" value={form.grossRevenue} onChange={e => set("grossRevenue", e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Recommended (₹)</Label>
                <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="number" min="0" value={form.settlementRecommendation} onChange={e => set("settlementRecommendation", e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Prior Carry-Fwd (₹)</Label>
                <Input className="bg-slate-800 border-slate-600 text-white mt-1" type="number" min="0" value={form.priorCarryForward} onChange={e => set("priorCarryForward", e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Notes</Label>
              <Textarea className="bg-slate-800 border-slate-600 text-white mt-1 resize-none text-xs" rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} />
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" className="text-slate-400" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-indigo-700 hover:bg-indigo-600 text-white"
            disabled={!form.projectId || form.projectId === "__none__" || !form.accountingPeriodLabel || create.isPending}
            onClick={handleSubmit}
          >
            {create.isPending ? "Creating…" : "Create Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DistributionRecords() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const canEdit = role === "admin" || role === "developer";

  const [tab, setTab] = useState("dashboard");
  const [filterProject, setFilterProject] = useState("__all__");
  const [filterPartner, setFilterPartner] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const projectId = filterProject !== "__all__" ? filterProject : selectedProjectId ?? undefined;
  const partnerId = filterPartner !== "__all__" ? filterPartner : undefined;

  const { data: recordsData, refetch: refetchRecords } = useListDistributionRecords({
    projectId,
    partnerId,
    status: filterStatus !== "__all__" ? filterStatus : undefined,
  });
  const { data: summaryData, refetch: refetchSummary } = useGetDistributionSummary({ projectId, partnerId });
  const { data: pendingData } = useGetDistributionPendingPayable({ projectId, partnerId });
  const { data: archiveData } = useGetDistributionArchive({ projectId, partnerId });
  const { data: projectsData } = useListProjects();
  const { data: partnersData  } = useListPartners();

  const records  = recordsData?.records ?? [];
  const summary  = summaryData;
  const pending  = pendingData?.records ?? [];
  const archive  = archiveData?.records ?? [];
  const projects = (projectsData as { projects?: { id: string; name: string }[] })?.projects ?? [];
  const partners = (partnersData as { partners?: { id: string; name: string }[] })?.partners ?? [];

  const refetchAll = () => { refetchRecords(); refetchSummary(); };

  // Bar chart data from records
  const chartData = useMemo(() => {
    const map: Record<string, { period: string; paid: number; pending: number; carryFwd: number }> = {};
    for (const r of records.slice(0, 12)) {
      const label = r.accountingPeriodLabel.slice(0, 12);
      if (!map[label]) map[label] = { period: label, paid: 0, pending: 0, carryFwd: 0 };
      map[label].paid    += parseFloat(r.totalPaid ?? "0");
      map[label].pending += parseFloat(r.pendingPayable ?? "0");
      map[label].carryFwd+= parseFloat(r.carryForwardBalance ?? "0");
    }
    return Object.values(map).slice(0, 8);
  }, [records]);

  const byStatus = summary?.byStatus as Record<string, number> | undefined;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <Database size={18} className="text-indigo-400" /> Distribution Records
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Payment history · Pending payable · Settlement archive · Permanently preserved</p>
        </div>
        {canEdit && (
          <Button size="sm" className="bg-indigo-700 hover:bg-indigo-600 text-white text-xs" onClick={() => setCreateOpen(true)}>
            <Plus size={14} className="mr-1.5" /> New Record
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-2.5 bg-slate-900/60 border-b border-slate-800 shrink-0">
        <Select value={filterProject} onValueChange={v => setFilterProject(v)}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-7 w-44">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            <SelectItem value="__all__" className="text-slate-300 text-xs">All Projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id} className="text-white text-xs">{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterPartner} onValueChange={v => setFilterPartner(v)}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-7 w-44">
            <SelectValue placeholder="All partners" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            <SelectItem value="__all__" className="text-slate-300 text-xs">All Partners</SelectItem>
            {partners.map(p => <SelectItem key={p.id} value={p.id} className="text-white text-xs">{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={v => setFilterStatus(v)}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-xs h-7 w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            <SelectItem value="__all__" className="text-slate-300 text-xs">All Statuses</SelectItem>
            {["draft","pending","partial","paid","carried_forward"].map(s => (
              <SelectItem key={s} value={s} className="text-white text-xs capitalize">{s.replace(/_/g," ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="text-slate-400 hover:text-white h-7 px-2 text-xs" onClick={refetchAll}>
          <RefreshCw size={12} className="mr-1" /> Refresh
        </Button>
      </div>

      {/* Content with optional detail panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-col overflow-hidden transition-all ${selectedId ? "w-[55%]" : "w-full"}`}>
          <Tabs value={tab} onValueChange={t => { setTab(t); setSelectedId(null); }} className="flex flex-col flex-1 overflow-hidden">
            <TabsList className="bg-slate-900 border-b border-slate-800 rounded-none justify-start px-6 shrink-0">
              <TabsTrigger value="dashboard"  className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">Dashboard</TabsTrigger>
              <TabsTrigger value="history"    className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">Payment History</TabsTrigger>
              <TabsTrigger value="pending"    className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs flex items-center gap-1">
                Pending Payable {pending.length > 0 && <span className="bg-amber-600 text-white text-xs rounded-full px-1.5">{pending.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="archive"    className="data-[state=active]:bg-slate-800 text-slate-400 data-[state=active]:text-white text-xs">Settlement Archive</TabsTrigger>
            </TabsList>

            {/* Dashboard tab */}
            <TabsContent value="dashboard" className="flex-1 overflow-y-auto m-0">
              <div className="p-6 space-y-6">
                {/* KPI cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <KpiCard label="Total Recommended" value={fmt(summary?.totalRecommended)} sub={`${summary?.totalRecords ?? 0} records`} icon={<IndianRupee size={18} />} />
                  <KpiCard label="Total Paid" value={fmt(summary?.totalPaid)} sub={`${summary?.paymentRate ?? "0"}% payment rate`} icon={<CheckCircle size={18} />} accent="text-emerald-400" />
                  <KpiCard label="Pending Payable" value={fmt(summary?.totalPending)} sub="Outstanding balance" icon={<Clock size={18} />} accent={parseFloat(summary?.totalPending ?? "0") > 0 ? "text-amber-400" : "text-white"} />
                  <KpiCard label="Carry-Forward" value={fmt(summary?.totalCarryForward)} sub="Rolled to next period" icon={<ArrowDownToLine size={18} />} accent="text-purple-400" />
                </div>

                {/* Status breakdown */}
                {byStatus && Object.keys(byStatus).length > 0 && (
                  <Card className="bg-slate-800/60 border-slate-700">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm text-slate-300">Records by Status</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(byStatus).map(([s, n]) => (
                          <div key={s} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[s] ?? "bg-slate-700 text-slate-300"}`}>
                            {STATUS_LABEL[s] ?? s}: {n}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Bar chart */}
                {chartData.length > 0 && (
                  <Card className="bg-slate-800/60 border-slate-700">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm text-slate-300">Paid vs Pending by Period</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={chartData} barGap={4}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="period" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                          <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                          <RechartTooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "#1e293b", border: "1px solid #475569", fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="paid" name="Paid" fill="#10b981" radius={[3, 3, 0, 0]} />
                          <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                          <Bar dataKey="carryFwd" name="Carry-Fwd" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                {/* Preservation notice */}
                <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-4 flex items-start gap-3">
                  <Shield size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-amber-300">Permanent Preservation Policy</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      All settlement records with any payment activity are permanently preserved and cannot be deleted or archived.
                      Only draft records with no payments may be archived by administrators.
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Payment History tab */}
            <TabsContent value="history" className="flex-1 overflow-y-auto m-0">
              <div className="p-4">
                {records.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <Database size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No distribution records found</p>
                    {canEdit && <Button size="sm" variant="outline" className="mt-3 border-slate-700 text-slate-300 text-xs" onClick={() => setCreateOpen(true)}>Create First Record</Button>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {records.map(r => (
                      <RecordRow key={r.id} rec={r} onSelect={() => setSelectedId(selectedId === r.id ? null : r.id)} />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Pending Payable tab */}
            <TabsContent value="pending" className="flex-1 overflow-y-auto m-0">
              <div className="p-4">
                {pending.length > 0 && (
                  <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg p-3 mb-4 flex justify-between items-center">
                    <span className="text-xs text-amber-300 font-medium">Total Outstanding</span>
                    <span className="text-lg font-bold text-amber-400">{fmt(pendingData?.totalPendingAmount)}</span>
                  </div>
                )}
                {pending.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <CheckCircle size={32} className="mx-auto mb-3 text-emerald-600 opacity-50" />
                    <p className="text-sm">No pending payables — all settled!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pending.map(r => (
                      <RecordRow key={r.id} rec={r} onSelect={() => { setSelectedId(selectedId === r.id ? null : r.id); setTab("history"); }} />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Settlement Archive tab */}
            <TabsContent value="archive" className="flex-1 overflow-y-auto m-0">
              <div className="p-4">
                <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-3 mb-4 flex items-start gap-2">
                  <Lock size={12} className="text-amber-400 mt-0.5" />
                  <p className="text-xs text-slate-400">Complete historical archive — all periods, including carried-forward and closed records. Records marked with <Lock size={10} className="inline text-amber-400" /> are permanently preserved and cannot be removed.</p>
                </div>
                {archive.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <Archive size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No records in archive yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {archive.map(r => (
                      <button
                        key={r.id}
                        onClick={() => { setSelectedId(selectedId === r.id ? null : r.id); setTab("history"); }}
                        className="w-full text-left p-3 rounded-lg bg-slate-800/40 hover:bg-slate-700/50 border border-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{r.accountingPeriodLabel}</p>
                            <p className="text-xs text-slate-400 truncate">{r.projectName ?? r.projectId} {r.partnerName ? `· ${r.partnerName}` : ""}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {r.isPermanentRecord && <Lock size={10} className="text-amber-400" />}
                            <StatusBadge status={r.status} />
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs text-slate-500">
                          <span>Revenue: <span className="text-slate-300">{fmt(r.grossRevenue)}</span></span>
                          <span>Recommended: <span className="text-slate-300">{fmt(r.settlementRecommendation)}</span></span>
                          <span>Paid: <span className="text-emerald-400">{fmt(r.totalPaid)}</span></span>
                          <span>Carry-Fwd: <span className="text-purple-400">{fmt(r.carryForwardBalance)}</span></span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Detail panel */}
        {selectedId && (
          <div className="flex-1 overflow-hidden">
            <DetailPanel
              id={selectedId}
              onClose={() => setSelectedId(null)}
              canEdit={canEdit}
            />
          </div>
        )}
      </div>

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={refetchAll} />
    </div>
  );
}
