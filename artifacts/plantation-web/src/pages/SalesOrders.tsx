import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO, differenceInMinutes } from "date-fns";
import {
  useListSalesOrders,
  useCreateSalesOrder,
  useListBuyers,
  useListPaymentReceivers,
  useListProjects,
  getListSalesOrdersQueryKey,
} from "@workspace/api-client-react";
import type { SalesOrder, CreateSalesOrderBody } from "@workspace/api-client-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { Link } from "wouter";
import { Plus, ArrowRight, Search, Package } from "lucide-react";

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
  partially_dispatched: "Part Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
};

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd MMM yyyy, HH:mm"); } catch { return v; }
}

function fmtINR(v: string | number | null | undefined) {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function SalesOrders() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  const { data: orders = [], isLoading } = useListSalesOrders({
    projectId: selectedProjectId ?? undefined,
  });
  const { data: buyers = [] } = useListBuyers({});
  const { data: receivers = [] } = useListPaymentReceivers({
    projectId: selectedProjectId ?? undefined,
  });
  const { data: projects = [] } = useListProjects();

  const createMutation = useCreateSalesOrder({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSalesOrdersQueryKey() });
        setShowCreate(false);
        toast({ title: "Sales order created" });
      },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Failed to create order" }),
    },
  });

  const [form, setForm] = useState({
    projectId: selectedProjectId ?? "",
    buyerId: "",
    buyerName: "",
    quantityKg: "",
    ratePerKg: "",
    paymentMode: "online_only",
    paymentReceiverAccountId: "",
    remarks: "",
  });

  const totalAmount = form.quantityKg && form.ratePerKg
    ? (parseFloat(form.quantityKg) * parseFloat(form.ratePerKg)).toFixed(2)
    : null;

  const handleCreate = () => {
    if (!form.projectId || !form.buyerName || !form.quantityKg || !form.ratePerKg) {
      toast({ variant: "destructive", title: "Fill all required fields" });
      return;
    }
    const body: CreateSalesOrderBody = {
      projectId: form.projectId,
      buyerName: form.buyerName,
      quantityKg: parseFloat(form.quantityKg),
      ratePerKg: parseFloat(form.ratePerKg),
      paymentMode: form.paymentMode as any,
      remarks: form.remarks || undefined,
    };
    if (form.buyerId) body.buyerId = form.buyerId;
    if (form.paymentReceiverAccountId) body.paymentReceiverAccountId = form.paymentReceiverAccountId;
    createMutation.mutate({ data: body });
  };

  const handleBuyerSelect = (buyerId: string) => {
    const buyer = buyers.find((b: any) => b.id === buyerId);
    setForm(f => ({ ...f, buyerId, buyerName: buyer?.name ?? "" }));
  };

  const filtered = orders.filter((o: SalesOrder) => {
    const matchSearch = !search || (o.salesCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (o.buyerName ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.orderStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  const activeReceivers = receivers.filter((r: any) => r.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Sales Orders</h1>
          <p className="text-sm text-gray-400 mt-1">Create and manage rubber sales with payment workflow</p>
        </div>
        {["admin", "developer", "employee", "landowner"].includes(role ?? "") && (
          <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700 gap-2">
            <Plus className="w-4 h-4" /> New Sale
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by code or buyer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-gray-800 border-gray-700 text-white"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48 bg-gray-800 border-gray-700 text-white">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Orders list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="flex flex-col items-center py-16 text-gray-400 gap-3">
            <Package className="w-12 h-12 opacity-30" />
            <p className="text-lg font-medium">No sales orders yet</p>
            <p className="text-sm">Create a new sale to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((order: SalesOrder) => {
            const isExpiring = order.paymentExpiresAt &&
              differenceInMinutes(parseISO(order.paymentExpiresAt), new Date()) < 10 &&
              differenceInMinutes(parseISO(order.paymentExpiresAt), new Date()) > 0;
            return (
              <Link key={order.id} href={`/sales-orders/${order.id}`}>
                <Card className={`bg-gray-800 border-gray-700 hover:border-gray-500 transition-all cursor-pointer ${isExpiring ? "border-amber-500/50" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-white">{order.salesCode}</span>
                          <Badge className={`text-xs border ${STATUS_COLORS[order.orderStatus as keyof typeof STATUS_COLORS] ?? "bg-gray-700 text-gray-300"}`}>
                            {STATUS_LABEL[order.orderStatus as keyof typeof STATUS_LABEL] ?? order.orderStatus}
                          </Badge>
                          {isExpiring && <Badge className="text-xs border bg-amber-500/20 text-amber-300 border-amber-500/30 animate-pulse">Expiring Soon</Badge>}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-300">
                          <span><span className="text-gray-500">Buyer:</span> {order.buyerName}</span>
                          <span><span className="text-gray-500">Qty:</span> {parseFloat(order.quantityKg ?? "0").toFixed(1)} kg</span>
                          <span><span className="text-gray-500">Rate:</span> ₹{parseFloat(order.ratePerKg ?? "0").toFixed(2)}/kg</span>
                          <span className="font-semibold text-white">{fmtINR(order.totalAmount)}</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">{fmt(order.createdAt)}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create order dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>New Sales Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-gray-300">Project *</Label>
              <Select value={form.projectId} onValueChange={v => setForm(f => ({ ...f, projectId: v }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-300">Buyer</Label>
              <Select value={form.buyerId} onValueChange={handleBuyerSelect}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                  <SelectValue placeholder="Select from approved buyers" />
                </SelectTrigger>
                <SelectContent>
                  {buyers.filter((b: any) => b.isActive).map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.buyerId && (
                <Input
                  className="bg-gray-800 border-gray-700 text-white mt-2"
                  placeholder="Or type buyer name manually"
                  value={form.buyerName}
                  onChange={e => setForm(f => ({ ...f, buyerName: e.target.value }))}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Quantity (kg) *</Label>
                <Input
                  type="number"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                  placeholder="e.g. 500"
                  value={form.quantityKg}
                  onChange={e => setForm(f => ({ ...f, quantityKg: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-gray-300">Rate per kg (₹) *</Label>
                <Input
                  type="number"
                  className="bg-gray-800 border-gray-700 text-white mt-1"
                  placeholder="e.g. 162"
                  value={form.ratePerKg}
                  onChange={e => setForm(f => ({ ...f, ratePerKg: e.target.value }))}
                />
              </div>
            </div>
            {totalAmount && (
              <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-4 text-center">
                <p className="text-gray-400 text-sm">Total Amount Payable</p>
                <p className="text-3xl font-bold text-emerald-400 mt-1">{fmtINR(totalAmount)}</p>
              </div>
            )}
            <div>
              <Label className="text-gray-300">Payment Mode</Label>
              <Select value={form.paymentMode} onValueChange={v => setForm(f => ({ ...f, paymentMode: v }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="online_only">Online Only</SelectItem>
                  <SelectItem value="cash_only">Cash Only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {activeReceivers.length > 0 && (
              <div>
                <Label className="text-gray-300">Payment Receiver Account</Label>
                <Select value={form.paymentReceiverAccountId} onValueChange={v => setForm(f => ({ ...f, paymentReceiverAccountId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                    <SelectValue placeholder="Select approved account" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeReceivers.map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.accountName} ({r.paymentType.toUpperCase()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-gray-300">Remarks</Label>
              <Input
                className="bg-gray-800 border-gray-700 text-white mt-1"
                placeholder="Optional notes"
                value={form.remarks}
                onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 border-gray-600 text-gray-300" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Order"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
