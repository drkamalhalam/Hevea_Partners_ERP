import { useState } from "react";
import { format, parseISO } from "date-fns";
import {
  useListSalesOrders,
  useGetSalesOrderStats,
  useListProjects,
  useListSalesInvoices,
} from "@workspace/api-client-react";
import type { SalesOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { Link } from "wouter";
import {
  TrendingUp, Package, CheckCircle, Clock, XCircle,
  BarChart3, IndianRupee, ArrowRight
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
  partially_dispatched: "Part Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
};

function fmtINR(v: number) {
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd MMM yyyy"); } catch { return v; }
}

export default function SalesOrderDashboard() {
  const { selectedProjectId } = useProjectFilter();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: orders = [], isLoading } = useListSalesOrders({
    projectId: selectedProjectId ?? undefined,
    limit: "200",
  });
  const { data: stats } = useGetSalesOrderStats({ projectId: selectedProjectId ?? undefined });
  const { data: invoices = [] } = useListSalesInvoices({ projectId: selectedProjectId ?? undefined, limit: "20" });

  const filtered = statusFilter === "all"
    ? orders
    : orders.filter((o: SalesOrder) => o.orderStatus === statusFilter);

  const pending = orders.filter((o: SalesOrder) =>
    ["payment_pending", "awaiting_manual_confirmation", "payment_detected"].includes(o.orderStatus ?? "")
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Sales Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">Overview of rubber sales, payments, and dispatches</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Package className="w-8 h-8 text-blue-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Total Orders</p>
                <p className="text-2xl font-bold text-white">{stats?.total ?? orders.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <IndianRupee className="w-8 h-8 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Confirmed Revenue</p>
                <p className="text-lg font-bold text-emerald-400">{fmtINR(stats?.confirmedRevenue ?? 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Pending Confirmation</p>
                <p className="text-2xl font-bold text-amber-400">{pending.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Completed</p>
                <p className="text-2xl font-bold text-green-400">{stats?.byStatus?.completed ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending actions alert */}
      {pending.length > 0 && (
        <Card className="bg-amber-900/20 border-amber-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-400" />
              <div>
                <p className="text-amber-300 font-medium">{pending.length} order{pending.length > 1 ? "s" : ""} need attention</p>
                <p className="text-amber-400/70 text-sm">Payment confirmation or order action required</p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {pending.slice(0, 3).map((o: SalesOrder) => (
                <Link key={o.id} href={`/sales-orders/${o.id}`}>
                  <div className="flex items-center justify-between p-2 bg-amber-900/30 rounded-lg hover:bg-amber-900/50 transition-colors cursor-pointer">
                    <span className="font-mono text-sm text-white">{o.salesCode}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium text-sm">₹{parseFloat(o.totalAmount ?? "0").toLocaleString("en-IN")}</span>
                      <Badge className={`text-xs border ${STATUS_COLORS[o.orderStatus ?? ""] ?? ""}`}>{STATUS_LABEL[o.orderStatus ?? ""] ?? o.orderStatus}</Badge>
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status breakdown */}
      {stats?.byStatus && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-blue-400" />Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {Object.entries(STATUS_LABEL).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setStatusFilter(k)}
                  className={`p-3 rounded-lg text-center transition-all ${statusFilter === k ? "ring-2 ring-white" : ""} ${STATUS_COLORS[k]}`}
                >
                  <p className="text-xl font-bold">{(stats.byStatus as Record<string, number>)?.[k] ?? 0}</p>
                  <p className="text-xs mt-0.5 opacity-80">{l}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Orders table */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">All Orders</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48 bg-gray-700 border-gray-600 text-white h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-700 rounded animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No orders matching this filter</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    {["Code", "Buyer", "Qty (kg)", "Rate", "Total", "Status", "Date", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-gray-400 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o: SalesOrder) => (
                    <tr key={o.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="px-4 py-3 font-mono text-white">{o.salesCode}</td>
                      <td className="px-4 py-3 text-gray-300">{o.buyerName}</td>
                      <td className="px-4 py-3 text-gray-300">{parseFloat(o.quantityKg ?? "0").toFixed(1)}</td>
                      <td className="px-4 py-3 text-gray-300">₹{parseFloat(o.ratePerKg ?? "0").toFixed(2)}</td>
                      <td className="px-4 py-3 text-white font-medium">{fmtINR(parseFloat(o.totalAmount ?? "0"))}</td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs border ${STATUS_COLORS[o.orderStatus ?? ""] ?? ""}`}>{STATUS_LABEL[o.orderStatus ?? ""] ?? o.orderStatus}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{fmt(o.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/sales-orders/${o.id}`}>
                          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-1 h-auto">
                            <ArrowRight className="w-4 h-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent invoices */}
      {invoices.length > 0 && (
        <Card className="bg-gray-800 border-gray-700">
          <CardHeader><CardTitle className="text-white">Recent Invoices</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  {["Invoice No.", "Buyer", "Amount", "Dispatch", "Date"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => (
                  <tr key={inv.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="px-4 py-3 font-mono text-blue-400">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-300">{inv.buyerName}</td>
                    <td className="px-4 py-3 text-white font-medium">{fmtINR(parseFloat(inv.totalAmount))}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs border ${inv.dispatchStatus === "fully_dispatched" ? "bg-green-500/20 text-green-300 border-green-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
                        {(inv.dispatchStatus ?? "").replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{inv.invoiceDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
