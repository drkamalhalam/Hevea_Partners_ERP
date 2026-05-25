import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  useListMoneyCustody,
  useGetMoneyCustodySummary,
  useRecordCustodyDeposit,
  getListMoneyCustodyQueryKey,
  getGetMoneyCustodySummaryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { AlertTriangle, Wallet, TrendingDown, Banknote, Globe, CheckCircle } from "lucide-react";
import { parseNumeric } from "@/lib/numeric";

function fmtINR(v: number | string | null | undefined) {
  const n = parseNumeric(v);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd MMM yyyy"); } catch { return v; }
}

function AgingBadge({ status }: { status: string }) {
  if (status === "critical") return <Badge className="text-xs border bg-red-500/20 text-red-300 border-red-500/30 animate-pulse">⚠ Critical</Badge>;
  if (status === "warning") return <Badge className="text-xs border bg-amber-500/20 text-amber-300 border-amber-500/30">⚠ Warning</Badge>;
  return null;
}

export default function MoneyCustody() {
  const { selectedProjectId } = useProjectFilter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [depositEntry, setDepositEntry] = useState<any>(null);
  const [depositForm, setDepositForm] = useState({ depositedAmount: "", depositReference: "" });

  const { data: entries = [], isLoading } = useListMoneyCustody({
    projectId: selectedProjectId ?? undefined,
  });
  const { data: summary = [] } = useGetMoneyCustodySummary({
    projectId: selectedProjectId ?? undefined,
  });

  const depositMut = useRecordCustodyDeposit({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMoneyCustodyQueryKey() });
        qc.invalidateQueries({ queryKey: getGetMoneyCustodySummaryQueryKey() });
        setDepositEntry(null);
        setDepositForm({ depositedAmount: "", depositReference: "" });
        toast({ title: "Deposit recorded successfully" });
      },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Failed to record deposit" }),
    },
  });

  const totalCash = (summary as any[]).reduce((s, h) => s + (h.cashAmount ?? 0), 0);
  const totalOnline = (summary as any[]).reduce((s, h) => s + (h.onlineAmount ?? 0), 0);
  const totalRemaining = (summary as any[]).reduce((s, h) => s + (h.remainingBalance ?? 0), 0);
  const criticalHolders = (summary as any[]).filter(h => h.agingStatus === "critical");
  const warningHolders = (summary as any[]).filter(h => h.agingStatus === "warning");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Money Custody Ledger</h1>
        <p className="text-sm text-gray-400 mt-1">Track who holds project sale proceeds and cash aging</p>
      </div>

      {/* Alerts */}
      {criticalHolders.length > 0 && (
        <Card className="bg-red-900/20 border-red-500/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-semibold">{criticalHolders.length} holder{criticalHolders.length > 1 ? "s" : ""} with overdue cash</p>
              <p className="text-red-400/80 text-sm mt-0.5">
                {criticalHolders.map(h => h.holderName).join(", ")} — cash held for 14+ days. Immediate deposit required.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {warningHolders.length > 0 && !criticalHolders.length && (
        <Card className="bg-amber-900/20 border-amber-500/30">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-300 font-medium">Cash aging warning for {warningHolders.map(h => h.holderName).join(", ")}</p>
              <p className="text-amber-400/70 text-sm">Cash held for 7+ days. Please arrange deposit.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4 text-center">
            <Wallet className="w-6 h-6 text-blue-400 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Total Outstanding</p>
            <p className="text-xl font-bold text-white mt-1">{fmtINR(totalRemaining)}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4 text-center">
            <Banknote className="w-6 h-6 text-amber-400 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Cash Held</p>
            <p className="text-xl font-bold text-amber-400 mt-1">{fmtINR(totalCash)}</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4 text-center">
            <Globe className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
            <p className="text-xs text-gray-400">Online</p>
            <p className="text-xl font-bold text-emerald-400 mt-1">{fmtINR(totalOnline)}</p>
          </CardContent>
        </Card>
      </div>

      {/* By holder summary */}
      {(summary as any[]).length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white">By Holder</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(summary as any[]).map((h, i) => (
                <div key={i} className={`p-4 rounded-xl border ${h.agingStatus === "critical" ? "bg-red-900/20 border-red-500/30" : h.agingStatus === "warning" ? "bg-amber-900/20 border-amber-500/30" : "bg-gray-900 border-gray-700"}`}>
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{h.holderName}</p>
                        <Badge className="text-xs border bg-gray-700/50 text-gray-300 border-gray-600 capitalize">{h.holderRole}</Badge>
                        <AgingBadge status={h.agingStatus} />
                      </div>
                      <div className="flex gap-4 mt-2 text-sm flex-wrap">
                        {h.cashAmount > 0 && (
                          <span className="text-amber-300">
                            <Banknote className="w-3.5 h-3.5 inline mr-1" />Cash: {fmtINR(h.cashAmount)}
                            {h.oldestCashDate && <span className="text-amber-400/70 ml-1">(since {fmt(h.oldestCashDate)})</span>}
                          </span>
                        )}
                        {h.onlineAmount > 0 && (
                          <span className="text-emerald-300">
                            <Globe className="w-3.5 h-3.5 inline mr-1" />Online: {fmtINR(h.onlineAmount)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Outstanding</p>
                      <p className="text-2xl font-bold text-white">{fmtINR(h.remainingBalance)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed entries */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader><CardTitle className="text-white">Custody Entries</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-700 rounded animate-pulse" />)}
            </div>
          ) : (entries as any[]).length === 0 ? (
            <div className="p-12 text-center text-gray-400">No active custody entries</div>
          ) : (
            <div className="divide-y divide-gray-700">
              {(entries as any[]).map((e: any) => (
                <div key={e.id} className={`p-4 flex items-center gap-4 flex-wrap ${e.agingStatus === "critical" ? "bg-red-900/10" : e.agingStatus === "warning" ? "bg-amber-900/10" : ""}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${e.paymentMode === "cash" ? "bg-amber-500/20" : "bg-emerald-500/20"}`}>
                    {e.paymentMode === "cash" ? <Banknote className="w-4 h-4 text-amber-400" /> : <Globe className="w-4 h-4 text-emerald-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white font-medium">{e.holderName}</p>
                      <Badge className="text-xs border bg-gray-700/50 text-gray-300 border-gray-600 capitalize">{e.paymentMode}</Badge>
                      <AgingBadge status={e.agingStatus} />
                    </div>
                    <div className="text-sm text-gray-400 mt-0.5">
                      {e.sourceCode && <span className="font-mono mr-2">{e.sourceCode}</span>}
                      Received: {fmt(e.receivedDate)}
                      {e.daysHeld != null && <span className="ml-2">· {e.daysHeld} day{e.daysHeld !== 1 ? "s" : ""} held</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-bold">{fmtINR(e.remainingBalance)}</div>
                    <div className="text-xs text-gray-500">of {fmtINR(e.amount)}</div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30"
                    onClick={() => { setDepositEntry(e); setDepositForm({ depositedAmount: e.remainingBalance, depositReference: "" }); }}
                  >
                    Record Deposit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deposit dialog */}
      <Dialog open={!!depositEntry} onOpenChange={() => setDepositEntry(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Record Deposit</DialogTitle></DialogHeader>
          {depositEntry && (
            <div className="space-y-4 pt-2">
              <div className="bg-gray-800 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-400">Holder</span><span className="text-white">{depositEntry.holderName}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Remaining</span><span className="text-white font-bold">{fmtINR(depositEntry.remainingBalance)}</span></div>
              </div>
              <div>
                <Label className="text-gray-300">Amount Deposited (₹)</Label>
                <Input
                  type="number"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                  value={depositForm.depositedAmount}
                  onChange={e => setDepositForm(f => ({ ...f, depositedAmount: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-gray-300">Bank Reference / Challan No.</Label>
                <Input
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                  placeholder="Optional"
                  value={depositForm.depositReference}
                  onChange={e => setDepositForm(f => ({ ...f, depositReference: e.target.value }))}
                />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setDepositEntry(null)}>Cancel</Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={depositMut.isPending}
                  onClick={() => depositMut.mutate({ id: depositEntry.id, data: { depositedAmount: parseFloat(depositForm.depositedAmount), depositReference: depositForm.depositReference || undefined } })}
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> Record
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
