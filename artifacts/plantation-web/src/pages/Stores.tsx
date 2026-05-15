import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Building2,
  Plus,
  RefreshCw,
  AlertTriangle,
  Loader2,
  MapPin,
  Package,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useRole } from "@/contexts/RoleContext";

interface Store {
  id: string;
  storeName: string;
  storeCode: string;
  storeType: "project_store" | "central_store" | "overflow_store";
  projectId: string | null;
  linkedProjectName?: string | null;
  address: string | null;
  capacityKg: string;
  currentOccupancyKg: string;
  managerName: string | null;
  isActive: boolean;
  notes: string | null;
}

interface Location {
  id: string;
  projectId: string;
  projectName: string;
  stockType: string;
  quantityKg: string;
  zone: string | null;
  rack: string | null;
}

const STORE_TYPE_LABELS: Record<string, string> = {
  project_store: "Project Store",
  central_store: "Central Store",
  overflow_store: "Overflow Store",
};

const STORE_TYPE_COLORS: Record<string, string> = {
  project_store: "bg-blue-100 text-blue-800 border-blue-200",
  central_store: "bg-emerald-100 text-emerald-800 border-emerald-200",
  overflow_store: "bg-amber-100 text-amber-800 border-amber-200",
};

function CapacityBar({ capacityKg, occupancyKg }: { capacityKg: string; occupancyKg: string }) {
  const cap = parseFloat(capacityKg) || 0;
  const occ = parseFloat(occupancyKg) || 0;
  const pct = cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{occ.toFixed(1)} kg</span>
        <span>{cap > 0 ? `${pct}%` : "—"}</span>
        <span>{cap > 0 ? `${cap.toFixed(0)} kg max` : "No limit"}</span>
      </div>
      {cap > 0 && (
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function Stores() {
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locLoading, setLocLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [form, setForm] = useState({
    storeName: "",
    storeCode: "",
    storeType: "",
    address: "",
    capacityKg: "",
    managerName: "",
    notes: "",
  });

  const fetchStores = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/multi-store/stores");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { stores: Store[] };
      setStores(data.stores);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  async function loadLocations(storeId: string) {
    setLocLoading(true);
    try {
      const r = await fetch(`/api/multi-store/stores/${storeId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { locations: Location[] };
      setLocations(data.locations);
    } catch {
      setLocations([]);
    } finally {
      setLocLoading(false);
    }
  }

  function selectStore(s: Store) {
    setSelectedStore(s);
    loadLocations(s.id);
  }

  async function handleCreate() {
    if (!form.storeName.trim() || !form.storeCode.trim() || !form.storeType) {
      setSaveError("Name, code, and type are required");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch("/api/multi-store/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setCreateOpen(false);
      setForm({ storeName: "", storeCode: "", storeType: "", address: "", capacityKg: "", managerName: "", notes: "" });
      await fetchStores();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(store: Store) {
    await fetch(`/api/multi-store/stores/${store.id}/toggle-active`, { method: "PATCH" });
    await fetchStores();
    if (selectedStore?.id === store.id) {
      setSelectedStore(null);
    }
  }

  const activeStores = stores.filter((s) => s.isActive);
  const totalCapacity = activeStores.reduce((s, st) => s + parseFloat(st.capacityKg || "0"), 0);
  const totalOccupancy = activeStores.reduce((s, st) => s + parseFloat(st.currentOccupancyKg || "0"), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-6 h-6 text-gray-700" />
              <h1 className="text-2xl font-bold text-gray-900">Stores</h1>
            </div>
            <p className="text-sm text-gray-500">
              Manage physical storage locations for rubber stock
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchStores} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Store
              </Button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Stores", value: stores.length, sub: `${activeStores.length} active` },
            { label: "Project Stores", value: stores.filter((s) => s.storeType === "project_store").length, sub: "" },
            { label: "Central Stores", value: stores.filter((s) => s.storeType === "central_store").length, sub: "" },
            { label: "Total Capacity", value: totalCapacity > 0 ? `${totalCapacity.toFixed(0)} kg` : "—", sub: `${totalOccupancy.toFixed(0)} kg occupied` },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-2xl font-bold text-gray-900">{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Store list */}
          <div className="lg:col-span-2 space-y-3">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : stores.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-gray-400">
                  No stores configured yet. Add the first store to get started.
                </CardContent>
              </Card>
            ) : (
              stores.map((store) => {
                const cap = parseFloat(store.capacityKg) || 0;
                const occ = parseFloat(store.currentOccupancyKg) || 0;
                const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
                const isSelected = selectedStore?.id === store.id;

                return (
                  <Card
                    key={store.id}
                    className={`cursor-pointer transition-all ${
                      isSelected ? "ring-2 ring-emerald-500" : "hover:shadow-sm"
                    } ${!store.isActive ? "opacity-60" : ""}`}
                    onClick={() => selectStore(store)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-semibold text-gray-900">{store.storeName}</p>
                            <p className="text-xs text-gray-400 font-mono">{store.storeCode}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`text-xs ${STORE_TYPE_COLORS[store.storeType]}`}>
                            {STORE_TYPE_LABELS[store.storeType]}
                          </Badge>
                          {!store.isActive && (
                            <Badge variant="outline" className="text-xs text-gray-500">Inactive</Badge>
                          )}
                        </div>
                      </div>

                      <CapacityBar capacityKg={store.capacityKg} occupancyKg={store.currentOccupancyKg} />

                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                        {store.address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {store.address}
                          </span>
                        )}
                        {store.managerName && (
                          <span>Manager: {store.managerName}</span>
                        )}
                        {store.linkedProjectName && (
                          <span className="text-blue-600">↳ {store.linkedProjectName}</span>
                        )}
                        {cap > 0 && pct >= 90 && (
                          <span className="flex items-center gap-1 text-red-500">
                            <AlertTriangle className="w-3 h-3" />
                            Near capacity
                          </span>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="flex justify-end mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7"
                            onClick={(e) => { e.stopPropagation(); toggleActive(store); }}
                          >
                            {store.isActive ? (
                              <><ToggleRight className="w-3.5 h-3.5 mr-1 text-emerald-500" />Active</>
                            ) : (
                              <><ToggleLeft className="w-3.5 h-3.5 mr-1 text-gray-400" />Inactive</>
                            )}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Store detail panel */}
          <div>
            {selectedStore ? (
              <Card className="sticky top-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    {selectedStore.storeName} — Stock
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {locLoading ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    </div>
                  ) : locations.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">No stock in this store</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Project</TableHead>
                          <TableHead className="text-xs">Type</TableHead>
                          <TableHead className="text-xs text-right">Qty (kg)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {locations.map((loc) => (
                          <TableRow key={loc.id}>
                            <TableCell className="text-xs">{loc.projectName}</TableCell>
                            <TableCell className="text-xs capitalize">{loc.stockType.replace("_", " ")}</TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {parseFloat(loc.quantityKg).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-sm text-gray-400">
                  Click a store to view its stock breakdown
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Create Store Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Store</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {saveError && (
                <Alert variant="destructive">
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Store Name *</Label>
                  <Input
                    value={form.storeName}
                    onChange={(e) => setForm((f) => ({ ...f, storeName: e.target.value }))}
                    placeholder="Central Store 1"
                  />
                </div>
                <div>
                  <Label>Store Code *</Label>
                  <Input
                    value={form.storeCode}
                    onChange={(e) => setForm((f) => ({ ...f, storeCode: e.target.value.toUpperCase() }))}
                    placeholder="CS-01"
                    className="font-mono"
                  />
                </div>
                <div>
                  <Label>Type *</Label>
                  <Select
                    value={form.storeType}
                    onValueChange={(v) => setForm((f) => ({ ...f, storeType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project_store">Project Store</SelectItem>
                      <SelectItem value="central_store">Central Store</SelectItem>
                      <SelectItem value="overflow_store">Overflow Store</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Address</Label>
                  <Input
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Location / village"
                  />
                </div>
                <div>
                  <Label>Capacity (kg)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.capacityKg}
                    onChange={(e) => setForm((f) => ({ ...f, capacityKg: e.target.value }))}
                    placeholder="10000"
                  />
                </div>
                <div>
                  <Label>Manager Name</Label>
                  <Input
                    value={form.managerName}
                    onChange={(e) => setForm((f) => ({ ...f, managerName: e.target.value }))}
                    placeholder="Name"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Notes</Label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional notes"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Store
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
