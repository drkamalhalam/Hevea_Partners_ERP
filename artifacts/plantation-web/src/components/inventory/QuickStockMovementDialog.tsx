import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateStockMovement,
  useListProjects,
  getGetProjectCardSummariesQueryKey,
  getListStockMovementsQueryKey,
  getGetStockSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDown, ArrowUp, Warehouse, AlertCircle } from "lucide-react";
import { format } from "date-fns";

type StockType = "latex" | "rubber_sheet" | "rubber_scrap";
type MovementType =
  | "opening"
  | "production_in"
  | "purchase_in"
  | "sale_out"
  | "transfer_out"
  | "wastage"
  | "adjustment_in"
  | "adjustment_out";

const MOVEMENT_OPTIONS: {
  value: MovementType;
  label: string;
  direction: "in" | "out";
  group: string;
}[] = [
  { value: "production_in", label: "From Production", direction: "in", group: "Stock In" },
  { value: "purchase_in", label: "Purchase / Receipt", direction: "in", group: "Stock In" },
  { value: "adjustment_in", label: "Adjustment (+)", direction: "in", group: "Adjustments" },
  { value: "sale_out", label: "Sale Deduction", direction: "out", group: "Stock Out" },
  { value: "transfer_out", label: "Transfer Out", direction: "out", group: "Stock Out" },
  { value: "wastage", label: "Wastage / Loss", direction: "out", group: "Stock Out" },
  { value: "adjustment_out", label: "Adjustment (−)", direction: "out", group: "Adjustments" },
  { value: "opening", label: "Opening Balance", direction: "in", group: "Stock In" },
];

const STOCK_TYPE_OPTIONS: { value: StockType; label: string; unit: string }[] = [
  { value: "rubber_sheet", label: "Rubber Sheet", unit: "kg" },
  { value: "rubber_scrap", label: "Rubber Scrap", unit: "kg" },
  { value: "latex", label: "Latex", unit: "litres" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  initialProjectId?: string;
};

export function QuickStockMovementDialog({ open, onClose, initialProjectId }: Props) {
  const qc = useQueryClient();
  const { data: projects = [] } = useListProjects();
  const createMovement = useCreateStockMovement();

  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [stockType, setStockType] = useState<StockType>("rubber_sheet");
  const [movementType, setMovementType] = useState<MovementType>("production_in");
  const [quantity, setQuantity] = useState("");
  const [movementDate, setMovementDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const selectedOption = MOVEMENT_OPTIONS.find((o) => o.value === movementType);
  const selectedStockMeta = STOCK_TYPE_OPTIONS.find((s) => s.value === stockType);
  const unit = selectedStockMeta?.unit ?? "kg";
  const isOut = selectedOption?.direction === "out";

  async function handleSubmit() {
    setError("");
    if (!projectId) return setError("Please select a project.");
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return setError("Quantity must be a positive number.");
    if (!movementDate) return setError("Movement date is required.");

    try {
      await createMovement.mutateAsync({
        data: {
          projectId,
          stockType,
          movementType,
          quantity: qty,
          unit: unit as "kg" | "litres",
          movementDate,
          notes: notes.trim() || undefined,
        },
      });

      qc.invalidateQueries({ queryKey: getListStockMovementsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetStockSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getGetProjectCardSummariesQueryKey() });
      handleClose();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "Failed to record movement. Please try again.");
    }
  }

  function handleClose() {
    setProjectId(initialProjectId ?? "");
    setStockType("rubber_sheet");
    setMovementType("production_in");
    setQuantity("");
    setMovementDate(format(new Date(), "yyyy-MM-dd"));
    setNotes("");
    setError("");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-teal-600" />
            Log Stock Movement
          </DialogTitle>
          <DialogDescription>
            Record a stock movement for any project — inventory balances update instantly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* Project */}
          <div className="space-y-1.5">
            <Label>Project <span className="text-red-500">*</span></Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent>
                {projects
                  .filter((p) => p.activationStatus === "active" || p.activationStatus == null)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stock type + movement type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Stock Type</Label>
              <Select value={stockType} onValueChange={(v) => setStockType(v as StockType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_TYPE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Movement Type</Label>
              <Select value={movementType} onValueChange={(v) => setMovementType(v as MovementType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Stock In", "Stock Out", "Adjustments"].map((group) => (
                    <div key={group}>
                      <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {group}
                      </div>
                      {MOVEMENT_OPTIONS.filter((o) => o.group === group).map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Direction indicator */}
          {selectedOption && (
            <div className={`flex items-center gap-2 text-xs font-medium rounded-md px-3 py-2 ${isOut ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
              {isOut ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
              {isOut ? "Stock will decrease" : "Stock will increase"} — {selectedOption.label}
            </div>
          )}

          {/* Quantity + date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantity ({unit}) <span className="text-red-500">*</span></Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={movementDate}
                onChange={(e) => setMovementDate(e.target.value)}
              />
            </div>
          </div>

          {/* Reference note */}
          <div className="space-y-1.5">
            <Label>Reference Note</Label>
            <Textarea
              placeholder="Batch ID, invoice ref, or any context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={createMovement.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={createMovement.isPending}
            className={isOut ? "bg-red-600 hover:bg-red-700" : "bg-teal-600 hover:bg-teal-700"}
          >
            {createMovement.isPending ? "Saving…" : `Record ${isOut ? "Outflow" : "Inflow"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
