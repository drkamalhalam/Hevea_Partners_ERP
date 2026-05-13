import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListLcaConfigs,
  useGetLcaFullLedger,
  useAutoGenerateLcaLedger,
  useRecordLcaPayment,
  useListLcaPaymentEvents,
  getGetLcaFullLedgerQueryKey,
  getListLcaLedgerQueryKey,
} from "@workspace/api-client-react";
import type {
  LcaConfig,
  LcaFullLedgerEntry,
  LcaPaymentEvent,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  IndianRupee,
  Zap,
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Minus,
  ArrowRight,
  CalendarDays,
  Receipt,
  Info,
  TrendingUp,
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

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusConfig(status: string) {
  const map: Record<string, { label: string; icon: React.ElementType; cls: string; rowCls: string }> = {
    pending: { label: "Pending", icon: Clock, cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", rowCls: "" },
    partial: { label: "Partial", icon: AlertCircle, cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", rowCls: "bg-blue-950/10" },
    paid: { label: "Paid", icon: CheckCircle2, cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", rowCls: "bg-emerald-950/10" },
    waived: { label: "Waived", icon: Minus, cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", rowCls: "bg-zinc-800/20" },
  };
  return map[status] ?? map.pending;
}

const CURRENT_YEAR = new Date().getFullYear();

// ── Main Component ────────────────────────────────────────────────────────────

export default function LCALedger() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdminOrDev = role === "admin" || role === "developer";

  const [selectedConfigId, setSelectedConfigId] = useState<string>("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [autoGenDialog, setAutoGenDialog] = useState(false);
  const [toYear, setToYear] = useState(String(CURRENT_YEAR));
  const [paymentDialog, setPaymentDialog] = useState<{
    open: boolean;
    entryId: string;
    year: number;
    balance: number;
  }>({ open: false, entryId: "", year: 0, balance: 0 });
  const [paymentForm, setPaymentForm] = useState({
    amountPaid: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentRef: "",
    notes: "",
  });

  // Queries
  const { data: configs = [], isLoading: loadingConfigs } = useListLcaConfigs({});

  const { data: fullLedger, isLoading: loadingLedger, refetch } = useGetLcaFullLedger(
    selectedConfigId ? { configId: selectedConfigId } : {},
    { query: { enabled: !!selectedConfigId, queryKey: getGetLcaFullLedgerQueryKey({ configId: selectedConfigId }) } },
  );

  // Mutations
  const autoGenerate = useAutoGenerateLcaLedger();
  const recordPayment = useRecordLcaPayment();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetLcaFullLedgerQueryKey({ configId: selectedConfigId }) });
    qc.invalidateQueries({ queryKey: getListLcaLedgerQueryKey() });
  };

  const selectedConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? null,
    [configs, selectedConfigId],
  );

  // Pre-select first config
  const firstConfigId = configs[0]?.id;
  if (!selectedConfigId && firstConfigId) setSelectedConfigId(firstConfigId);

  function toggleRow(id: string) {
    setExpandedRows((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAutoGenerate() {
    if (!selectedConfigId) return;
    try {
      const result = await autoGenerate.mutateAsync({
        id: selectedConfigId,
        data: { toYear: parseInt(toYear) || CURRENT_YEAR },
      });
      setAutoGenDialog(false);
      invalidate();
      refetch();
    } catch {
      // error visible via mutation state
    }
  }

  async function handleRecordPayment() {
    const amount = parseFloat(paymentForm.amountPaid);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await recordPayment.mutateAsync({
        id: paymentDialog.entryId,
        data: {
          amountPaid: amount,
          paymentDate: paymentForm.paymentDate,
          paymentRef: paymentForm.paymentRef || undefined,
          notes: paymentForm.notes || undefined,
        },
      });
      setPaymentDialog((d) => ({ ...d, open: false }));
      invalidate();
    } catch {
      // error visible
    }
  }

  const { entries = [], totals, config: ledgerConfig } = fullLedger ?? {};

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Receipt className="w-6 h-6 text-amber-400" />
            LCA Accounting Ledger
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Year-wise LCA journal with escalation, carry-forward, and full payment history.
          </p>
        </div>
        {isAdminOrDev && selectedConfigId && (
          <Button
            className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
            onClick={() => setAutoGenDialog(true)}
          >
            <Zap className="w-4 h-4 mr-1" />
            Auto-Generate Ledger
          </Button>
        )}
      </div>

      {/* ── Config Selector ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-zinc-400 text-sm shrink-0">Configuration:</Label>
        {loadingConfigs ? (
          <span className="text-zinc-500 text-sm">Loading…</span>
        ) : configs.length === 0 ? (
          <span className="text-zinc-500 text-sm">No LCA configurations found. Set one up in the LCA Config page.</span>
        ) : (
          <Select value={selectedConfigId} onValueChange={setSelectedConfigId}>
            <SelectTrigger className="w-80 bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="Select configuration" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              {configs.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-zinc-200">
                  {c.projectName ?? c.projectId.slice(0, 8)} — {fmt(c.baseAmount)} @ {c.escalationPct}% p.a.
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Config Banner ─────────────────────────────────────────────────── */}
      {selectedConfig && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <InfoTile label="Project" value={selectedConfig.projectName ?? "—"} />
          <InfoTile label="Base Annual LCA" value={fmt(selectedConfig.baseAmount)} highlight />
          <InfoTile label="Escalation" value={`${selectedConfig.escalationPct}% p.a.`} />
          <InfoTile label="Start Year" value={String(selectedConfig.startYear)} />
          <InfoTile label="Effective From" value={selectedConfig.effectiveStartDate} />
          <InfoTile label="Status" value={selectedConfig.isActive ? "Active" : "Inactive"} green={selectedConfig.isActive} />
        </div>
      )}

      {/* ── Totals Row ────────────────────────────────────────────────────── */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Base Total" value={fmt(totals.baseTotal)} icon={<IndianRupee className="w-3.5 h-3.5" />} />
          <KpiCard label="Escalation Added" value={fmt(totals.escalationTotal)} icon={<TrendingUp className="w-3.5 h-3.5" />} amber />
          <KpiCard label="Carry-Forward" value={fmt(totals.carryForwardTotal)} icon={<ArrowRight className="w-3.5 h-3.5" />} red={totals.carryForwardTotal > 0} />
          <KpiCard label="Total Payable" value={fmt(totals.totalDue)} icon={<Receipt className="w-3.5 h-3.5" />} />
          <KpiCard label="Total Paid" value={fmt(totals.totalPaid)} icon={<CheckCircle2 className="w-3.5 h-3.5" />} green />
          <KpiCard label="Outstanding" value={fmt(totals.totalBalance)} icon={<AlertCircle className="w-3.5 h-3.5" />} red={totals.totalBalance > 0} />
        </div>
      )}

      {/* ── Main Ledger Table ─────────────────────────────────────────────── */}
      {!selectedConfigId ? (
        <EmptyPlaceholder text="Select a configuration above to view its ledger." />
      ) : loadingLedger ? (
        <div className="text-zinc-500 text-sm py-10 text-center">Loading ledger…</div>
      ) : !entries || entries.length === 0 ? (
        <EmptyPlaceholder
          text="No ledger entries yet."
          sub={isAdminOrDev ? 'Click \u201cAuto-Generate Ledger\u201d to create all yearly entries automatically.' : undefined}
          action={isAdminOrDev ? (
            <Button size="sm" className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold mt-3" onClick={() => setAutoGenDialog(true)}>
              <Zap className="w-3 h-3 mr-1" />
              Auto-Generate
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="rounded-lg border border-zinc-700 overflow-hidden">
          {/* Table header */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800/80">
                  <TableHead className="text-zinc-400 w-8" />
                  <TableHead className="text-zinc-400 font-semibold">Year</TableHead>
                  <TableHead className="text-zinc-400 text-right">Base LCA</TableHead>
                  <TableHead className="text-zinc-400 text-right">Escalation +</TableHead>
                  <TableHead className="text-zinc-400 text-right">Gross Due</TableHead>
                  <TableHead className="text-zinc-400 text-right">Carry-Fwd +</TableHead>
                  <TableHead className="text-zinc-400 text-right font-semibold">Total Payable</TableHead>
                  <TableHead className="text-zinc-400 text-right">Paid</TableHead>
                  <TableHead className="text-zinc-400 text-right">Balance</TableHead>
                  <TableHead className="text-zinc-400">Status</TableHead>
                  {isAdminOrDev && <TableHead className="text-zinc-400 text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const sc = statusConfig(entry.status);
                  const isExpanded = expandedRows.has(entry.id);
                  const isCurrent = entry.year === CURRENT_YEAR;

                  return (
                    <>
                      <Collapsible key={entry.id} open={isExpanded} onOpenChange={() => toggleRow(entry.id)} asChild>
                        <>
                          <CollapsibleTrigger asChild>
                            <TableRow
                              className={cn(
                                "border-zinc-700/50 cursor-pointer select-none transition-colors",
                                sc.rowCls,
                                isCurrent && "ring-1 ring-inset ring-amber-500/40",
                                "hover:bg-zinc-800/60",
                              )}
                            >
                              <TableCell className="py-3 pl-3 pr-0">
                                <span className="text-zinc-500">
                                  {isExpanded
                                    ? <ChevronDown className="w-3.5 h-3.5" />
                                    : <ChevronRight className="w-3.5 h-3.5" />}
                                </span>
                              </TableCell>
                              <TableCell className="font-semibold text-zinc-200">
                                {entry.year}
                                {isCurrent && (
                                  <span className="ml-1.5 text-xs text-amber-400 font-normal">(current)</span>
                                )}
                                {entry.payments.length > 0 && (
                                  <span className="ml-1.5 text-xs text-zinc-500">{entry.payments.length} pmts</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-zinc-400">{fmt(entry.baseAmount)}</TableCell>
                              <TableCell className="text-right">
                                {entry.escalationApplied > 0
                                  ? <span className="text-orange-400">+{fmt(entry.escalationApplied)}</span>
                                  : <span className="text-zinc-600">—</span>}
                              </TableCell>
                              <TableCell className="text-right text-zinc-300">{fmt(entry.grossDue)}</TableCell>
                              <TableCell className="text-right">
                                {entry.carryForward > 0
                                  ? <span className="text-red-400">+{fmt(entry.carryForward)}</span>
                                  : <span className="text-zinc-600">—</span>}
                              </TableCell>
                              <TableCell className="text-right text-white font-semibold">{fmt(entry.totalDue)}</TableCell>
                              <TableCell className="text-right text-emerald-400">
                                {entry.amountPaid > 0 ? fmt(entry.amountPaid) : <span className="text-zinc-600">—</span>}
                              </TableCell>
                              <TableCell className={cn(
                                "text-right font-medium",
                                entry.balance > 0 ? "text-red-400" : "text-zinc-500",
                              )}>
                                {entry.balance > 0 ? fmt(entry.balance) : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn("text-xs font-medium", sc.cls)}>
                                  {sc.label}
                                </Badge>
                              </TableCell>
                              {isAdminOrDev && (
                                <TableCell className="text-right">
                                  {entry.status !== "paid" && entry.status !== "waived" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPaymentForm({
                                          amountPaid: String(entry.balance),
                                          paymentDate: new Date().toISOString().slice(0, 10),
                                          paymentRef: "",
                                          notes: "",
                                        });
                                        setPaymentDialog({
                                          open: true,
                                          entryId: entry.id,
                                          year: entry.year,
                                          balance: entry.balance,
                                        });
                                      }}
                                    >
                                      <Plus className="w-3 h-3 mr-1" />
                                      Pay
                                    </Button>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          </CollapsibleTrigger>

                          <CollapsibleContent asChild>
                            <TableRow className={cn("border-zinc-700/30", sc.rowCls)}>
                              <TableCell colSpan={isAdminOrDev ? 11 : 10} className="py-0 px-0">
                                <PaymentHistorySection
                                  entry={entry}
                                  payments={entry.payments}
                                />
                              </TableCell>
                            </TableRow>
                          </CollapsibleContent>
                        </>
                      </Collapsible>
                    </>
                  );
                })}
              </TableBody>

              {/* Totals footer */}
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-600 bg-zinc-800/80">
                    <td />
                    <td className="py-3 px-4 text-zinc-300 font-bold text-sm">{totals.yearCount} years</td>
                    <td className="py-3 px-4 text-right text-zinc-300 font-semibold text-sm">{fmt(totals.baseTotal)}</td>
                    <td className="py-3 px-4 text-right text-orange-400 font-semibold text-sm">+{fmt(totals.escalationTotal)}</td>
                    <td />
                    <td className="py-3 px-4 text-right text-red-400 font-semibold text-sm">
                      {totals.carryForwardTotal > 0 ? `+${fmt(totals.carryForwardTotal)}` : "—"}
                    </td>
                    <td className="py-3 px-4 text-right text-white font-bold text-sm">{fmt(totals.totalDue)}</td>
                    <td className="py-3 px-4 text-right text-emerald-400 font-bold text-sm">{fmt(totals.totalPaid)}</td>
                    <td className={cn("py-3 px-4 text-right font-bold text-sm", totals.totalBalance > 0 ? "text-red-400" : "text-zinc-400")}>
                      {fmt(totals.totalBalance)}
                    </td>
                    <td colSpan={isAdminOrDev ? 2 : 1} />
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>

          {/* Legend */}
          <div className="px-4 py-2 border-t border-zinc-700/50 bg-zinc-900/60 flex flex-wrap gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Escalation: base &times; (1 + {selectedConfig?.escalationPct ?? 0}%)^n &mdash; not compounded on carry-fwd</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Carry-forward: prior year&apos;s unpaid balance (zero additional escalation)</span>
            <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /> Click any row to expand payment history</span>
          </div>
        </div>
      )}

      {/* ── Auto-Generate Dialog ──────────────────────────────────────────── */}
      <Dialog open={autoGenDialog} onOpenChange={setAutoGenDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Auto-Generate Yearly Ledger
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-zinc-800/60 border border-zinc-700 p-3 text-sm space-y-1.5">
              <div className="text-zinc-300 font-medium">What this does:</div>
              <ul className="text-zinc-400 space-y-1 ml-2">
                <li className="flex items-start gap-1.5"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" /> Creates one ledger entry per year from <strong className="text-zinc-300">{selectedConfig?.startYear}</strong> to the target year</li>
                <li className="flex items-start gap-1.5"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" /> Applies {selectedConfig?.escalationPct}% compound escalation year-on-year</li>
                <li className="flex items-start gap-1.5"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" /> Carry-forward is computed from each prior year's unpaid balance</li>
                <li className="flex items-start gap-1.5"><ArrowRight className="w-3 h-3 mt-0.5 shrink-0" /> Years that already have entries are skipped (non-destructive)</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Generate up to year</Label>
              <Input
                type="number"
                min={selectedConfig?.startYear ?? 2020}
                max={CURRENT_YEAR + 5}
                value={toYear}
                onChange={(e) => setToYear(e.target.value)}
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
              <p className="text-xs text-zinc-500">Default is the current year ({CURRENT_YEAR}). You can generate up to 5 years ahead.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-zinc-400" onClick={() => setAutoGenDialog(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
              onClick={handleAutoGenerate}
              disabled={autoGenerate.isPending}
            >
              {autoGenerate.isPending ? "Generating…" : "Generate Ledger"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Payment Dialog ─────────────────────────────────────────── */}
      <Dialog open={paymentDialog.open} onOpenChange={(o) => setPaymentDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              Record Payment — Year {paymentDialog.year}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-zinc-800/50 border border-zinc-700 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Outstanding Balance</span>
                <span className="text-red-400 font-semibold">{fmt(paymentDialog.balance)}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Amount (₹)</Label>
                <Input
                  type="number"
                  min={0.01}
                  step={1000}
                  value={paymentForm.amountPaid}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, amountPaid: e.target.value }))}
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Payment Date</Label>
                <Input
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Reference / Receipt No.</Label>
              <Input
                value={paymentForm.paymentRef}
                onChange={(e) => setPaymentForm((f) => ({ ...f, paymentRef: e.target.value }))}
                placeholder="Optional"
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Notes</Label>
              <Input
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-zinc-400" onClick={() => setPaymentDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              onClick={handleRecordPayment}
              disabled={recordPayment.isPending}
            >
              {recordPayment.isPending ? "Saving…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Payment History Section ───────────────────────────────────────────────────

function PaymentHistorySection({ entry, payments }: { entry: LcaFullLedgerEntry; payments: LcaPaymentEvent[] }) {
  return (
    <div className="px-6 py-4 bg-zinc-900/60 border-t border-zinc-800">
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
          Year {entry.year} — Payment History
        </span>
        <span className="text-xs text-zinc-600">
          ({payments.length} record{payments.length !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Escalation breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MiniStat label="Base LCA" value={fmt(entry.baseAmount)} />
        <MiniStat label="Escalation Applied" value={entry.escalationApplied > 0 ? `+${fmt(entry.escalationApplied)}` : "None"} amber={entry.escalationApplied > 0} />
        <MiniStat label="Carry-Forward" value={entry.carryForward > 0 ? `+${fmt(entry.carryForward)}` : "None"} red={entry.carryForward > 0} />
        <MiniStat label="Escalation Factor" value={`×${entry.escalationFactor.toFixed(4)}`} />
      </div>

      {payments.length === 0 ? (
        <p className="text-xs text-zinc-600 italic">No payment events recorded for this year.</p>
      ) : (
        <div className="space-y-1.5">
          {payments.map((p) => (
            <div key={p.id} className="flex items-start gap-3 text-sm bg-zinc-800/50 rounded px-3 py-2 border border-zinc-700/50">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-emerald-400 font-semibold">{fmt(p.amountPaid)}</span>
                  <span className="text-zinc-500">on</span>
                  <span className="text-zinc-300">{fmtDate(p.paymentDate)}</span>
                  {p.paymentRef && (
                    <span className="text-zinc-500 text-xs">Ref: <span className="text-zinc-400">{p.paymentRef}</span></span>
                  )}
                  <span className="text-zinc-600 text-xs">by {p.recordedByName}</span>
                </div>
                {p.notes && <p className="text-xs text-zinc-500 mt-0.5 italic">{p.notes}</p>}
              </div>
              <span className="text-xs text-zinc-600 shrink-0">{new Date(p.createdAt).toLocaleDateString("en-IN")}</span>
            </div>
          ))}
          <div className="pt-1 flex justify-between text-xs text-zinc-500 px-1">
            <span>Total paid: <span className="text-emerald-400 font-medium">{fmt(entry.amountPaid)}</span></span>
            {entry.balance > 0 && <span>Remaining: <span className="text-red-400 font-medium">{fmt(entry.balance)}</span></span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function InfoTile({ label, value, highlight, green }: { label: string; value: string; highlight?: boolean; green?: boolean }) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
      <div className="text-zinc-500 text-xs mb-0.5">{label}</div>
      <div className={cn("text-sm font-semibold truncate", highlight ? "text-amber-300" : green ? "text-emerald-400" : "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, amber, green, red }: {
  label: string; value: string; icon: React.ReactNode; amber?: boolean; green?: boolean; red?: boolean;
}) {
  return (
    <Card className="bg-zinc-800/60 border-zinc-700">
      <CardContent className="p-3">
        <div className={cn("flex items-center gap-1.5 mb-1 text-xs", amber ? "text-amber-400" : green ? "text-emerald-400" : red ? "text-red-400" : "text-zinc-400")}>
          {icon}{label}
        </div>
        <div className="text-lg font-bold text-white truncate">{value}</div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, amber, red }: { label: string; value: string; amber?: boolean; red?: boolean }) {
  return (
    <div>
      <div className="text-zinc-600 text-xs">{label}</div>
      <div className={cn("text-sm font-medium", amber ? "text-orange-400" : red ? "text-red-400" : "text-zinc-300")}>{value}</div>
    </div>
  );
}

function EmptyPlaceholder({ text, sub, action }: { text: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
      <Receipt className="w-10 h-10 text-zinc-700" />
      <p className="text-zinc-400 font-medium">{text}</p>
      {sub && <p className="text-zinc-600 text-sm max-w-sm">{sub}</p>}
      {action}
    </div>
  );
}
