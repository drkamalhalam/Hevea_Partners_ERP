import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import type { Buyer, SaleDetail, SalesTransaction } from "@workspace/api-client-react";
import {
  useListSales,
  useGetSale,
  useGetSalesSummary,
  useCreateSale,
  useConfirmSale,
  useCancelSale,
  useAddSaleLineItem,
  useDeleteSaleLineItem,
  useAddSaleDeduction,
  useDeleteSaleDeduction,
  useListBuyers,
  useCreateBuyer,
  useUpdateBuyer,
  useListProjects,
  useListProductionBatches,
  getListSalesQueryKey,
  getGetSalesSummaryQueryKey,
  getListBuyersQueryKey,
  getGetSaleQueryKey,
  getListProductionBatchesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Plus,
  ShoppingCart,
  Users,
  TrendingUp,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Trash2,
  FlaskConical,
  Layers,
  Package,
  Building2,
  Phone,
  Mail,
  MapPin,
  Pencil,
  IndianRupee,
  FileText,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";

// ── Constants ─────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = [
  { value: "latex", label: "Latex", unit: "litres", icon: <FlaskConical className="h-3.5 w-3.5 text-sky-400" /> },
  { value: "rubber_sheet", label: "Rubber Sheet", unit: "kg", icon: <Layers className="h-3.5 w-3.5 text-emerald-400" /> },
  { value: "rubber_scrap", label: "Rubber Scrap", unit: "kg", icon: <Package className="h-3.5 w-3.5 text-amber-400" /> },
];

const DEDUCTION_TYPES = ["transport", "commission", "tax", "processing", "weighment", "other"];

const BUYER_TYPES = [
  { value: "trader", label: "Trader" },
  { value: "processor", label: "Processor" },
  { value: "direct", label: "Direct Buyer" },
  { value: "government", label: "Government" },
  { value: "other", label: "Other" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtQty(n: number, unit: string) {
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`;
}
function fmtDate(d: string) {
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "confirmed")
    return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Confirmed</Badge>;
  if (status === "draft")
    return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">Draft</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Cancelled</Badge>;
}

function productIcon(t: string) {
  return PRODUCT_TYPES.find((x) => x.value === t)?.icon ?? <Package className="h-3.5 w-3.5 text-slate-400" />;
}
function productLabel(t: string) {
  return PRODUCT_TYPES.find((x) => x.value === t)?.label ?? t;
}
function productUnit(t: string) {
  return PRODUCT_TYPES.find((x) => x.value === t)?.unit ?? "";
}

// ── Sale Detail Panel ─────────────────────────────────────────────────────────

function SaleDetailPanel({ txId, onClose }: { txId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { role } = useRole();
  const canManage = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const { data: sale, isLoading } = useGetSale(txId);
  const confirm = useConfirmSale();
  const cancel = useCancelSale();
  const addItem = useAddSaleLineItem();
  const deleteItem = useDeleteSaleLineItem();
  const addDed = useAddSaleDeduction();
  const deleteDed = useDeleteSaleDeduction();

  const batchProjectId = (sale as SaleDetail | undefined)?.projectId;
  const { data: batches } = useListProductionBatches(
    { projectId: batchProjectId, status: "closed" },
    { query: { enabled: !!batchProjectId, queryKey: getListProductionBatchesQueryKey({ projectId: batchProjectId, status: "closed" }) } },
  );

  const [itemForm, setItemForm] = useState({
    productType: "rubber_sheet",
    quantity: "",
    saleRate: "",
    batchId: "",
    remarks: "",
  });
  const [dedForm, setDedForm] = useState({ deductionType: "transport", description: "", amount: "" });
  const [showItemForm, setShowItemForm] = useState(false);
  const [showDedForm, setShowDedForm] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetSaleQueryKey(txId) });
    qc.invalidateQueries({ queryKey: getListSalesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSalesSummaryQueryKey() });
  }

  async function handleConfirm() {
    try {
      await confirm.mutateAsync({ id: txId });
      toast({ title: "Sale confirmed — inventory movements created" });
      invalidate();
    } catch {
      toast({ title: "Failed to confirm sale", variant: "destructive" });
    }
  }

  async function handleCancel() {
    try {
      await cancel.mutateAsync({ id: txId });
      toast({ title: "Sale cancelled" });
      invalidate();
      onClose();
    } catch {
      toast({ title: "Failed to cancel sale", variant: "destructive" });
    }
  }

  async function handleAddItem() {
    if (!itemForm.quantity || !itemForm.saleRate) return;
    try {
      await addItem.mutateAsync({
        id: txId,
        data: {
          productType: itemForm.productType,
          quantity: Number(itemForm.quantity),
          unit: productUnit(itemForm.productType),
          saleRate: Number(itemForm.saleRate),
          batchId: itemForm.batchId || undefined,
          remarks: itemForm.remarks || undefined,
        },
      });
      toast({ title: "Line item added" });
      setItemForm({ productType: "rubber_sheet", quantity: "", saleRate: "", batchId: "", remarks: "" });
      setShowItemForm(false);
      invalidate();
    } catch {
      toast({ title: "Failed to add item", variant: "destructive" });
    }
  }

  async function handleDeleteItem(itemId: string) {
    try {
      await deleteItem.mutateAsync({ txId, itemId });
      toast({ title: "Item removed" });
      invalidate();
    } catch {
      toast({ title: "Failed to remove item", variant: "destructive" });
    }
  }

  async function handleAddDed() {
    if (!dedForm.amount) return;
    try {
      await addDed.mutateAsync({
        id: txId,
        data: {
          deductionType: dedForm.deductionType,
          description: dedForm.description || undefined,
          amount: Number(dedForm.amount),
        },
      });
      toast({ title: "Deduction added" });
      setDedForm({ deductionType: "transport", description: "", amount: "" });
      setShowDedForm(false);
      invalidate();
    } catch {
      toast({ title: "Failed to add deduction", variant: "destructive" });
    }
  }

  async function handleDeleteDed(dedId: string) {
    try {
      await deleteDed.mutateAsync({ txId, dedId });
      toast({ title: "Deduction removed" });
      invalidate();
    } catch {
      toast({ title: "Failed to remove deduction", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!sale) return <div className="text-slate-500 text-sm p-4">Sale not found.</div>;

  const saleDetail = sale as SaleDetail;
  const isDraft = saleDetail.status === "draft";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold text-slate-100">{saleDetail.saleNumber}</span>
            <StatusBadge status={saleDetail.status} />
          </div>
          <div className="text-sm text-slate-400 mt-1">
            {fmtDate(saleDetail.saleDate)} · {saleDetail.buyerName}
            {saleDetail.projectName && <span className="text-slate-500"> · {saleDetail.projectName}</span>}
          </div>
        </div>
        {canManage && isDraft && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={confirm.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Confirm Sale
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancel}
                disabled={cancel.isPending}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs h-8"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800/60 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-500 mb-1">Gross Revenue</div>
          <div className="font-mono text-sm font-bold text-slate-100">{fmtINR(saleDetail.totalGrossRevenue)}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-500 mb-1">Deductions</div>
          <div className="font-mono text-sm font-bold text-rose-400">−{fmtINR(saleDetail.totalDeductions)}</div>
        </div>
        <div className="bg-slate-800/60 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-500 mb-1">Net Revenue</div>
          <div className="font-mono text-sm font-bold text-emerald-400">{fmtINR(saleDetail.totalNetRevenue)}</div>
        </div>
      </div>

      {/* Line items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Products Sold</span>
          {canManage && isDraft && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => setShowItemForm((v) => !v)}
            >
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          )}
        </div>

        {showItemForm && (
          <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3 mb-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-400">Product Type</Label>
                <Select
                  value={itemForm.productType}
                  onValueChange={(v) => setItemForm((f) => ({ ...f, productType: v }))}
                >
                  <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400">Link Batch (optional)</Label>
                <Select
                  value={itemForm.batchId || "none"}
                  onValueChange={(v) => setItemForm((f) => ({ ...f, batchId: v === "none" ? "" : v }))}
                >
                  <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                    <SelectValue placeholder="No batch" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No specific batch</SelectItem>
                    {batches?.filter((b) => b.status === "closed").map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400">Quantity ({productUnit(itemForm.productType)})</Label>
                <Input
                  type="number"
                  className="h-8 text-xs bg-slate-800 border-slate-600"
                  value={itemForm.quantity}
                  onChange={(e) => setItemForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs text-slate-400">Rate (₹/{productUnit(itemForm.productType)})</Label>
                <Input
                  type="number"
                  className="h-8 text-xs bg-slate-800 border-slate-600"
                  value={itemForm.saleRate}
                  onChange={(e) => setItemForm((f) => ({ ...f, saleRate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Remarks</Label>
              <Input
                className="h-8 text-xs bg-slate-800 border-slate-600"
                value={itemForm.remarks}
                onChange={(e) => setItemForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </div>
            {itemForm.quantity && itemForm.saleRate && (
              <div className="text-xs text-slate-400">
                Amount:{" "}
                <span className="text-slate-100 font-mono">
                  {fmtINR(Number(itemForm.quantity) * Number(itemForm.saleRate))}
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddItem} disabled={addItem.isPending}>
                Add Item
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowItemForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="border border-white/10 rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-slate-400 text-xs">Type</TableHead>
                <TableHead className="text-slate-400 text-xs">Batch</TableHead>
                <TableHead className="text-slate-400 text-xs text-right">Quantity</TableHead>
                <TableHead className="text-slate-400 text-xs text-right">Rate</TableHead>
                <TableHead className="text-slate-400 text-xs text-right">Amount</TableHead>
                {canManage && isDraft && <TableHead className="w-8" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!saleDetail.lineItems?.length ? (
                <TableRow>
                  <TableCell colSpan={canManage && isDraft ? 6 : 5} className="text-center text-slate-500 text-xs py-4">
                    No line items yet.
                  </TableCell>
                </TableRow>
              ) : (
                saleDetail.lineItems.map((item) => (
                  <TableRow key={item.id} className="border-white/5 hover:bg-white/3">
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {productIcon(item.productType)}
                        <span className="text-xs text-slate-200">{productLabel(item.productType)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{item.batchNumber ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-100">
                      {fmtQty(item.quantity, item.unit)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-400">
                      {item.saleRate !== undefined ? `₹${item.saleRate.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold text-slate-100">
                      {item.grossAmount !== undefined ? fmtINR(item.grossAmount) : "—"}
                    </TableCell>
                    {canManage && isDraft && (
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-slate-500 hover:text-red-400"
                          onClick={() => handleDeleteItem(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Deductions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Deductions</span>
          {canManage && isDraft && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-rose-400 hover:bg-rose-500/10"
              onClick={() => setShowDedForm((v) => !v)}
            >
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          )}
        </div>

        {showDedForm && (
          <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3 mb-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-400">Type</Label>
                <Select
                  value={dedForm.deductionType}
                  onValueChange={(v) => setDedForm((f) => ({ ...f, deductionType: v }))}
                >
                  <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEDUCTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400">Amount (₹)</Label>
                <Input
                  type="number"
                  className="h-8 text-xs bg-slate-800 border-slate-600"
                  value={dedForm.amount}
                  onChange={(e) => setDedForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Description</Label>
              <Input
                className="h-8 text-xs bg-slate-800 border-slate-600"
                value={dedForm.description}
                onChange={(e) => setDedForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleAddDed} disabled={addDed.isPending}>
                Add
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDedForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!saleDetail.deductions?.length ? (
          <div className="text-xs text-slate-500 text-center py-2">No deductions.</div>
        ) : (
          <div className="space-y-1">
            {saleDetail.deductions.map((d) => (
              <div key={d.id} className="flex items-center justify-between bg-slate-800/40 rounded px-3 py-1.5">
                <div>
                  <span className="text-xs text-slate-300 capitalize">{d.deductionType}</span>
                  {d.description && (
                    <span className="text-xs text-slate-500 ml-2">— {d.description}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-rose-400">−{fmtINR(d.amount)}</span>
                  {canManage && isDraft && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 text-slate-500 hover:text-red-400"
                      onClick={() => handleDeleteDed(d.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {saleDetail.notes && (
        <div className="bg-slate-800/40 rounded p-3 text-xs text-slate-400">
          <span className="text-slate-500 font-medium">Notes: </span>{saleDetail.notes}
        </div>
      )}
      {saleDetail.documentRef && (
        <div className="text-xs text-slate-500">
          <FileText className="h-3 w-3 inline mr-1" />Document ref: {saleDetail.documentRef}
        </div>
      )}
      {saleDetail.confirmedAt && (
        <div className="text-xs text-slate-500">
          Confirmed by {saleDetail.confirmedByName} · {fmtDate(saleDetail.confirmedAt)}
        </div>
      )}
    </div>
  );
}

// ── New Sale Dialog ───────────────────────────────────────────────────────────

type LineItemDraft = {
  productType: string;
  quantity: string;
  saleRate: string;
  batchId: string;
  remarks: string;
};
type DeductionDraft = { deductionType: string; description: string; amount: string };

function NewSaleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: projects } = useListProjects();
  const { data: buyers } = useListBuyers();

  const [projectId, setProjectId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [saleDate, setSaleDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [documentRef, setDocumentRef] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([
    { productType: "rubber_sheet", quantity: "", saleRate: "", batchId: "", remarks: "" },
  ]);
  const [deductions, setDeductions] = useState<DeductionDraft[]>([]);

  const { data: batches } = useListProductionBatches(
    { projectId, status: "closed" },
    { query: { enabled: !!projectId, queryKey: getListProductionBatchesQueryKey({ projectId, status: "closed" }) } },
  );

  const createSale = useCreateSale();

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      { productType: "rubber_sheet", quantity: "", saleRate: "", batchId: "", remarks: "" },
    ]);
  }
  function removeLineItem(i: number) {
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateLineItem(i: number, field: keyof LineItemDraft, value: string) {
    setLineItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));
  }
  function addDeduction() {
    setDeductions((prev) => [...prev, { deductionType: "transport", description: "", amount: "" }]);
  }
  function removeDeduction(i: number) {
    setDeductions((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateDeduction(i: number, field: keyof DeductionDraft, value: string) {
    setDeductions((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  }

  function handleBuyerSelect(id: string) {
    if (id === "manual") {
      setBuyerId("");
      setBuyerName("");
    } else {
      setBuyerId(id);
      const buyer = buyers?.find((b) => b.id === id);
      if (buyer) setBuyerName(buyer.name);
    }
  }

  const totalGross = lineItems.reduce((s, item) => {
    return s + (Number(item.quantity) || 0) * (Number(item.saleRate) || 0);
  }, 0);
  const totalDed = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  async function handleSubmit() {
    if (!projectId || !buyerName.trim() || !saleDate) {
      toast({ title: "Project, buyer and date are required", variant: "destructive" });
      return;
    }
    const validItems = lineItems.filter((i) => i.quantity && i.saleRate);
    if (!validItems.length) {
      toast({ title: "Add at least one line item with quantity and rate", variant: "destructive" });
      return;
    }
    try {
      await createSale.mutateAsync({
        data: {
          projectId,
          buyerId: buyerId || undefined,
          buyerName: buyerName.trim(),
          saleDate,
          notes: notes || undefined,
          documentRef: documentRef || undefined,
          lineItems: validItems.map((i) => ({
            productType: i.productType,
            quantity: Number(i.quantity),
            unit: productUnit(i.productType),
            saleRate: Number(i.saleRate),
            batchId: i.batchId || undefined,
            remarks: i.remarks || undefined,
          })),
          deductions: deductions
            .filter((d) => d.amount)
            .map((d) => ({
              deductionType: d.deductionType,
              description: d.description || undefined,
              amount: Number(d.amount),
            })),
        },
      });
      toast({ title: "Sale created as draft" });
      qc.invalidateQueries({ queryKey: getListSalesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetSalesSummaryQueryKey() });
      onClose();
    } catch {
      toast({ title: "Failed to create sale", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-slate-900 border-white/10 text-slate-100 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-slate-100">New Sale</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-400">Project *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-sm">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Sale Date *</Label>
              <Input
                type="date"
                className="bg-slate-800 border-slate-600 text-sm"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Buyer from registry (optional)</Label>
              <Select onValueChange={handleBuyerSelect}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-sm">
                  <SelectValue placeholder="Select registered buyer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">— Enter name manually —</SelectItem>
                  {buyers?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-400">Buyer Name *</Label>
              <Input
                className="bg-slate-800 border-slate-600 text-sm"
                placeholder="Buyer name"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Document Reference</Label>
              <Input
                className="bg-slate-800 border-slate-600 text-sm"
                placeholder="Invoice / weighment slip no."
                value={documentRef}
                onChange={(e) => setDocumentRef(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Notes</Label>
              <Input
                className="bg-slate-800 border-slate-600 text-sm"
                placeholder="Optional notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">Products Sold</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-emerald-400 hover:bg-emerald-500/10"
                onClick={addLineItem}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Product
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, i) => (
                <div key={i} className="bg-slate-800/50 border border-white/10 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-slate-400">Type</Label>
                      <Select
                        value={item.productType}
                        onValueChange={(v) => updateLineItem(i, "productType", v)}
                      >
                        <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCT_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">Linked Batch (optional)</Label>
                      <Select
                        value={item.batchId || "none"}
                        onValueChange={(v) => updateLineItem(i, "batchId", v === "none" ? "" : v)}
                      >
                        <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                          <SelectValue placeholder="No batch" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No specific batch</SelectItem>
                          {batches?.map((b) => (
                            <SelectItem key={b.id} value={b.id}>{b.batchNumber} — {b.batchDate}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">
                        Quantity ({productUnit(item.productType)})
                      </Label>
                      <Input
                        type="number"
                        className="h-8 text-xs bg-slate-800 border-slate-600"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(i, "quantity", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400">
                        Rate (₹/{productUnit(item.productType)})
                      </Label>
                      <Input
                        type="number"
                        className="h-8 text-xs bg-slate-800 border-slate-600"
                        value={item.saleRate}
                        onChange={(e) => updateLineItem(i, "saleRate", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-slate-500">
                      {item.quantity && item.saleRate && (
                        <>
                          Amount:{" "}
                          <span className="text-slate-200 font-mono">
                            {fmtINR(Number(item.quantity) * Number(item.saleRate))}
                          </span>
                        </>
                      )}
                    </div>
                    {lineItems.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-slate-500 hover:text-red-400"
                        onClick={() => removeLineItem(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deductions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-300">Deductions</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-rose-400 hover:bg-rose-500/10"
                onClick={addDeduction}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Deduction
              </Button>
            </div>
            {!deductions.length && (
              <p className="text-xs text-slate-500 text-center py-2">No deductions added.</p>
            )}
            <div className="space-y-2">
              {deductions.map((d, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <Label className="text-xs text-slate-400">Type</Label>
                    <Select
                      value={d.deductionType}
                      onValueChange={(v) => updateDeduction(i, "deductionType", v)}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEDUCTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Description</Label>
                    <Input
                      className="h-8 text-xs bg-slate-800 border-slate-600"
                      placeholder="e.g. Lorry freight"
                      value={d.description}
                      onChange={(e) => updateDeduction(i, "description", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-400">Amount (₹)</Label>
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        className="h-8 text-xs bg-slate-800 border-slate-600"
                        value={d.amount}
                        onChange={(e) => updateDeduction(i, "amount", e.target.value)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0 text-slate-500 hover:text-red-400"
                        onClick={() => removeDeduction(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals preview */}
          <div className="bg-slate-800/50 border border-white/10 rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Gross Revenue</span>
              <span className="font-mono text-slate-100">{fmtINR(totalGross)}</span>
            </div>
            {totalDed > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Total Deductions</span>
                <span className="font-mono text-rose-400">−{fmtINR(totalDed)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-semibold border-t border-white/10 pt-1 mt-1">
              <span className="text-slate-300">Net Revenue</span>
              <span className="font-mono text-emerald-400">{fmtINR(totalGross - totalDed)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" className="border-slate-600">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={createSale.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Create Draft Sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Buyer Dialog ──────────────────────────────────────────────────────────────

function BuyerDialog({
  open,
  buyer,
  onClose,
}: {
  open: boolean;
  buyer?: Buyer;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createBuyer = useCreateBuyer();
  const updateBuyer = useUpdateBuyer();

  const [form, setForm] = useState({
    name: buyer?.name ?? "",
    buyerType: buyer?.buyerType ?? "trader",
    contactPerson: buyer?.contactPerson ?? "",
    phone: buyer?.phone ?? "",
    email: buyer?.email ?? "",
    address: buyer?.address ?? "",
    gstin: buyer?.gstin ?? "",
    notes: buyer?.notes ?? "",
  });

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      if (buyer) {
        await updateBuyer.mutateAsync({ id: buyer.id, data: form });
        toast({ title: "Buyer updated" });
      } else {
        await createBuyer.mutateAsync({ data: form });
        toast({ title: "Buyer added to registry" });
      }
      qc.invalidateQueries({ queryKey: getListBuyersQueryKey() });
      onClose();
    } catch {
      toast({ title: "Failed to save buyer", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-slate-900 border-white/10 text-slate-100">
        <DialogHeader>
          <DialogTitle>{buyer ? "Edit Buyer" : "Add Buyer"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs text-slate-400">Name *</Label>
            <Input
              className="bg-slate-800 border-slate-600"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Buyer Type</Label>
            <Select
              value={form.buyerType}
              onValueChange={(v) => setForm((f) => ({ ...f, buyerType: v }))}
            >
              <SelectTrigger className="bg-slate-800 border-slate-600"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUYER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-400">Contact Person</Label>
            <Input
              className="bg-slate-800 border-slate-600"
              value={form.contactPerson}
              onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Phone</Label>
            <Input
              className="bg-slate-800 border-slate-600"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Email</Label>
            <Input
              type="email"
              className="bg-slate-800 border-slate-600"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs text-slate-400">Address</Label>
            <Input
              className="bg-slate-800 border-slate-600"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-400">GSTIN</Label>
            <Input
              className="bg-slate-800 border-slate-600 font-mono uppercase"
              value={form.gstin}
              onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-400">Notes</Label>
            <Input
              className="bg-slate-800 border-slate-600"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" className="border-slate-600">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={createBuyer.isPending || updateBuyer.isPending}
            className="bg-sky-600 hover:bg-sky-700 text-white"
          >
            {buyer ? "Save Changes" : "Add Buyer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Sales Page ───────────────────────────────────────────────────────────

export default function Sales() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const canManage = role === "admin" || role === "developer";

  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [buyerFilter, setBuyerFilter] = useState("all");
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [newSaleOpen, setNewSaleOpen] = useState(false);
  const [buyerDialogOpen, setBuyerDialogOpen] = useState(false);
  const [editingBuyer, setEditingBuyer] = useState<Buyer | undefined>(undefined);

  const effectiveProjectId = selectedProjectId ?? (projectFilter !== "all" ? projectFilter : undefined);

  const { data: projects } = useListProjects();
  const { data: buyers } = useListBuyers();
  const { data: summary } = useGetSalesSummary({ projectId: effectiveProjectId });
  const { data: sales, isLoading: loadingSales } = useListSales({
    projectId: effectiveProjectId,
    status: statusFilter !== "all" ? statusFilter : undefined,
    buyerId: buyerFilter !== "all" ? buyerFilter : undefined,
  });

  // ── Chart data ──────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!summary?.projects) return [];
    return summary.projects
      .filter((p) => p.totalGrossRevenue > 0)
      .map((p) => ({
        name: p.projectName ?? p.projectId.slice(0, 8),
        "Gross Revenue": p.totalGrossRevenue,
        "Deductions": p.totalDeductions,
        "Net Revenue": p.totalNetRevenue,
      }));
  }, [summary]);

  // ── Totals by product type from current sales list ──────────────────────
  const confirmedCount = useMemo(
    () => (sales as SalesTransaction[] | undefined)?.filter((s) => s.status === "confirmed").length ?? 0,
    [sales],
  );
  const draftCount = useMemo(
    () => (sales as SalesTransaction[] | undefined)?.filter((s) => s.status === "draft").length ?? 0,
    [sales],
  );

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-emerald-400" /> Sales
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Record rubber sales, manage buyers, and track revenue
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => setNewSaleOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="h-4 w-4 mr-2" /> New Sale
          </Button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-slate-400">Net Revenue</span>
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400">
              {summary ? fmtINR(summary.totalNetRevenue) : <Skeleton className="h-6 w-24" />}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-sky-400" />
              <span className="text-xs text-slate-400">Gross Revenue</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {summary ? fmtINR(summary.totalGrossRevenue) : <Skeleton className="h-6 w-24" />}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-slate-400">Confirmed</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">{confirmedCount}</div>
            {draftCount > 0 && (
              <div className="text-xs text-amber-400 mt-0.5">{draftCount} draft</div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-white/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-slate-400">Registered Buyers</span>
            </div>
            <div className="text-xl font-bold font-mono text-slate-100">
              {buyers ? buyers.length : <Skeleton className="h-6 w-12" />}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="transactions">
        <TabsList className="bg-slate-800/60 border border-white/10">
          <TabsTrigger
            value="transactions"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs"
          >
            <ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Transactions
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs"
          >
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Reports
          </TabsTrigger>
          <TabsTrigger
            value="buyers"
            className="data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400 text-xs"
          >
            <Users className="h-3.5 w-3.5 mr-1.5" /> Buyers
          </TabsTrigger>
        </TabsList>

        {/* ── Transactions tab ─────────────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-4 space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {!selectedProjectId && (
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-8 w-44 text-xs bg-slate-800 border-slate-700">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36 text-xs bg-slate-800 border-slate-700">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={buyerFilter} onValueChange={setBuyerFilter}>
              <SelectTrigger className="h-8 w-44 text-xs bg-slate-800 border-slate-700">
                <SelectValue placeholder="All buyers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All buyers</SelectItem>
                {buyers?.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingSales ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !sales?.length ? (
            <Card className="bg-slate-800/50 border-white/10">
              <CardContent className="py-12 text-center text-slate-500 text-sm">
                No sales recorded yet.
                {canManage && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() => setNewSaleOpen(true)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Create First Sale
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-slate-800/60 border-white/10">
              <CardContent className="p-0">
                <div className="divide-y divide-white/5">
                  {(sales as SalesTransaction[]).map((tx) => (
                    <div key={tx.id}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left"
                        onClick={() => setExpandedTx(expandedTx === tx.id ? null : tx.id)}
                      >
                        <span className="text-slate-500 shrink-0">
                          {expandedTx === tx.id
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-slate-100">
                              {tx.saleNumber}
                            </span>
                            <StatusBadge status={tx.status} />
                            {tx.projectName && (
                              <span className="text-xs text-slate-500">{tx.projectName}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />{tx.buyerName}
                            </span>
                            <span>{fmtDate(tx.saleDate)}</span>
                            {tx.buyerPhone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />{tx.buyerPhone}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-sm font-semibold text-emerald-400">
                            {fmtINR(tx.totalNetRevenue)}
                          </div>
                          {tx.totalDeductions > 0 && (
                            <div className="text-xs text-rose-400 font-mono">
                              −{fmtINR(tx.totalDeductions)} ded.
                            </div>
                          )}
                        </div>
                      </button>
                      {expandedTx === tx.id && (
                        <div className="border-t border-white/5 px-4 py-4 bg-slate-950/30">
                          <SaleDetailPanel
                            txId={tx.id}
                            onClose={() => setExpandedTx(null)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Reports tab ──────────────────────────────────────────────── */}
        <TabsContent value="reports" className="mt-4 space-y-4">
          {chartData.length > 0 && (
            <Card className="bg-slate-800/60 border-white/10">
              <CardHeader className="pb-0 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-slate-300">Revenue by Project</CardTitle>
              </CardHeader>
              <CardContent className="pt-3 pb-4 px-2">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      axisLine={false}
                      width={64}
                      tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#1e293b",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => fmtINR(v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                    <Bar dataKey="Gross Revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Deductions" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Net Revenue" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card className="bg-slate-800/60 border-white/10">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-slate-300">Project-wise Sales Report</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400">Project</TableHead>
                    <TableHead className="text-slate-400 text-right">Total</TableHead>
                    <TableHead className="text-slate-400 text-right">Confirmed</TableHead>
                    <TableHead className="text-slate-400 text-right">Gross Revenue</TableHead>
                    <TableHead className="text-slate-400 text-right">Deductions</TableHead>
                    <TableHead className="text-slate-400 text-right">Net Revenue</TableHead>
                    <TableHead className="text-slate-400 text-right">Ded %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!summary?.projects?.length ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500 text-sm py-6">
                        No sales data yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    summary.projects.map((p) => {
                      const dedPct =
                        p.totalGrossRevenue > 0
                          ? Math.round((p.totalDeductions / p.totalGrossRevenue) * 100)
                          : 0;
                      return (
                        <TableRow key={p.projectId} className="border-white/5 hover:bg-white/3">
                          <TableCell className="text-sm text-slate-200">
                            {p.projectName ?? p.projectId.slice(0, 8)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-slate-300">{p.totalSales}</TableCell>
                          <TableCell className="text-right text-sm text-emerald-400">{p.confirmedSales}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-slate-100">
                            {fmtINR(p.totalGrossRevenue)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-rose-400">
                            −{fmtINR(p.totalDeductions)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-bold text-emerald-400">
                            {fmtINR(p.totalNetRevenue)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-400">{dedPct}%</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Overall summary footer */}
          {summary && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/60 border border-white/10 rounded-lg p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Total Sales</div>
                <div className="text-2xl font-bold text-slate-100">{summary.totalSalesCount}</div>
              </div>
              <div className="bg-slate-800/60 border border-white/10 rounded-lg p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Gross Revenue</div>
                <div className="text-xl font-bold font-mono text-slate-100">{fmtINR(summary.totalGrossRevenue)}</div>
              </div>
              <div className="bg-slate-800/60 border border-white/10 rounded-lg p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Net Revenue</div>
                <div className="text-xl font-bold font-mono text-emerald-400">{fmtINR(summary.totalNetRevenue)}</div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Buyers tab ───────────────────────────────────────────────── */}
        <TabsContent value="buyers" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">
              {buyers?.length ?? 0} registered buyer{buyers?.length !== 1 ? "s" : ""}
            </span>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingBuyer(undefined);
                  setBuyerDialogOpen(true);
                }}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Buyer
              </Button>
            )}
          </div>

          {!buyers?.length ? (
            <Card className="bg-slate-800/50 border-white/10">
              <CardContent className="py-10 text-center text-slate-500 text-sm">
                No buyers registered yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {buyers.map((buyer) => (
                <Card
                  key={buyer.id}
                  className="bg-slate-800/60 border-white/10 hover:border-white/20 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-100 truncate">{buyer.name}</span>
                          <Badge className="text-xs bg-slate-700/80 text-slate-400 border-slate-600 shrink-0 capitalize">
                            {buyer.buyerType}
                          </Badge>
                        </div>
                        {buyer.contactPerson && (
                          <div className="text-xs text-slate-400 mt-1">
                            <Users className="h-3 w-3 inline mr-1" />{buyer.contactPerson}
                          </div>
                        )}
                        <div className="space-y-0.5 mt-2">
                          {buyer.phone && (
                            <div className="flex items-center gap-1 text-xs text-slate-400">
                              <Phone className="h-3 w-3" /> {buyer.phone}
                            </div>
                          )}
                          {buyer.email && (
                            <div className="flex items-center gap-1 text-xs text-slate-400">
                              <Mail className="h-3 w-3" /> {buyer.email}
                            </div>
                          )}
                          {buyer.address && (
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              <MapPin className="h-3 w-3" /> {buyer.address}
                            </div>
                          )}
                          {buyer.gstin && (
                            <div className="text-xs text-slate-500 font-mono">
                              GST: {buyer.gstin}
                            </div>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-slate-500 hover:text-sky-400 shrink-0"
                          onClick={() => {
                            setEditingBuyer(buyer);
                            setBuyerDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <NewSaleDialog open={newSaleOpen} onClose={() => setNewSaleOpen(false)} />
      <BuyerDialog
        open={buyerDialogOpen}
        buyer={editingBuyer}
        onClose={() => {
          setBuyerDialogOpen(false);
          setEditingBuyer(undefined);
        }}
      />
    </div>
  );
}
