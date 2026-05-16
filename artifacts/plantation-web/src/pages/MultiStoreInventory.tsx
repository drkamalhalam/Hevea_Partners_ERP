import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "../lib/authFetch";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  LayoutGrid,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowLeftRight,
  Clock,
  Package,
  ShieldCheck,
} from "lucide-react";
import { useRole } from "@/contexts/RoleContext";
import { useListProjects } from "@workspace/api-client-react";

interface OwnershipEntry {
  stockType: string;
  totalIn: number;
  totalOut: number;
  net: number;
}

interface PhysicalLocation {
  id: string;
  projectId: string;
  storeId: string;
  storeName: string;
  storeType: string;
  storeCode: string;
  stockType: string;
  quantityKg: string;
  zone: string | null;
  rack: string | null;
}

interface PendingTransfer {
  id: string;
  transferCode: string;
  fromStoreName: string;
  toStoreName: string;
  stockType: string;
  quantityKg: string;
  transferStatus: string;
  createdAt: string;
}

interface ActiveMemo {
  id: string;
  memoCode: string;
  buyerName: string;
  storeName: string;
  stockType: string;
  totalOrderedKg: string;
  totalDispatchedKg: string;
  remainingKg: string;
  dispatchStatus: string;
}

interface ReconciliationEntry {
  stockType: string;
  ownedKg: number;
  physicalKg: number;
  discrepancyKg: number;
  reconciled: boolean;
}

interface Dashboard {
  project: { id: string; name: string; lifecycleStatus: string };
  ownership: OwnershipEntry[];
  physicalDistribution: PhysicalLocation[];
  pendingTransfers: PendingTransfer[];
  activeMemos: ActiveMemo[];
  reconciliation: ReconciliationEntry[];
}

function fmt(v: number | string): string {
  return typeof v === "string" ? parseFloat(v).toFixed(2) : v.toFixed(2);
}

const STOCK_TYPE_LABELS: Record<string, string> = {
  rubber_sheet: "Rubber Sheet",
  rubber_scrap: "Rubber Scrap",
  latex: "Latex",
};

const STORE_TYPE_COLORS: Record<string, string> = {
  project_store: "bg-blue-100 text-blue-800",
  central_store: "bg-emerald-100 text-emerald-800",
  overflow_store: "bg-amber-100 text-amber-800",
};

export default function MultiStoreInventory() {
  const authFetch = useAuthFetch();
  const { role } = useRole();
  const { data: projects = [] } = useListProjects();

  const [projectId, setProjectId] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/multi-store/dashboard/${pid}`);
      if (!r.ok) {
        const e = await r.json() as { error?: string };
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as Dashboard;
      setDashboard(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) fetchDashboard(projectId);
  }, [projectId, fetchDashboard]);

  // Group physical by store → stock types
  const storeGroups: Record<string, { storeName: string; storeType: string; storeCode: string; items: PhysicalLocation[] }> = {};
  for (const loc of dashboard?.physicalDistribution ?? []) {
    if (!storeGroups[loc.storeId]) {
      storeGroups[loc.storeId] = {
        storeName: loc.storeName,
        storeType: loc.storeType,
        storeCode: loc.storeCode,
        items: [],
      };
    }
    storeGroups[loc.storeId].items.push(loc);
  }

  const allReconciled = dashboard?.reconciliation.every((r) => r.reconciled) ?? true;
  const physicalTotal = Object.values(dashboard?.physicalDistribution.reduce((acc, loc) => {
    acc[loc.stockType] = (acc[loc.stockType] ?? 0) + parseFloat(loc.quantityKg);
    return acc;
  }, {} as Record<string, number>) ?? {});

  return (
    <div className="p-6 space-y-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <LayoutGrid className="w-6 h-6 text-gray-700" />
              <h1 className="text-2xl font-bold text-gray-900">Multi-Store Inventory</h1>
            </div>
            <p className="text-sm text-gray-500">
              Project inventory dashboard — ownership vs physical distribution
            </p>
          </div>
          {dashboard && (
            <Button variant="outline" size="sm" onClick={() => fetchDashboard(projectId)} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </div>

        {/* Project selector */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-4">
              <Label className="text-sm font-medium whitespace-nowrap">Select Project</Label>
              <div className="max-w-xs w-full">
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a project to view dashboard..." />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {dashboard?.project.lifecycleStatus && (
                <Badge variant="outline" className="capitalize text-xs">
                  {dashboard.project.lifecycleStatus.replace("_", " ")}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {!projectId && (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-sm text-gray-400">
              Select a project to view the inventory dashboard
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        )}

        {dashboard && !loading && (
          <>
            {/* Ownership summary */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Ownership Ledger
                <span className="text-xs font-normal text-gray-400">(computed from production, sales & transfer movements)</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {dashboard.ownership.length === 0 ? (
                  <Card className="col-span-3">
                    <CardContent className="py-8 text-center text-sm text-gray-400">No stock movements recorded</CardContent>
                  </Card>
                ) : (
                  dashboard.ownership.map((o) => (
                    <Card key={o.stockType}>
                      <CardContent className="pt-4 pb-3">
                        <p className="text-xs text-gray-500 mb-2">{STOCK_TYPE_LABELS[o.stockType] ?? o.stockType}</p>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Total In</span>
                            <span className="font-mono">{fmt(o.totalIn)} kg</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Total Out</span>
                            <span className="font-mono text-red-600">−{fmt(o.totalOut)} kg</span>
                          </div>
                          <Separator className="my-1.5" />
                          <div className="flex justify-between text-sm font-semibold">
                            <span>Net Owned</span>
                            <span className="font-mono text-emerald-700">{fmt(o.net)} kg</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>

            {/* Reconciliation status */}
            <Card className={allReconciled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2">
                  {allReconciled ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  )}
                  <span className={`text-sm font-medium ${allReconciled ? "text-emerald-800" : "text-amber-800"}`}>
                    {allReconciled
                      ? "Ownership and physical stock are fully reconciled"
                      : "Discrepancy detected — ownership totals and physical stock do not match"}
                  </span>
                </div>
                {!allReconciled && (
                  <div className="mt-2 space-y-1">
                    {dashboard.reconciliation
                      .filter((r) => !r.reconciled)
                      .map((r) => (
                        <p key={r.stockType} className="text-xs text-amber-700 pl-6">
                          {STOCK_TYPE_LABELS[r.stockType] ?? r.stockType}: owned {fmt(r.ownedKg)} kg, physical {fmt(r.physicalKg)} kg,
                          discrepancy {r.discrepancyKg > 0 ? "+" : ""}{fmt(r.discrepancyKg)} kg
                        </p>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Physical distribution */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Package className="w-4 h-4" /> Physical Stock Distribution
              </h2>
              {Object.keys(storeGroups).length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm text-gray-400">
                    No physical stock recorded in any store for this project.
                    Use <strong>Stores → Record Entry</strong> or the inventory locations API to place stock.
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {Object.values(storeGroups).map((group) => {
                    const groupTotal = group.items.reduce((s, i) => s + parseFloat(i.quantityKg), 0);
                    return (
                      <Card key={group.storeCode}>
                        <CardContent className="pt-4 pb-3">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-gray-900">{group.storeName}</span>
                              <span className="font-mono text-xs text-gray-400">{group.storeCode}</span>
                              <Badge className={`text-xs ${STORE_TYPE_COLORS[group.storeType] ?? "bg-gray-100 text-gray-700"}`}>
                                {group.storeType.replace("_", " ")}
                              </Badge>
                            </div>
                            <span className="text-sm font-semibold text-gray-700 font-mono">{fmt(groupTotal)} kg total</span>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {group.items.map((loc) => (
                              <div key={loc.id} className="bg-gray-50 rounded-lg p-2.5">
                                <p className="text-xs text-gray-500">{STOCK_TYPE_LABELS[loc.stockType] ?? loc.stockType}</p>
                                <p className="text-base font-bold text-gray-900 font-mono">{fmt(loc.quantityKg)} kg</p>
                                {(loc.zone || loc.rack) && (
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    {[loc.zone, loc.rack].filter(Boolean).join(" / ")}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pending transfers */}
            {dashboard.pendingTransfers.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4" />
                  Pending Transfers
                  <Badge variant="outline" className="text-xs">{dashboard.pendingTransfers.length}</Badge>
                </h2>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code</TableHead>
                          <TableHead>From → To</TableHead>
                          <TableHead>Stock</TableHead>
                          <TableHead className="text-right">Qty (kg)</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dashboard.pendingTransfers.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="font-mono text-xs">{t.transferCode}</TableCell>
                            <TableCell className="text-xs">
                              <span className="text-gray-600">{t.fromStoreName}</span>
                              <span className="text-gray-400 mx-1">→</span>
                              <span className="text-gray-600">{t.toStoreName}</span>
                            </TableCell>
                            <TableCell className="text-xs capitalize">{t.stockType.replace("_", " ")}</TableCell>
                            <TableCell className="text-xs font-mono text-right">{fmt(t.quantityKg)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs flex items-center gap-1 w-fit">
                                <Clock className="w-3 h-3" />
                                {t.transferStatus}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Active dispatch memos */}
            {dashboard.activeMemos.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Active Dispatch Memos
                  <Badge variant="outline" className="text-xs">{dashboard.activeMemos.length}</Badge>
                </h2>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Memo</TableHead>
                          <TableHead>Buyer</TableHead>
                          <TableHead>Store</TableHead>
                          <TableHead>Ordered</TableHead>
                          <TableHead>Dispatched</TableHead>
                          <TableHead>Remaining</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dashboard.activeMemos.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="font-mono text-xs">{m.memoCode}</TableCell>
                            <TableCell className="text-xs">{m.buyerName}</TableCell>
                            <TableCell className="text-xs">{m.storeName}</TableCell>
                            <TableCell className="text-xs font-mono text-right">{fmt(m.totalOrderedKg)}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-emerald-700">{fmt(m.totalDispatchedKg)}</TableCell>
                            <TableCell className="text-xs font-mono text-right text-amber-700">{fmt(m.remainingKg)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs capitalize">
                                {m.dispatchStatus.replace("_", " ")}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
    </div>
  );
}

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <label className={`text-sm font-medium text-gray-700 ${className ?? ""}`}>{children}</label>;
}
