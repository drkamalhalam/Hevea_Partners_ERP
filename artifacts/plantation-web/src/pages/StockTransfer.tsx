import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeftRight,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Info,
  AlertTriangle,
} from "lucide-react";
import { useRole } from "@/contexts/RoleContext";
import { useListProjects } from "@workspace/api-client-react";

interface Store {
  id: string;
  storeName: string;
  storeCode: string;
  storeType: string;
  capacityKg: string;
  currentOccupancyKg: string;
  isActive: boolean;
}

interface Transfer {
  id: string;
  transferCode: string;
  projectName?: string;
  fromStoreName?: string;
  toStoreName?: string;
  stockType: string;
  quantityKg: string;
  transferReason: string;
  transferStatus: "pending" | "approved" | "completed" | "cancelled";
  initiatedByName: string;
  approvedByName: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface InventoryLocation {
  storeId: string;
  stockType: string;
  quantityKg: string;
  storeName: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="w-3 h-3" /> },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500 border-gray-200", icon: <XCircle className="w-3 h-3" /> },
};

const REASONS = [
  { value: "store_full", label: "Store Full" },
  { value: "space_optimization", label: "Space Optimization" },
  { value: "overflow_movement", label: "Overflow Movement" },
  { value: "drying_requirement", label: "Drying Requirement" },
  { value: "other", label: "Other" },
];

const STOCK_TYPES = [
  { value: "rubber_sheet", label: "Rubber Sheet" },
  { value: "rubber_scrap", label: "Rubber Scrap" },
  { value: "latex", label: "Latex" },
];

export default function StockTransfer() {
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const { data: projects = [] } = useListProjects();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    projectId: "",
    fromStoreId: "",
    toStoreId: "",
    stockType: "",
    quantityKg: "",
    transferReason: "",
    reasonNotes: "",
    fromZone: "",
    fromRack: "",
    toZone: "",
    toRack: "",
  });

  // Live capacity / availability preview
  const [fromLocations, setFromLocations] = useState<InventoryLocation[]>([]);
  const [toStore, setToStore] = useState<Store | null>(null);

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/multi-store/stock-transfers");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { transfers: Transfer[] };
      setTransfers(data.transfers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transfers");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStores = useCallback(async () => {
    try {
      const r = await fetch("/api/multi-store/stores?isActive=true");
      if (!r.ok) return;
      const data = await r.json() as { stores: Store[] };
      setStores(data.stores);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchTransfers();
    fetchStores();
  }, [fetchTransfers, fetchStores]);

  // When projectId or fromStore changes, load available stock
  useEffect(() => {
    if (!form.projectId || !form.fromStoreId) { setFromLocations([]); return; }
    fetch(`/api/multi-store/inventory-locations?projectId=${form.projectId}&storeId=${form.fromStoreId}`)
      .then((r) => r.json())
      .then((data: { locations: InventoryLocation[] }) => setFromLocations(data.locations ?? []))
      .catch(() => setFromLocations([]));
  }, [form.projectId, form.fromStoreId]);

  // When toStore changes, load capacity info
  useEffect(() => {
    const s = stores.find((st) => st.id === form.toStoreId);
    setToStore(s ?? null);
  }, [form.toStoreId, stores]);

  const availableFromStore = fromLocations.find((l) => l.stockType === form.stockType);
  const availableQty = parseFloat(availableFromStore?.quantityKg ?? "0");
  const toCap = parseFloat(toStore?.capacityKg ?? "0");
  const toOcc = parseFloat(toStore?.currentOccupancyKg ?? "0");
  const toRemaining = toCap > 0 ? toCap - toOcc : null;
  const requestedQty = parseFloat(form.quantityKg) || 0;

  const qtyError =
    requestedQty > 0 && availableQty > 0 && requestedQty > availableQty
      ? `Exceeds available ${availableQty.toFixed(3)} kg`
      : toRemaining !== null && requestedQty > toRemaining
      ? `Exceeds destination capacity ${toRemaining.toFixed(3)} kg`
      : null;

  async function handleCreate() {
    if (!form.projectId || !form.fromStoreId || !form.toStoreId || !form.stockType || !form.quantityKg || !form.transferReason) {
      setSaveError("All required fields must be filled");
      return;
    }
    if (qtyError) { setSaveError(qtyError); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch("/api/multi-store/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setCreateOpen(false);
      setForm({ projectId: "", fromStoreId: "", toStoreId: "", stockType: "", quantityKg: "", transferReason: "", reasonNotes: "", fromZone: "", fromRack: "", toZone: "", toRack: "" });
      await fetchTransfers();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  }

  async function doAction(id: string, action: "approve" | "complete" | "cancel") {
    setActionLoading(id + action);
    try {
      const r = await fetch(`/api/multi-store/stock-transfers/${id}/${action}`, { method: "PATCH" });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      await fetchTransfers();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight className="w-6 h-6 text-gray-700" />
              <h1 className="text-2xl font-bold text-gray-900">Stock Transfer</h1>
            </div>
            <p className="text-sm text-gray-500">
              Move rubber stock between stores without affecting ownership rights
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchTransfers} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Initiate Transfer
            </Button>
          </div>
        </div>

        <Alert className="bg-blue-50 border-blue-200">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            <strong>Ownership is never affected.</strong> Transfers change only physical location.
            Project revenue rights, LCA, and landowner entitlements remain unchanged.
          </AlertDescription>
        </Alert>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Transfer History</CardTitle>
            <CardDescription className="text-xs">Last 200 transfers — newest first</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : transfers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No transfers yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Qty (kg)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((t) => {
                    const cfg = STATUS_CONFIG[t.transferStatus] ?? STATUS_CONFIG.pending;
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.transferCode}</TableCell>
                        <TableCell className="text-xs">{t.projectName ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <span className="text-gray-600">{t.fromStoreName}</span>
                          <span className="text-gray-400 mx-1">→</span>
                          <span className="text-gray-600">{t.toStoreName}</span>
                        </TableCell>
                        <TableCell className="text-xs capitalize">{t.stockType.replace("_", " ")}</TableCell>
                        <TableCell className="text-xs font-mono text-right">
                          {parseFloat(t.quantityKg).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs flex items-center gap-1 w-fit ${cfg.color}`}>
                            {cfg.icon}
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-gray-400">
                          {new Date(t.createdAt).toLocaleDateString("en-IN")}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {t.transferStatus === "pending" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => doAction(t.id, "approve")}
                                    disabled={!!actionLoading}
                                  >
                                    {actionLoading === t.id + "approve" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-red-600"
                                    onClick={() => doAction(t.id, "cancel")}
                                    disabled={!!actionLoading}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              )}
                              {t.transferStatus === "approved" && (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                                  onClick={() => doAction(t.id, "complete")}
                                  disabled={!!actionLoading}
                                >
                                  {actionLoading === t.id + "complete" ? <Loader2 className="w-3 h-3 animate-spin" /> : "Complete"}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Create Transfer Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4" />
                Initiate Stock Transfer
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
              {saveError && (
                <Alert variant="destructive">
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Project *</Label>
                  <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v, fromStoreId: "", stockType: "" }))}>
                    <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>
                      {projects.map((p: { id: string; name: string }) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>From Store *</Label>
                  <Select value={form.fromStoreId} onValueChange={(v) => setForm((f) => ({ ...f, fromStoreId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Source store" /></SelectTrigger>
                    <SelectContent>
                      {stores.filter((s) => s.id !== form.toStoreId).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.storeName} ({s.storeCode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>To Store *</Label>
                  <Select value={form.toStoreId} onValueChange={(v) => setForm((f) => ({ ...f, toStoreId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Destination store" /></SelectTrigger>
                    <SelectContent>
                      {stores.filter((s) => s.id !== form.fromStoreId).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.storeName} ({s.storeCode})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Stock Type *</Label>
                  <Select value={form.stockType} onValueChange={(v) => setForm((f) => ({ ...f, stockType: v }))}>
                    <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      {STOCK_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Quantity (kg) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={form.quantityKg}
                    onChange={(e) => setForm((f) => ({ ...f, quantityKg: e.target.value }))}
                    className={qtyError ? "border-red-400" : ""}
                  />
                </div>
              </div>

              {/* Live availability preview */}
              {form.fromStoreId && form.stockType && (
                <div className={`rounded-lg p-3 text-xs ${qtyError ? "bg-red-50 border border-red-200" : "bg-gray-50"}`}>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Available in source store:</span>
                    <span className="font-semibold">{availableQty.toFixed(3)} kg</span>
                  </div>
                  {toRemaining !== null && (
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-500">Destination remaining capacity:</span>
                      <span className={`font-semibold ${toRemaining < requestedQty ? "text-red-600" : "text-emerald-600"}`}>
                        {toRemaining.toFixed(3)} kg
                      </span>
                    </div>
                  )}
                  {qtyError && (
                    <p className="text-red-600 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {qtyError}
                    </p>
                  )}
                </div>
              )}

              <div className="col-span-2">
                <Label>Reason *</Label>
                <Select value={form.transferReason} onValueChange={(v) => setForm((f) => ({ ...f, transferReason: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">From Zone</Label>
                  <Input placeholder="e.g. Zone A" value={form.fromZone} onChange={(e) => setForm((f) => ({ ...f, fromZone: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">From Rack</Label>
                  <Input placeholder="e.g. Rack 3" value={form.fromRack} onChange={(e) => setForm((f) => ({ ...f, fromRack: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">To Zone</Label>
                  <Input placeholder="e.g. Zone B" value={form.toZone} onChange={(e) => setForm((f) => ({ ...f, toZone: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">To Rack</Label>
                  <Input placeholder="e.g. Rack 1" value={form.toRack} onChange={(e) => setForm((f) => ({ ...f, toRack: e.target.value }))} className="h-8 text-sm" />
                </div>
              </div>

              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={form.reasonNotes}
                  onChange={(e) => setForm((f) => ({ ...f, reasonNotes: e.target.value }))}
                  placeholder="Additional notes"
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !!qtyError}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Initiate Transfer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
