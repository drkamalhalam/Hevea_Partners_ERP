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
  CreditCard, Truck, QrCode, AlertTriangle, FileText,
  Smartphone, Copy, Share2, IndianRupee
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
  payment_pending: "Waiting for Payment",
  payment_detected: "Payment Received",
  awaiting_manual_confirmation: "Waiting for Verification",
  confirmed: "Payment Confirmed",
  partially_dispatched: "Partially Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const UPI_APPS = [
  { label: "GPay", value: "upi_gpay", emoji: "🟢" },
  { label: "PhonePe", value: "upi_phonepe", emoji: "🟣" },
  { label: "Paytm", value: "upi_paytm", emoji: "🔵" },
  { label: "BHIM", value: "upi_bhim", emoji: "🟠" },
  { label: "Any UPI", value: "upi", emoji: "📱" },
  { label: "Net Banking", value: "neft", emoji: "🏦" },
  { label: "Cash", value: "cash", emoji: "💵" },
];

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
    <span className={`font-mono font-bold text-xl ${isUrgent ? "text-red-400 animate-pulse" : "text-amber-300"}`}>
      {m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}
    </span>
  );
}

function buildUpiUrl(upiId: string, payeeName: string, amount: string, orderRef: string) {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: parseFloat(amount).toFixed(2),
    tn: `Payment for ${orderRef}`,
    cu: "INR",
  });
  return `upi://pay?${params.toString()}`;
}

function UpiQRPanel({ order, receivers }: { order: any; receivers: any[] }) {
  const { toast } = useToast();
  const receiver = receivers.find((r: any) => r.id === order.paymentReceiverAccountId);
  const upiId = receiver?.paymentType === "upi" ? (receiver?.accountIdentifier ?? "") : "";
  const payeeName = receiver?.accountName ?? order.paymentReceiverName ?? "Hevea Partners";
  const amount = parseFloat(order.totalAmount ?? "0").toFixed(2);
  const orderRef = order.salesCode ?? "";

  const upiUrl = upiId
    ? buildUpiUrl(upiId, payeeName, amount, orderRef)
    : `Order: ${orderRef} | Amount: ₹${amount} | Pay to: ${payeeName}`;

  const qrData = upiId ? upiUrl : `${orderRef}|${amount}|${payeeName}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&ecc=M&margin=1&data=${encodeURIComponent(qrData)}`;

  const copyUpiId = () => {
    navigator.clipboard.writeText(upiId).then(() =>
      toast({ title: "UPI ID copied!" })
    );
  };

  return (
    <div className="space-y-5">
      {/* QR Code */}
      <div className="flex flex-col items-center gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-lg">
          <img
            src={qrImageUrl}
            alt="UPI Payment QR"
            className="w-56 h-56 block"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <div className="text-center">
          <div className="text-4xl font-extrabold text-white mb-1">{fmtINR(order.totalAmount)}</div>
          <div className="text-gray-400 text-sm">Order: <span className="font-mono text-gray-300">{orderRef}</span></div>
        </div>
      </div>

      {/* UPI ID + Open in App */}
      {upiId ? (
        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Pay to UPI ID</p>
              <p className="text-white font-mono text-base font-semibold">{upiId}</p>
              <p className="text-xs text-gray-400">{payeeName}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-gray-600 text-gray-300 hover:text-white flex-shrink-0"
              onClick={copyUpiId}
            >
              <Copy className="w-3.5 h-3.5 mr-1" /> Copy
            </Button>
          </div>
          <a href={upiUrl} className="block">
            <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-base font-semibold">
              <Smartphone className="w-5 h-5 mr-2" />
              Open in UPI App
            </Button>
          </a>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Pay to</p>
          <p className="text-white font-semibold text-lg">{payeeName}</p>
          {order.paymentMode === "cash" && (
            <p className="text-amber-400 text-sm mt-1">💵 Cash Payment</p>
          )}
        </div>
      )}

      {/* UPI App shortcuts */}
      {upiId && (
        <div>
          <p className="text-xs text-gray-500 text-center mb-2">Scan with any UPI app</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "GPay", emoji: "🟢" },
              { label: "PhonePe", emoji: "🟣" },
              { label: "Paytm", emoji: "🔵" },
              { label: "BHIM", emoji: "🟠" },
            ].map((app) => (
              <div
                key={app.label}
                className="flex flex-col items-center gap-1 p-2 bg-gray-800 rounded-xl text-center"
              >
                <span className="text-xl">{app.emoji}</span>
                <span className="text-xs text-gray-400">{app.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
        return ["payment_pending", "awaiting_manual_confirmation"].includes(s) ? 8000 : false;
      },
    },
  });

  const { data: receivers = [] } = useListPaymentReceivers({});

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetSalesOrderQueryKey(id!) });

  const requestPaymentMut = useRequestPayment({
    mutation: {
      onSuccess: invalidate,
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });
  const detectPaymentMut = useDetectPayment({
    mutation: {
      onSuccess: () => { invalidate(); setShowPaid(false); toast({ title: "Payment recorded! Waiting for verification." }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Duplicate or invalid payment" }),
    },
  });
  const confirmPaymentMut = useConfirmPayment({
    mutation: {
      onSuccess: () => { invalidate(); setShowConfirm(false); toast({ title: "Payment confirmed! Dispatch enabled." }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });
  const cancelMut = useCancelSalesOrder({
    mutation: {
      onSuccess: () => { invalidate(); setShowCancel(false); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });
  const dispatchMut = useDispatchSalesOrder({
    mutation: {
      onSuccess: () => { invalidate(); setShowDispatch(false); toast({ title: "Dispatch recorded" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const [showPaid, setShowPaid] = useState(false);
  const [paidForm, setPaidForm] = useState({
    amount: "",
    utr: "",
    app: "upi_gpay",
  });

  const [showDispatch, setShowDispatch] = useState(false);
  const [dispatchForm, setDispatchForm] = useState({ quantityKg: "", storeName: "", notes: "" });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmRef, setConfirmRef] = useState("");

  if (isLoading) return (
    <div className="space-y-4 max-w-lg mx-auto">
      {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-800 rounded-xl animate-pulse" />)}
    </div>
  );
  if (!order) return (
    <div className="text-center py-16 text-gray-400">
      <p>Order not found</p>
      <Button variant="link" className="text-gray-400 mt-2" onClick={() => navigate("/sales-orders")}>
        ← Back to Orders
      </Button>
    </div>
  );

  const canAdmin = ["admin", "developer"].includes(role ?? "");
  const canSell = ["admin", "developer", "employee", "landowner"].includes(role ?? "");
  const status = order.orderStatus;
  const remaining = parseFloat(order.quantityKg ?? "0") - parseFloat(order.quantityDispatchedKg ?? "0");

  const handleSubmitPayment = () => {
    const utr = paidForm.utr.trim();
    const app = UPI_APPS.find(a => a.value === paidForm.app);
    detectPaymentMut.mutate({
      id: id!,
      data: {
        amount: parseFloat(paidForm.amount || order.totalAmount || "0"),
        transactionReference: utr || undefined,
        paymentProvider: paidForm.app,
        notes: app ? `Paid via ${app.label}` : undefined,
      },
    });
  };

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      {/* Back */}
      <Button
        variant="ghost"
        className="text-gray-400 hover:text-white gap-2 p-0"
        onClick={() => navigate("/sales-orders")}
      >
        <ArrowLeft className="w-4 h-4" /> Back to Orders
      </Button>

      {/* Header — order summary */}
      <div className="bg-gray-800 rounded-2xl p-5 space-y-3 border border-gray-700">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Order ID</p>
            <p className="font-mono text-lg font-bold text-white">{order.salesCode}</p>
          </div>
          <Badge className={`border ${STATUS_COLORS[status ?? ""] ?? ""}`}>
            {STATUS_LABEL[status ?? ""] ?? status}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Buyer</p>
            <p className="text-white font-semibold">{order.buyerName}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">Amount</p>
            <p className="text-2xl font-extrabold text-white">{fmtINR(order.totalAmount)}</p>
          </div>
        </div>
        <div className="flex gap-4 text-sm text-gray-400 pt-1 border-t border-gray-700">
          <span>{parseFloat(order.quantityKg ?? "0").toFixed(1)} kg</span>
          <span>@</span>
          <span>₹{parseFloat(order.ratePerKg ?? "0").toFixed(2)}/kg</span>
          <span className="ml-auto">{fmt(order.createdAt)}</span>
        </div>
      </div>

      {/* ── DRAFT: Start Payment ─────────────────────────────────── */}
      {status === "draft" && canSell && (
        <Card className="bg-gray-800 border-emerald-500/30">
          <CardContent className="p-6 space-y-5">
            <div className="text-center space-y-2">
              <IndianRupee className="w-12 h-12 text-emerald-400 mx-auto" />
              <p className="text-white font-bold text-xl">Ready to Receive Payment</p>
              <p className="text-gray-400 text-sm">
                This will generate a UPI QR and reserve {parseFloat(order.quantityKg ?? "0").toFixed(1)} kg from inventory
              </p>
            </div>
            <div className="bg-gray-900 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Buyer</span>
                <span className="text-white font-medium">{order.buyerName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Quantity</span>
                <span className="text-white">{parseFloat(order.quantityKg ?? "0").toFixed(1)} kg</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Rate</span>
                <span className="text-white">₹{parseFloat(order.ratePerKg ?? "0").toFixed(2)}/kg</span>
              </div>
              <div className="flex justify-between font-bold border-t border-gray-700 pt-2 mt-2">
                <span className="text-gray-300">Total</span>
                <span className="text-emerald-400 text-xl">{fmtINR(order.totalAmount)}</span>
              </div>
            </div>
            <Button
              className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-base font-semibold rounded-xl"
              onClick={() => requestPaymentMut.mutate({ id: id! })}
              disabled={requestPaymentMut.isPending}
            >
              {requestPaymentMut.isPending ? "Generating QR..." : "Generate Payment QR"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── PAYMENT PENDING: UPI QR + Pay button ─────────────────── */}
      {status === "payment_pending" && (
        <Card className="bg-gray-800 border-amber-500/30">
          <CardContent className="p-5 space-y-5">
            {/* Countdown */}
            <div className="flex items-center justify-between bg-amber-950/40 border border-amber-500/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-amber-300">
                <Clock className="w-4 h-4" />
                <span className="text-sm font-medium">Time remaining</span>
              </div>
              {order.paymentExpiresAt
                ? <CountdownTimer expiresAt={order.paymentExpiresAt} />
                : <span className="text-amber-300 font-mono">—</span>
              }
            </div>

            {/* UPI QR Panel */}
            <UpiQRPanel order={order} receivers={receivers as any[]} />

            {/* Primary CTA: I Have Paid */}
            {canSell && (
              <Button
                className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-base font-bold rounded-xl"
                onClick={() => { setPaidForm({ amount: order.totalAmount ?? "", utr: "", app: "upi_gpay" }); setShowPaid(true); }}
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                I Have Paid
              </Button>
            )}

            <Button
              variant="ghost"
              className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10 text-sm"
              onClick={() => setShowCancel(true)}
            >
              Cancel Order
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── AWAITING VERIFICATION ────────────────────────────────── */}
      {["awaiting_manual_confirmation", "payment_detected"].includes(status ?? "") && (
        <Card className="bg-gray-800 border-blue-500/30">
          <CardContent className="p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle className="w-8 h-8 text-blue-400" />
              </div>
              <p className="text-white font-bold text-lg">Payment Received</p>
              <p className="text-gray-400 text-sm">
                Waiting for admin to verify and confirm. Dispatch will be enabled after confirmation.
              </p>
            </div>

            {(order as any).paymentTransactions?.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 space-y-3">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Payment Details</p>
                {(order as any).paymentTransactions.map((t: any) => (
                  <div key={t.id} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-300 font-semibold">{fmtINR(t.amount)}</span>
                      <Badge className={
                        t.verificationStatus === "matched"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 border text-xs"
                          : "bg-amber-500/20 text-amber-300 border-amber-500/30 border text-xs"
                      }>
                        {t.verificationStatus === "matched" ? "Amount Matched" : "Being Verified"}
                      </Badge>
                    </div>
                    {t.transactionReference && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">UTR:</span>
                        <span className="font-mono text-xs text-gray-300">{t.transactionReference}</span>
                      </div>
                    )}
                    {t.paymentProvider && (
                      <span className="text-xs text-gray-500 capitalize">
                        {UPI_APPS.find(a => a.value === t.paymentProvider)?.label ?? t.paymentProvider}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canAdmin && (
              <div className="flex gap-3 pt-2">
                <Button
                  className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 font-semibold"
                  onClick={() => setShowConfirm(true)}
                >
                  <CheckCircle className="w-4 h-4 mr-2" /> Confirm Payment
                </Button>
                <Button
                  variant="outline"
                  className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                  onClick={() => setShowCancel(true)}
                >
                  Reject
                </Button>
              </div>
            )}
            {!canAdmin && (
              <p className="text-center text-xs text-gray-500">
                An admin will verify your payment shortly
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── CONFIRMED / DISPATCH ─────────────────────────────────── */}
      {["confirmed", "partially_dispatched"].includes(status ?? "") && (
        <Card className="bg-gray-800 border-emerald-500/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-emerald-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <p className="text-white font-bold text-lg">Payment Confirmed</p>
                <p className="text-gray-400 text-xs">
                  Confirmed by {order.paymentConfirmedByName} · {fmt(order.paymentConfirmedAt)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center bg-gray-900 rounded-xl p-4">
              <div>
                <span className="text-gray-500 text-xs block">Ordered</span>
                <span className="text-white font-bold">{parseFloat(order.quantityKg ?? "0").toFixed(1)} kg</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Dispatched</span>
                <span className="text-cyan-400 font-bold">{parseFloat(order.quantityDispatchedKg ?? "0").toFixed(1)} kg</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Remaining</span>
                <span className={`font-bold ${remaining > 0 ? "text-amber-300" : "text-emerald-400"}`}>
                  {remaining.toFixed(1)} kg
                </span>
              </div>
            </div>
            {remaining > 0 && (
              <Button
                className="w-full h-12 bg-cyan-600 hover:bg-cyan-700 font-semibold"
                onClick={() => setShowDispatch(true)}
              >
                <Truck className="w-4 h-4 mr-2" /> Record Dispatch
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── COMPLETED ─────────────────────────────────────────────── */}
      {status === "completed" && (
        <Card className="bg-gray-800 border-green-500/30">
          <CardContent className="p-8 text-center space-y-3">
            <CheckCircle className="w-14 h-14 text-green-400 mx-auto" />
            <p className="text-white font-bold text-xl">Order Completed</p>
            <p className="text-gray-400 text-sm">
              All {parseFloat(order.quantityKg ?? "0").toFixed(1)} kg dispatched successfully
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── CANCELLED / EXPIRED ───────────────────────────────────── */}
      {["cancelled", "expired"].includes(status ?? "") && (
        <Card className="bg-gray-800 border-red-500/30">
          <CardContent className="p-8 text-center space-y-3">
            <XCircle className="w-14 h-14 text-red-400 mx-auto" />
            <p className="text-white font-bold text-xl">
              {status === "cancelled" ? "Order Cancelled" : "Payment Expired"}
            </p>
            {order.cancellationReason && (
              <p className="text-gray-400 text-sm">{order.cancellationReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── INVOICE ───────────────────────────────────────────────── */}
      {(order as any).invoice && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2 text-base">
              <FileText className="w-4 h-4 text-blue-400" /> Invoice
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Invoice No.</span>
                <div className="text-white font-mono">{(order as any).invoice.invoiceNumber}</div>
              </div>
              <div>
                <span className="text-gray-400">Date</span>
                <div className="text-white">{(order as any).invoice.invoiceDate}</div>
              </div>
              <div>
                <span className="text-gray-400">Dispatch Status</span>
                <div className="text-white capitalize">
                  {(order as any).invoice.dispatchStatus.replace(/_/g, " ")}
                </div>
              </div>
              <div>
                <span className="text-gray-400">Payment Ref</span>
                <div className="text-white">{(order as any).invoice.paymentReference ?? "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── ORDER DETAILS ─────────────────────────────────────────── */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader><CardTitle className="text-white text-base">Order Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ["Project", order.projectName],
              ["Buyer", order.buyerName],
              ["Seller", order.sellerName],
              ["Payment Mode", (order.paymentMode ?? "").replace(/_/g, " ")],
              ["Receiver", order.paymentReceiverName ?? "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="text-gray-400">{label}</span>
                <div className="text-white mt-0.5 font-medium">{value}</div>
              </div>
            ))}
          </div>
          {order.remarks && (
            <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-300">{order.remarks}</div>
          )}
        </CardContent>
      </Card>

      {/* ── DISPATCH HISTORY ──────────────────────────────────────── */}
      {(order as any).dispatches?.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white text-base">Dispatch History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(order as any).dispatches.map((d: any) => (
                <div key={d.id} className="flex justify-between items-center p-3 bg-gray-900 rounded-xl text-sm">
                  <div>
                    <span className="text-white font-semibold">{parseFloat(d.quantityKg).toFixed(1)} kg</span>
                    {d.storeName && <span className="text-gray-400 ml-2">from {d.storeName}</span>}
                    <div className="text-gray-500 text-xs mt-0.5">{fmt(d.dispatchedAt)} · {d.dispatchedByName}</div>
                  </div>
                  <Package className="w-4 h-4 text-cyan-500" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── AUDIT LOG ─────────────────────────────────────────────── */}
      {(order as any).audit?.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white text-base">Activity</CardTitle></CardHeader>
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

      {/* ═══ DIALOGS ═══════════════════════════════════════════════ */}

      {/* "I Have Paid" dialog — UPI-first */}
      <Dialog open={showPaid} onOpenChange={setShowPaid}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">Payment Proof</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-1">
            {/* Amount summary */}
            <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">Amount to pay</p>
              <p className="text-3xl font-extrabold text-emerald-400">{fmtINR(order.totalAmount)}</p>
              <p className="text-xs text-gray-500 font-mono mt-1">{order.salesCode}</p>
            </div>

            {/* App used */}
            <div>
              <Label className="text-gray-300 text-sm mb-2 block">How did you pay?</Label>
              <div className="grid grid-cols-3 gap-2">
                {UPI_APPS.map((app) => (
                  <button
                    key={app.value}
                    onClick={() => setPaidForm(f => ({ ...f, app: app.value }))}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border text-xs font-medium transition-all ${
                      paidForm.app === app.value
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                        : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500"
                    }`}
                  >
                    <span className="text-base">{app.emoji}</span>
                    {app.label}
                  </button>
                ))}
              </div>
            </div>

            {/* UTR (primary for UPI) */}
            {paidForm.app !== "cash" && (
              <div>
                <Label className="text-gray-300 text-sm">
                  UTR / Transaction ID
                  {paidForm.app.startsWith("upi") && (
                    <span className="text-amber-400 ml-1 text-xs">(required for UPI)</span>
                  )}
                </Label>
                <Input
                  className="bg-gray-800 border-gray-700 text-white mt-1.5 h-11 font-mono"
                  placeholder="e.g. 123456789012"
                  value={paidForm.utr}
                  onChange={e => setPaidForm(f => ({ ...f, utr: e.target.value }))}
                />
              </div>
            )}

            {/* Amount (editable — in case of partial payment) */}
            <div>
              <Label className="text-gray-300 text-sm">Amount Paid (₹)</Label>
              <Input
                className="bg-gray-800 border-gray-700 text-white mt-1.5 h-11"
                type="number"
                step="0.01"
                placeholder={order.totalAmount}
                value={paidForm.amount}
                onChange={e => setPaidForm(f => ({ ...f, amount: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">
                Leave blank if you paid the full amount: {fmtINR(order.totalAmount)}
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 border-gray-600 text-gray-300"
                onClick={() => setShowPaid(false)}
              >
                Back
              </Button>
              <Button
                className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 font-semibold"
                onClick={handleSubmitPayment}
                disabled={detectPaymentMut.isPending}
              >
                {detectPaymentMut.isPending ? "Submitting..." : "Submit Payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm payment dialog (admin) */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader><DialogTitle>Confirm Payment</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Order</span>
                <span className="text-white font-mono">{order.salesCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Buyer</span>
                <span className="text-white">{order.buyerName}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-emerald-500/20 pt-2 mt-1">
                <span className="text-gray-300">Amount</span>
                <span className="text-emerald-400 text-lg">{fmtINR(order.totalAmount)}</span>
              </div>
            </div>
            <div>
              <Label className="text-gray-300">Payment Reference (optional)</Label>
              <Input
                className="bg-gray-800 border-gray-700 text-white mt-1.5"
                placeholder="UTR / receipt number"
                value={confirmRef}
                onChange={e => setConfirmRef(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-400">
              Confirming will generate an invoice, update inventory, and enable dispatch.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-gray-600"
                onClick={() => setShowConfirm(false)}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => confirmPaymentMut.mutate({ id: id!, data: { paymentReference: confirmRef } })}
                disabled={confirmPaymentMut.isPending}
              >
                <CheckCircle className="w-4 h-4 mr-2" /> Confirm Payment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
              <Button
                variant="outline"
                className="flex-1 border-gray-600"
                onClick={() => setShowCancel(false)}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                onClick={() => cancelMut.mutate({ id: id!, data: { reason: cancelReason } })}
                disabled={cancelMut.isPending}
              >
                Cancel Order
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
            <div className="text-sm text-gray-400 bg-gray-800 rounded-xl p-3">
              Remaining: <span className="text-white font-bold">{remaining.toFixed(1)} kg</span>
            </div>
            <div>
              <Label className="text-gray-300">Quantity to Dispatch (kg)</Label>
              <Input
                className="bg-gray-800 border-gray-700 text-white mt-1.5"
                type="number"
                max={remaining}
                placeholder={remaining.toFixed(1)}
                value={dispatchForm.quantityKg}
                onChange={e => setDispatchForm(f => ({ ...f, quantityKg: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-gray-300">Source Store</Label>
              <Input
                className="bg-gray-800 border-gray-700 text-white mt-1.5"
                placeholder="Store name"
                value={dispatchForm.storeName}
                onChange={e => setDispatchForm(f => ({ ...f, storeName: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-gray-300">Notes (optional)</Label>
              <Input
                className="bg-gray-800 border-gray-700 text-white mt-1.5"
                placeholder="Optional notes"
                value={dispatchForm.notes}
                onChange={e => setDispatchForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-gray-600"
                onClick={() => setShowDispatch(false)}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-cyan-600 hover:bg-cyan-700"
                onClick={() => dispatchMut.mutate({
                  id: id!,
                  data: {
                    quantityKg: parseFloat(dispatchForm.quantityKg || remaining.toString()),
                    storeName: dispatchForm.storeName || undefined,
                    notes: dispatchForm.notes || undefined,
                  },
                })}
                disabled={dispatchMut.isPending}
              >
                <Truck className="w-4 h-4 mr-2" /> Record Dispatch
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
