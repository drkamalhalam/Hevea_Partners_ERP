import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, differenceInSeconds } from "date-fns";
import {
  useGetSalesOrder,
  useRequestPayment,
  useDetectPayment,
  useConfirmPayment,
  useCancelSalesOrder,
  useDispatchSalesOrder,
  useListPaymentReceivers,
  getGetSalesOrderQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import {
  ArrowLeft, CheckCircle, XCircle, Clock, Package,
  CreditCard, Truck, QrCode, AlertTriangle, FileText
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-500/20 text-gray-300 border-gray-500/30",
  payment_pending: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  payment_detected: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  awaiting_manual_confirmation: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  confirmed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  partially_dispatched: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  completed: "bg-green-500/20 text-green-300 border-green-500/30",
  cancelled: "bg-red-500/20 text-red-300 border-red-500/30",
  expired: "bg-gray-600/20 text-gray-400 border-gray-600/30",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  payment_pending: "Awaiting Payment",
  payment_detected: "Payment Detected",
  awaiting_manual_confirmation: "Pending Confirmation",
  confirmed: "Confirmed",
  partially_dispatched: "Partially Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
};

function fmtINR(v: string | number | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd MMM yyyy, HH:mm"); } catch { return v; }
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, differenceInSeconds(parseISO(expiresAt), new Date()))
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, differenceInSeconds(parseISO(expiresAt), new Date())));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const isUrgent = remaining < 120;
  return (
    <span className={`font-mono font-bold text-lg ${isUrgent ? "text-red-400 animate-pulse" : "text-amber-300"}`}>
      {m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}
    </span>
  );
}

function PaymentQRPanel({ order }: { order: any }) {
  const paymentString = [
    order.paymentReceiverName ? `Pay to: ${order.paymentReceiverName}` : null,
    `Amount: ₹${parseFloat(order.totalAmount).toFixed(2)}`,
    `Ref: ${order.salesCode}`,
    `Buyer: ${order.buyerName}`,
    `Project: ${order.projectName}`,
  ].filter(Boolean).join(" | ");

  return (
    <div className="bg-white rounded-xl p-6 text-center space-y-3 max-w-xs mx-auto">
      <div className="w-48 h-48 mx-auto border-4 border-gray-900 rounded-lg flex items-center justify-center bg-gray-50">
        <div className="space-y-2 text-center px-2">
          <QrCode className="w-12 h-12 text-gray-400 mx-auto" />
          <p className="text-xs text-gray-500 font-mono break-all">{order.salesCode}</p>
          <p className="text-sm font-bold text-gray-900">{fmtINR(order.totalAmount)}</p>
        </div>
      </div>
      <div className="text-left bg-gray-100 rounded-lg p-3 text-xs font-mono text-gray-700 break-all">
        {paymentString}
      </div>
      <p className="text-xs text-gray-500">Share this payment request with the buyer</p>
    </div>
  );
}

export default function SalesOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { role } = useRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: order, isLoading } = useGetSalesOrder(id!, {
    query: {
      queryKey: getGetSalesOrderQueryKey(id!),
      refetchInterval: (data: any) => {
        const s = data?.state?.data?.orderStatus;
        return ["payment_pending", "awaiting_manual_confirmation"].includes(s) ? 10000 : false;
      },
    },
  });

  const { data: receivers = [] } = useListPaymentReceivers({});

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(id!) });

  const requestPaymentMut = useRequestPayment({ mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) } });
  const detectPaymentMut = useDetectPayment({ mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) } });
  const confirmPaymentMut = useConfirmPayment({ mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) } });
  const cancelMut = useCancelSalesOrder({ mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) } });
  const dispatchMut = useDispatchSalesOrder({ mutation: { onSuccess: () => { invalidate(); setShowDispatch(false); toast({ title: "Dispatch recorded" }); }, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) } });

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showDetect, setShowDetect] = useState(false);
  const [detectForm, setDetectForm] = useState({ amount: "", transactionReference: "", paymentProvider: "manual" });
  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({ quantityKg: "", storeName: "", notes: "" });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmRef, setConfirmRef] = useState("");

  if (isLoading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-800 rounded-xl animate-pulse" />)}
    </div>
  );
  if (!order) return (
    <div className="text-center py-16 text-gray-400">
      <p>Order not found</p>
      <Button variant="link" className="text-gray-400 mt-2" onClick={() => navigate("/sales-orders")}>← Back to Orders</Button>
    </div>
  );

  const canAdmin = ["admin", "developer"].includes(role ?? "");
  const canSell = ["admin", "developer", "employee", "landowner"].includes(role ?? "");
  const status = order.orderStatus;
  const remaining = order.quantityKg && order.quantityDispatchedKg
    ? parseFloat(order.quantityKg) - parseFloat(order.quantityDispatchedKg ?? "0")
    : parseFloat(order.quantityKg ?? "0");

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" className="text-gray-400 hover:text-white gap-2 p-0" onClick={() => navigate("/sales-orders")}>
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-mono">{order.salesCode}</h1>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <Badge className={`border ${STATUS_COLORS[status ?? ""] ?? ""}`}>{STATUS_LABEL[status ?? ""] ?? status}</Badge>
            <span className="text-gray-400 text-sm">{fmt(order.createdAt)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white">{fmtINR(order.totalAmount)}</div>
          <div className="text-sm text-gray-400">{parseFloat(order.quantityKg ?? "0").toFixed(1)} kg @ ₹{parseFloat(order.ratePerKg ?? "0").toFixed(2)}/kg</div>
        </div>
      </div>

      {/* Payment workflow panel */}
      {status === "draft" && canSell && (
        <Card className="bg-gray-800 border-emerald-500/30">
          <CardContent className="p-6 text-center space-y-4">
            <CreditCard className="w-10 h-10 text-emerald-400 mx-auto" />
            <div>
              <p className="text-white font-semibold text-lg">Ready to Receive Payment</p>
              <p className="text-gray-400 text-sm mt-1">Click below to generate a payment request and reserve inventory</p>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 space-y-2 text-left">
              <div className="flex justify-between text-sm"><span className="text-gray-400">Buyer</span><span className="text-white">{order.buyerName}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Quantity</span><span className="text-white">{parseFloat(order.quantityKg ?? "0").toFixed(1)} kg</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Rate</span><span className="text-white">₹{parseFloat(order.ratePerKg ?? "0").toFixed(2)}/kg</span></div>
              <div className="flex justify-between font-bold"><span className="text-gray-300">Total</span><span className="text-emerald-400 text-lg">{fmtINR(order.totalAmount)}</span></div>
            </div>
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 text-base"
              onClick={() => requestPaymentMut.mutate({ id: id! })}
              disabled={requestPaymentMut.isPending}
            >
              {requestPaymentMut.isPending ? "Generating..." : "Receive Payment"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* QR payment panel */}
      {status === "payment_pending" && (
        <Card className="bg-gray-800 border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <QrCode className="w-5 h-5 text-amber-400" /> Payment Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-amber-900/20 rounded-lg border border-amber-500/20">
              <div className="flex items-center gap-2 text-amber-300">
                <Clock className="w-4 h-4" />
                <span className="text-sm">Expires in</span>
              </div>
              {order.paymentExpiresAt && <CountdownTimer expiresAt={order.paymentExpiresAt} />}
            </div>
            <PaymentQRPanel order={order} />
            <div className="grid grid-cols-3 gap-3 text-center text-sm pt-2">
              <div><span className="text-gray-400 block">Status</span><span className="text-amber-300 font-medium">Waiting for payment...</span></div>
              <div><span className="text-gray-400 block">Project</span><span className="text-white">{order.projectName}</span></div>
              <div><span className="text-gray-400 block">Receiver</span><span className="text-white">{order.paymentReceiverName ?? "—"}</span></div>
            </div>
            <div className="flex gap-3 pt-2">
              {canSell && (
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => setShowDetect(true)}>
                  Mark Payment Detected
                </Button>
              )}
              <Button variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10" onClick={() => setShowCancel(true)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Awaiting confirmation panel */}
      {["awaiting_manual_confirmation", "payment_detected"].includes(status ?? "") && (
        <Card className="bg-gray-800 border-purple-500/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-purple-400" />
              <div>
                <p className="text-white font-semibold">Payment Detected — Awaiting Manual Confirmation</p>
                <p className="text-gray-400 text-sm">An authorized user must verify and confirm this payment before the sale is finalized</p>
              </div>
            </div>
            {(order as any).paymentTransactions?.length > 0 && (
              <div className="bg-gray-900 rounded-lg p-3 text-sm space-y-1">
                {(order as any).paymentTransactions.map((t: any) => (
                  <div key={t.id} className="flex justify-between">
                    <span className="text-gray-400">{t.paymentProvider} · {t.transactionReference ?? "No Ref"}</span>
                    <span className="text-white font-medium">{fmtINR(t.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {canAdmin && (
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-purple-600 hover:bg-purple-700 h-11"
                  onClick={() => setShowConfirm(true)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> Confirm Payment
                </Button>
                <Button variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10" onClick={() => setShowCancel(true)}>
                  Reject
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmed / dispatch panel */}
      {["confirmed", "partially_dispatched"].includes(status ?? "") && (
        <Card className="bg-gray-800 border-emerald-500/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-emerald-400" />
              <div>
                <p className="text-white font-semibold">Payment Confirmed</p>
                <p className="text-gray-400 text-sm">Confirmed by {order.paymentConfirmedByName} · {fmt(order.paymentConfirmedAt)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-sm bg-gray-900 rounded-lg p-4">
              <div><span className="text-gray-400 block">Ordered</span><span className="text-white font-bold">{parseFloat(order.quantityKg ?? "0").toFixed(1)} kg</span></div>
              <div><span className="text-gray-400 block">Dispatched</span><span className="text-cyan-400 font-bold">{parseFloat(order.quantityDispatchedKg ?? "0").toFixed(1)} kg</span></div>
              <div><span className="text-gray-400 block">Remaining</span><span className={`font-bold ${remaining > 0 ? "text-amber-300" : "text-emerald-400"}`}>{remaining.toFixed(1)} kg</span></div>
            </div>
            {remaining > 0 && (
              <Button className="w-full bg-cyan-600 hover:bg-cyan-700" onClick={() => setShowDispatch(true)}>
                <Truck className="w-4 h-4 mr-2" /> Record Dispatch
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completed */}
      {status === "completed" && (
        <Card className="bg-gray-800 border-green-500/30">
          <CardContent className="p-6 text-center">
            <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-3" />
            <p className="text-white font-semibold text-lg">Order Completed</p>
            <p className="text-gray-400 text-sm">All {parseFloat(order.quantityKg ?? "0").toFixed(1)} kg dispatched</p>
          </CardContent>
        </Card>
      )}

      {/* Cancelled/expired */}
      {["cancelled", "expired"].includes(status ?? "") && (
        <Card className="bg-gray-800 border-red-500/30">
          <CardContent className="p-6 text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-white font-semibold text-lg">{status === "cancelled" ? "Order Cancelled" : "Payment Expired"}</p>
            {order.cancellationReason && <p className="text-gray-400 text-sm mt-1">{order.cancellationReason}</p>}
          </CardContent>
        </Card>
      )}

      {/* Invoice */}
      {(order as any).invoice && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" /> Invoice
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-400">Invoice No.</span><div className="text-white font-mono">{(order as any).invoice.invoiceNumber}</div></div>
              <div><span className="text-gray-400">Date</span><div className="text-white">{(order as any).invoice.invoiceDate}</div></div>
              <div><span className="text-gray-400">Dispatch Status</span><div className="text-white capitalize">{(order as any).invoice.dispatchStatus.replace(/_/g, " ")}</div></div>
              <div><span className="text-gray-400">Payment Ref</span><div className="text-white">{(order as any).invoice.paymentReference ?? "—"}</div></div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Order details */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader><CardTitle className="text-white">Order Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ["Project", order.projectName],
              ["Buyer", order.buyerName],
              ["Seller", order.sellerName],
              ["Role", order.sellerRole],
              ["Payment Mode", (order.paymentMode ?? "").replace(/_/g, " ")],
              ["Receiver", order.paymentReceiverName ?? "—"],
            ].map(([label, value]) => (
              <div key={label}><span className="text-gray-400">{label}</span><div className="text-white mt-0.5">{value}</div></div>
            ))}
          </div>
          {order.remarks && <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-300">{order.remarks}</div>}
        </CardContent>
      </Card>

      {/* Dispatch history */}
      {(order as any).dispatches?.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white">Dispatch History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(order as any).dispatches.map((d: any) => (
                <div key={d.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-lg text-sm">
                  <div>
                    <span className="text-white font-medium">{parseFloat(d.quantityKg).toFixed(1)} kg</span>
                    {d.storeName && <span className="text-gray-400 ml-2">from {d.storeName}</span>}
                    <div className="text-gray-500 text-xs mt-0.5">{fmt(d.dispatchedAt)} · {d.dispatchedByName}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit log */}
      {(order as any).audit?.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white">Audit Log</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(order as any).audit.map((a: any) => (
                <div key={a.id} className="flex gap-3 text-sm p-2 hover:bg-gray-900 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="text-white">{a.description}</span>
                    <div className="text-gray-500 text-xs mt-0.5">{fmt(a.createdAt)} · {a.actorName}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel dialog */}
      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Cancel Order</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              className="bg-gray-800 border-gray-700 text-white"
              placeholder="Reason for cancellation"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
            />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setShowCancel(false)}>Back</Button>
              <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => { cancelMut.mutate({ id: id!, data: { reason: cancelReason } }); setShowCancel(false); }} disabled={cancelMut.isPending}>
                Confirm Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detect payment dialog */}
      <Dialog open={showDetect} onOpenChange={setShowDetect}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Record Payment Detection</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-gray-300">Amount Received (₹)</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" type="number" placeholder={order.totalAmount} value={detectForm.amount} onChange={e => setDetectForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-gray-300">Transaction Reference</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="UTR / txn ID" value={detectForm.transactionReference} onChange={e => setDetectForm(f => ({ ...f, transactionReference: e.target.value }))} />
            </div>
            <div>
              <Label className="text-gray-300">Payment Provider</Label>
              <Select value={detectForm.paymentProvider} onValueChange={v => setDetectForm(f => ({ ...f, paymentProvider: v }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual Entry</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="neft">NEFT</SelectItem>
                  <SelectItem value="rtgs">RTGS</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setShowDetect(false)}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={() => { detectPaymentMut.mutate({ id: id!, data: { amount: parseFloat(detectForm.amount || order.totalAmount || "0"), transactionReference: detectForm.transactionReference, paymentProvider: detectForm.paymentProvider } }); setShowDetect(false); }} disabled={detectPaymentMut.isPending}>
                Record Detection
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm payment dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Confirm Payment</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Order</span><span className="text-white">{order.salesCode}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Buyer</span><span className="text-white">{order.buyerName}</span></div>
              <div className="flex justify-between font-bold"><span className="text-gray-300">Amount</span><span className="text-emerald-400">{fmtINR(order.totalAmount)}</span></div>
            </div>
            <div>
              <Label className="text-gray-300">Payment Reference (optional)</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="UTR / receipt number" value={confirmRef} onChange={e => setConfirmRef(e.target.value)} />
            </div>
            <p className="text-xs text-gray-400">This will: generate invoice, update inventory, create money custody record, and enable dispatch.</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => { confirmPaymentMut.mutate({ id: id!, data: { paymentReference: confirmRef } }); setShowConfirm(false); }} disabled={confirmPaymentMut.isPending}>
                <CheckCircle className="w-4 h-4 mr-2" /> Confirm Payment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dispatch dialog */}
      <Dialog open={showDispatch} onOpenChange={setShowDispatch}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Record Dispatch</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="text-sm text-gray-400 bg-gray-800 rounded-lg p-3">
              Remaining: <span className="text-white font-bold">{remaining.toFixed(1)} kg</span>
            </div>
            <div>
              <Label className="text-gray-300">Quantity to Dispatch (kg)</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" type="number" max={remaining} placeholder={remaining.toFixed(1)} value={dispatchForm.quantityKg} onChange={e => setDispatchForm(f => ({ ...f, quantityKg: e.target.value }))} />
            </div>
            <div>
              <Label className="text-gray-300">Source Store</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="Store name" value={dispatchForm.storeName} onChange={e => setDispatchForm(f => ({ ...f, storeName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-gray-300">Notes</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="Optional" value={dispatchForm.notes} onChange={e => setDispatchForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setShowDispatch(false)}>Cancel</Button>
              <Button className="flex-1 bg-cyan-600 hover:bg-cyan-700" onClick={() => dispatchMut.mutate({ id: id!, data: { quantityKg: parseFloat(dispatchForm.quantityKg || remaining.toString()), storeName: dispatchForm.storeName || undefined, notes: dispatchForm.notes || undefined } })} disabled={dispatchMut.isPending}>
                <Truck className="w-4 h-4 mr-2" /> Record Dispatch
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
