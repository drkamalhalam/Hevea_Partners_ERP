import { useState, useEffect, useCallback } from "react";
import { useAuthFetch } from "../lib/authFetch";

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
import { Separator } from "@/components/ui/separator";
import {
  FileCheck2,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { useRole } from "@/contexts/RoleContext";
import { useListProjects } from "@workspace/api-client-react";

interface DispatchMemo {
  id: string;
  memoCode: string;
  projectId: string;
  projectName?: string;
  buyerName: string;
  sourceStoreId: string;
  sourceStoreName: string;
  storeName?: string;
  stockType: string;
  zone: string | null;
  rack: string | null;
  totalOrderedKg: string;
  totalDispatchedKg: string;
  remainingKg: string;
  dispatchStatus: "pending" | "partially_dispatched" | "dispatched" | "cancelled";
  issuedByName: string;
  issuedAt: string;
  completedAt: string | null;
  notes: string | null;
}

interface Store {
  id: string;
  storeName: string;
  storeCode: string;
  isActive: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-800 border-amber-200", icon: <Clock className="w-3 h-3" /> },
  partially_dispatched: { label: "Partial", color: "bg-blue-100 text-blue-800 border-blue-200", icon: <Truck className="w-3 h-3" /> },
  dispatched: { label: "Dispatched", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled: { label: "Cancelled", color: "bg-gray-100 text-gray-500 border-gray-200", icon: <XCircle className="w-3 h-3" /> },
};

const STOCK_TYPES = [
  { value: "rubber_sheet", label: "Rubber Sheet" },
  { value: "rubber_scrap", label: "Rubber Scrap" },
  { value: "latex", label: "Latex" },
];

function fmt(v: string | number): string {
  return typeof v === "string" ? parseFloat(v).toFixed(2) : v.toFixed(2);
}

function ProgressBar({ dispatched, total }: { dispatched: string; total: string }) {
  const d = parseFloat(dispatched);
  const t = parseFloat(total);
  const pct = t > 0 ? Math.min(100, Math.round((d / t) * 100)) : 0;
  return (
    <div className="space-y-0.5">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-400">{pct}% dispatched</p>
    </div>
  );
}

export default function DispatchMemo() {
  const authFetch = useAuthFetch();
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const { data: projects = [] } = useListProjects();

  const [memos, setMemos] = useState<DispatchMemo[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMemo, setSelectedMemo] = useState<DispatchMemo | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [form, setForm] = useState({
    projectId: "",
    buyerName: "",
    sourceStoreId: "",
    stockType: "",
    totalOrderedKg: "",
    zone: "",
    rack: "",
    notes: "",
  });

  const [dispatchQty, setDispatchQty] = useState("");
  const [dispatchRemarks, setDispatchRemarks] = useState("");

  const fetchMemos = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/multi-store/dispatch-memos");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { memos: DispatchMemo[] };
      setMemos(data.memos);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemos();
    fetch("/api/multi-store/stores?isActive=true")
      .then((r) => r.json())
      .then((d: { stores: Store[] }) => setStores(d.stores ?? []))
      .catch(() => {});
  }, [fetchMemos]);

  async function handleCreate() {
    if (!form.projectId || !form.buyerName || !form.sourceStoreId || !form.stockType || !form.totalOrderedKg) {
      setSaveError("All required fields must be filled");
      return;
    }
    const qty = parseFloat(form.totalOrderedKg);
    if (!(qty > 0)) { setSaveError("Ordered quantity must be positive"); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch("/api/multi-store/dispatch-memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setCreateOpen(false);
      setForm({ projectId: "", buyerName: "", sourceStoreId: "", stockType: "", totalOrderedKg: "", zone: "", rack: "", notes: "" });
      await fetchMemos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to create memo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDispatch() {
    if (!selectedMemo || !dispatchQty) return;
    const qty = parseFloat(dispatchQty);
    if (!(qty > 0)) { setSaveError("Dispatch quantity must be positive"); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`/api/multi-store/dispatch-memos/${selectedMemo.id}/dispatch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchedKg: dispatchQty, remarks: dispatchRemarks }),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setDispatchOpen(false);
      setDispatchQty("");
      setDispatchRemarks("");
      setSelectedMemo(null);
      await fetchMemos();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Dispatch failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(memo: DispatchMemo) {
    if (!confirm(`Cancel memo ${memo.memoCode}?`)) return;
    await fetch(`/api/multi-store/dispatch-memos/${memo.id}/cancel`, { method: "PATCH" });
    await fetchMemos();
  }

  const pendingCount = memos.filter((m) => m.dispatchStatus === "pending").length;
  const partialCount = memos.filter((m) => m.dispatchStatus === "partially_dispatched").length;
  const completedCount = memos.filter((m) => m.dispatchStatus === "dispatched").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <FileCheck2 className="w-6 h-6 text-gray-700" />
              <h1 className="text-2xl font-bold text-gray-900">Dispatch Memos</h1>
            </div>
            <p className="text-sm text-gray-500">
              Generate buyer pickup memos with partial dispatch support
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchMemos} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Memo
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Memos", value: memos.length, sub: "" },
            { label: "Pending", value: pendingCount, sub: "", warn: pendingCount > 0 },
            { label: "Partial", value: partialCount, sub: "", info: partialCount > 0 },
            { label: "Completed", value: completedCount, sub: "" },
          ].map((c) => (
            <Card key={c.label} className={c.warn ? "border-amber-200 bg-amber-50" : c.info ? "border-blue-200 bg-blue-50" : ""}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-2xl font-bold text-gray-900">{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Memo table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All Dispatch Memos</CardTitle>
            <CardDescription className="text-xs">Newest first — track ordered, dispatched, and remaining quantities</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : memos.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No dispatch memos yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Memo</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memos.map((m) => {
                    const cfg = STATUS_CONFIG[m.dispatchStatus] ?? STATUS_CONFIG.pending;
                    const remaining = parseFloat(m.remainingKg);
                    return (
                      <TableRow key={m.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelectedMemo(m)}>
                        <TableCell className="font-mono text-xs">{m.memoCode}</TableCell>
                        <TableCell className="text-xs">{m.projectName ?? "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{m.buyerName}</TableCell>
                        <TableCell className="text-xs">{m.sourceStoreName ?? m.storeName}</TableCell>
                        <TableCell className="text-xs capitalize">{m.stockType.replace("_", " ")}</TableCell>
                        <TableCell className="min-w-[120px]">
                          <ProgressBar dispatched={m.totalDispatchedKg} total={m.totalOrderedKg} />
                        </TableCell>
                        <TableCell className={`text-xs font-mono ${remaining > 0 ? "text-amber-700" : "text-gray-400"}`}>
                          {fmt(m.remainingKg)} kg
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Badge className={`text-xs flex items-center gap-1 w-fit ${cfg.color}`}>
                            {cfg.icon}
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              {(m.dispatchStatus === "pending" || m.dispatchStatus === "partially_dispatched") && (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                                  onClick={() => {
                                    setSelectedMemo(m);
                                    setDispatchQty("");
                                    setDispatchRemarks("");
                                    setSaveError(null);
                                    setDispatchOpen(true);
                                  }}
                                >
                                  <Truck className="w-3 h-3 mr-1" />
                                  Dispatch
                                </Button>
                              )}
                              {m.dispatchStatus === "pending" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-red-500"
                                  onClick={() => handleCancel(m)}
                                >
                                  Cancel
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

        {/* Memo detail panel */}
        {selectedMemo && !dispatchOpen && (
          <Card className="border-emerald-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-mono">{selectedMemo.memoCode}</CardTitle>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedMemo(null)}>Close</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {[
                  { label: "Buyer", value: selectedMemo.buyerName },
                  { label: "Project", value: selectedMemo.projectName ?? "—" },
                  { label: "Source Store", value: selectedMemo.sourceStoreName ?? selectedMemo.storeName },
                  { label: "Stock Type", value: selectedMemo.stockType.replace("_", " ") },
                  { label: "Zone / Rack", value: [selectedMemo.zone, selectedMemo.rack].filter(Boolean).join(" / ") || "—" },
                  { label: "Issued By", value: selectedMemo.issuedByName },
                ].map((row) => (
                  <div key={row.label}>
                    <p className="text-xs text-gray-500">{row.label}</p>
                    <p className="font-medium capitalize">{row.value}</p>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Ordered</p>
                  <p className="text-lg font-bold font-mono">{fmt(selectedMemo.totalOrderedKg)} kg</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Dispatched</p>
                  <p className="text-lg font-bold font-mono text-emerald-700">{fmt(selectedMemo.totalDispatchedKg)} kg</p>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Remaining</p>
                  <p className="text-lg font-bold font-mono text-amber-700">{fmt(selectedMemo.remainingKg)} kg</p>
                </div>
              </div>
              <ProgressBar dispatched={selectedMemo.totalDispatchedKg} total={selectedMemo.totalOrderedKg} />
              {selectedMemo.notes && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">{selectedMemo.notes}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Create Memo Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4" />
                New Dispatch Memo
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}

              <div>
                <Label>Project *</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Buyer Name *</Label>
                <Input value={form.buyerName} onChange={(e) => setForm((f) => ({ ...f, buyerName: e.target.value }))} placeholder="Buyer name" />
              </div>

              <div>
                <Label>Source Store *</Label>
                <Select value={form.sourceStoreId} onValueChange={(v) => setForm((f) => ({ ...f, sourceStoreId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select store" /></SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.storeName} ({s.storeCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Stock Type *</Label>
                  <Select value={form.stockType} onValueChange={(v) => setForm((f) => ({ ...f, stockType: v }))}>
                    <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      {STOCK_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Ordered (kg) *</Label>
                  <Input type="number" min="0" step="0.001" value={form.totalOrderedKg} onChange={(e) => setForm((f) => ({ ...f, totalOrderedKg: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Zone</Label>
                  <Input value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} placeholder="Zone A" className="h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Rack</Label>
                  <Input value={form.rack} onChange={(e) => setForm((f) => ({ ...f, rack: e.target.value }))} placeholder="Rack 3" className="h-8 text-sm" />
                </div>
              </div>

              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generate Memo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Record Dispatch Dialog */}
        <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Record Pickup — {selectedMemo?.memoCode}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}

              {selectedMemo && (
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Ordered</span>
                    <span className="font-mono font-medium">{fmt(selectedMemo.totalOrderedKg)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Already dispatched</span>
                    <span className="font-mono text-emerald-700">{fmt(selectedMemo.totalDispatchedKg)} kg</span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span>Remaining</span>
                    <span className="font-mono text-amber-700">{fmt(selectedMemo.remainingKg)} kg</span>
                  </div>
                </div>
              )}

              <div>
                <Label>Pickup Quantity (kg) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  max={selectedMemo ? parseFloat(selectedMemo.remainingKg) : undefined}
                  value={dispatchQty}
                  onChange={(e) => setDispatchQty(e.target.value)}
                  placeholder="Enter kg picked up"
                  autoFocus
                />
                {dispatchQty && selectedMemo && parseFloat(dispatchQty) > parseFloat(selectedMemo.remainingKg) && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Exceeds remaining {fmt(selectedMemo.remainingKg)} kg
                  </p>
                )}
              </div>

              <div>
                <Label className="text-xs">Remarks</Label>
                <Input value={dispatchRemarks} onChange={(e) => setDispatchRemarks(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button>
              <Button
                onClick={handleDispatch}
                disabled={saving || !dispatchQty || (selectedMemo ? parseFloat(dispatchQty) > parseFloat(selectedMemo.remainingKg) : false)}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm Pickup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
