/**
 * LossAbsorption.tsx
 *
 * Loss Absorption & Negative Balance Adjustment Engine UI.
 * Advisory only — no automatic settlements are triggered.
 *
 * Tabs:
 *   Overview   — KPI cards + period analytics chart
 *   Records    — Loss absorption records CRUD
 *   Balances   — Negative balance ledger
 *   Settlement — Advisory settlement priority waterfall
 */

import { useState, useMemo } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { useListPartners } from "@workspace/api-client-react";
import {
  useListLossAbsorptionRecords,
  useCreateLossAbsorptionRecord,
  useUpdateLossAbsorptionRecord,
  useConfirmLossAbsorptionRecord,
  useDeleteLossAbsorptionRecord,
  useListNegativeBalanceEntries,
  useCreateNegativeBalanceEntry,
  useUpdateNegativeBalanceEntry,
  useGetSettlementPriority,
  getGetSettlementPriorityQueryKey,
  useGetLossAbsorptionSummary,
  getGetLossAbsorptionSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  LossAbsorptionRecord,
  NegativeBalanceEntry,
} from "@workspace/api-client-react";
import { useRole } from "../contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  AlertTriangle,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Plus,
  CheckCircle,
  Trash2,
  Pencil,
  Info,
  RefreshCw,
} from "lucide-react";
import { cn } from "../lib/utils";

// ── Formatting helpers ──────────────────────────────────────────────────────

function inr(v: number | string | undefined | null): string {
  const n = parseFloat(String(v ?? "0")) || 0;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

// ── Status badges ───────────────────────────────────────────────────────────

function RecordStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
    confirmed: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium border", map[status] ?? "bg-zinc-800 text-zinc-300 border-zinc-600")}>
      {status}
    </span>
  );
}

function CarryStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    none: "bg-zinc-800 text-zinc-400 border-zinc-600",
    pending: "bg-red-900/40 text-red-300 border-red-700",
    partial: "bg-amber-900/40 text-amber-300 border-amber-700",
    resolved: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium border", map[status] ?? "bg-zinc-800 text-zinc-300 border-zinc-600")}>
      {status}
    </span>
  );
}

function RecoveryStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-red-900/40 text-red-300 border-red-700",
    partial: "bg-amber-900/40 text-amber-300 border-amber-700",
    recovered: "bg-emerald-900/40 text-emerald-300 border-emerald-700",
    waived: "bg-zinc-800 text-zinc-400 border-zinc-600",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-xs font-medium border", map[status] ?? "bg-zinc-800 text-zinc-300 border-zinc-600")}>
      {status}
    </span>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "red" | "amber" | "green" | "blue" | "default";
}) {
  const accentClass =
    accent === "red"
      ? "border-red-700/50"
      : accent === "amber"
      ? "border-amber-700/50"
      : accent === "green"
      ? "border-emerald-700/50"
      : accent === "blue"
      ? "border-sky-700/50"
      : "border-zinc-700";

  const valueClass =
    accent === "red"
      ? "text-red-400"
      : accent === "amber"
      ? "text-amber-400"
      : accent === "green"
      ? "text-emerald-400"
      : accent === "blue"
      ? "text-sky-400"
      : "text-white";

  return (
    <Card className={cn("bg-zinc-900 border", accentClass)}>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">{label}</p>
        <p className={cn("text-2xl font-semibold", valueClass)}>{value}</p>
        {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Add/Edit Record Dialog ──────────────────────────────────────────────────

interface RecordFormData {
  projectId: string;
  partnerId: string;
  periodLabel: string;
  periodYear: string;
  expectedBurden: string;
  actualBurden: string;
  grossEntitlement: string;
  notes: string;
}

function RecordDialog({
  open,
  onClose,
  existing,
  projectId,
  partnerId,
  projectOptions,
  partnerOptions,
}: {
  open: boolean;
  onClose: () => void;
  existing?: LossAbsorptionRecord;
  projectId: string;
  partnerId: string;
  projectOptions: { id: string; name: string }[];
  partnerOptions: { id: string; name: string }[];
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState<RecordFormData>({
    projectId: existing?.projectId ?? projectId,
    partnerId: existing?.partnerId ?? partnerId,
    periodLabel: existing?.periodLabel ?? "",
    periodYear: String(existing?.periodYear ?? new Date().getFullYear()),
    expectedBurden: String(parseFloat(String(existing?.expectedBurden ?? "0")) || 0),
    actualBurden: String(parseFloat(String(existing?.actualBurden ?? "0")) || 0),
    grossEntitlement: String(parseFloat(String(existing?.grossEntitlement ?? "0")) || 0),
    notes: existing?.notes ?? "",
  });

  const createMut = useCreateLossAbsorptionRecord();
  const updateMut = useUpdateLossAbsorptionRecord();
  const busy = createMut.isPending || updateMut.isPending;

  function f(k: keyof RecordFormData, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (!form.projectId || !form.partnerId || !form.periodLabel) return;
    if (isEdit && existing) {
      await updateMut.mutateAsync({
        id: existing.id,
        data: {
          periodLabel: form.periodLabel,
          periodYear: parseInt(form.periodYear) || undefined,
          expectedBurden: parseFloat(form.expectedBurden) || 0,
          actualBurden: parseFloat(form.actualBurden) || 0,
          grossEntitlement: parseFloat(form.grossEntitlement) || 0,
          notes: form.notes || undefined,
        },
      });
    } else {
      await createMut.mutateAsync({
        data: {
          projectId: form.projectId,
          partnerId: form.partnerId,
          periodLabel: form.periodLabel,
          periodYear: parseInt(form.periodYear) || undefined,
          expectedBurden: parseFloat(form.expectedBurden) || 0,
          actualBurden: parseFloat(form.actualBurden) || 0,
          grossEntitlement: parseFloat(form.grossEntitlement) || 0,
          notes: form.notes || undefined,
        },
      });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit" : "Add"} Loss Absorption Record</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          {!isEdit && (
            <>
              <div className="col-span-2">
                <Label className="text-zinc-400 text-xs">Project *</Label>
                <Select value={form.projectId} onValueChange={(v) => f("projectId", v)}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-600">
                    {projectOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-zinc-100">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-zinc-400 text-xs">Partner / Landowner *</Label>
                <Select value={form.partnerId} onValueChange={(v) => f("partnerId", v)}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1">
                    <SelectValue placeholder="Select partner" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-600">
                    {partnerOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-zinc-100">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="col-span-2">
            <Label className="text-zinc-400 text-xs">Period Label *</Label>
            <Input
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              placeholder="e.g. FY 2024-25 Q2"
              value={form.periodLabel}
              onChange={(e) => f("periodLabel", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Period Year</Label>
            <Input
              type="number"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              value={form.periodYear}
              onChange={(e) => f("periodYear", e.target.value)}
            />
          </div>
          <div />
          <div>
            <Label className="text-zinc-400 text-xs">Expected Burden (₹)</Label>
            <Input
              type="number"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              value={form.expectedBurden}
              onChange={(e) => f("expectedBurden", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Actual Burden (₹)</Label>
            <Input
              type="number"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              value={form.actualBurden}
              onChange={(e) => f("actualBurden", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-zinc-400 text-xs">Gross Entitlement (₹)</Label>
            <Input
              type="number"
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              value={form.grossEntitlement}
              onChange={(e) => f("grossEntitlement", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-zinc-400 text-xs">Notes</Label>
            <Textarea
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              rows={2}
              value={form.notes}
              onChange={(e) => f("notes", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-zinc-600 text-zinc-300" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !form.projectId || !form.partnerId || !form.periodLabel}
            onClick={submit}
            className="bg-sky-700 hover:bg-sky-600 text-white"
          >
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Add Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add/Edit Negative Balance Dialog ───────────────────────────────────────

interface NbFormData {
  referenceType: string;
  periodLabel: string;
  changeAmount: string;
  description: string;
  notes: string;
}

function NegativeBalanceDialog({
  open,
  onClose,
  existing,
  projectId,
  partnerId,
}: {
  open: boolean;
  onClose: () => void;
  existing?: NegativeBalanceEntry;
  projectId: string;
  partnerId: string;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState<NbFormData>({
    referenceType: existing?.referenceType ?? "manual_adjustment",
    periodLabel: existing?.periodLabel ?? "",
    changeAmount: String(parseFloat(String(existing?.changeAmount ?? "0")) || 0),
    description: existing?.description ?? "",
    notes: existing?.notes ?? "",
  });

  const createMut = useCreateNegativeBalanceEntry();
  const updateMut = useUpdateNegativeBalanceEntry();
  const busy = createMut.isPending || updateMut.isPending;

  function f(k: keyof NbFormData, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function submit() {
    if (isEdit && existing) {
      await updateMut.mutateAsync({
        id: existing.id,
        data: {
          description: form.description,
          notes: form.notes || undefined,
        },
      });
    } else {
      await createMut.mutateAsync({
        data: {
          projectId,
          partnerId,
          referenceType: form.referenceType as any,
          periodLabel: form.periodLabel,
          changeAmount: parseFloat(form.changeAmount) || 0,
          description: form.description,
          notes: form.notes || undefined,
        },
      });
    }
    onClose();
  }

  const refTypeOptions = [
    { value: "loss_absorption", label: "Loss Absorption" },
    { value: "lca_shortfall", label: "LCA Shortfall" },
    { value: "settlement_deficit", label: "Settlement Deficit" },
    { value: "burden_imbalance", label: "Burden Imbalance" },
    { value: "manual_adjustment", label: "Manual Adjustment" },
    { value: "recovery_credit", label: "Recovery Credit" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit" : "Add"} Negative Balance Entry</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {!isEdit && (
            <>
              <div>
                <Label className="text-zinc-400 text-xs">Reference Type *</Label>
                <Select value={form.referenceType} onValueChange={(v) => f("referenceType", v)}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-600">
                    {refTypeOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-zinc-100">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-zinc-400 text-xs">Period Label *</Label>
                <Input
                  className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
                  placeholder="e.g. FY 2024-25 Q2"
                  value={form.periodLabel}
                  onChange={(e) => f("periodLabel", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-zinc-400 text-xs">
                  Change Amount (₹) — negative worsens balance
                </Label>
                <Input
                  type="number"
                  className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
                  value={form.changeAmount}
                  onChange={(e) => f("changeAmount", e.target.value)}
                />
              </div>
            </>
          )}
          <div>
            <Label className="text-zinc-400 text-xs">Description *</Label>
            <Input
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              value={form.description}
              onChange={(e) => f("description", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-zinc-400 text-xs">Notes</Label>
            <Textarea
              className="bg-zinc-800 border-zinc-600 text-zinc-100 mt-1"
              rows={2}
              value={form.notes}
              onChange={(e) => f("notes", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-zinc-600 text-zinc-300" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || (!isEdit && (!form.periodLabel || !form.description))}
            onClick={submit}
            className="bg-sky-700 hover:bg-sky-600 text-white"
          >
            {busy ? "Saving…" : isEdit ? "Save" : "Add Entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Settlement Priority Waterfall ───────────────────────────────────────────

function SettlementWaterfall({
  projectId,
  partnerId,
}: {
  projectId: string;
  partnerId: string;
}) {
  const { data, isLoading, refetch } = useGetSettlementPriority(
    { projectId, partnerId },
    { query: { queryKey: getGetSettlementPriorityQueryKey({ projectId, partnerId }) } },
  );

  if (isLoading) {
    return <p className="text-zinc-500 text-sm py-8 text-center">Computing waterfall…</p>;
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-500 text-sm">Select a project and partner to view the advisory waterfall.</p>
      </div>
    );
  }

  const { waterfall, summary, disclaimer, computedAt } = data as any;

  const tiers = [
    {
      tier: "Tier 1",
      label: waterfall?.tier1?.label ?? "Recover Past Imbalances",
      desc: waterfall?.tier1?.description ?? "Pending negative balance entries",
      obligation: summary?.tier1Obligation ?? 0,
      allocated: summary?.tier1Allocated ?? 0,
      funded: waterfall?.tier1?.fullyFunded,
      color: "red",
    },
    {
      tier: "Tier 2",
      label: waterfall?.tier2?.label ?? "Pay Pending LCA",
      desc: waterfall?.tier2?.description ?? "Outstanding LCA balances",
      obligation: summary?.tier2Obligation ?? 0,
      allocated: summary?.tier2Allocated ?? 0,
      funded: waterfall?.tier2?.fullyFunded,
      color: "amber",
    },
    {
      tier: "Tier 3",
      label: "Distribute Current Profit",
      desc: "Remaining surplus after Tier 1 & 2",
      obligation: null,
      allocated: summary?.tier3Allocated ?? 0,
      funded: (summary?.tier3Allocated ?? 0) > 0,
      color: "green",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Advisory only — no payments are triggered automatically.
          Computed at {new Date(computedAt).toLocaleString()}.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="border-zinc-600 text-zinc-300"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-3 h-3 mr-1" /> Recalculate
        </Button>
      </div>

      {/* Available funds */}
      <Card className="bg-zinc-800 border-zinc-600">
        <CardContent className="py-4 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Available Funds (from EPP / settlements)</span>
          <span className="text-xl font-semibold text-white">{inr(data.availableFunds)}</span>
        </CardContent>
      </Card>

      {/* Tier cards */}
      <div className="space-y-3">
        {tiers.map((t) => {
          const colorMap: Record<string, string> = {
            red: "border-red-700/50",
            amber: "border-amber-700/50",
            green: "border-emerald-700/50",
          };
          const badgeClass = t.funded
            ? "bg-emerald-900/40 text-emerald-300"
            : "bg-red-900/40 text-red-300";
          return (
            <Card key={t.tier} className={cn("bg-zinc-900 border", colorMap[t.color])}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-zinc-500">{t.tier}</span>
                      <span className="text-sm font-medium text-zinc-100">{t.label}</span>
                    </div>
                    <p className="text-xs text-zinc-500">{t.desc}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {t.obligation !== null && (
                      <p className="text-xs text-zinc-500">
                        Obligation: {inr(t.obligation)}
                      </p>
                    )}
                    <p className="text-base font-semibold text-white">
                      Allocated: {inr(t.allocated)}
                    </p>
                    <span className={cn("text-xs px-2 py-0.5 rounded mt-1 inline-block", badgeClass)}>
                      {t.funded ? "Fully funded" : "Shortfall"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Summary row */}
      <Card className="bg-zinc-800 border-zinc-600">
        <CardContent className="py-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-zinc-500">Total Obligations</p>
              <p className="text-base font-semibold text-white">{inr(summary?.totalObligations ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Net Distributable</p>
              <p className="text-base font-semibold text-emerald-400">{inr(summary?.netDistributable ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Surplus / Deficit</p>
              <p className={cn(
                "text-base font-semibold",
                (summary?.surplusOrDeficit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
              )}>
                {inr(Math.abs(summary?.surplusOrDeficit ?? 0))}
                {(summary?.surplusOrDeficit ?? 0) >= 0 ? " surplus" : " deficit"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {disclaimer && (
        <div className="flex gap-2 p-3 bg-zinc-800 rounded border border-zinc-600">
          <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-500">{disclaimer}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

type TabId = "overview" | "records" | "balances" | "settlement";

export default function LossAbsorption() {
  const { role } = useRole();
  const isAdminDev = role === "admin" || role === "developer";

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [projectId, setProjectId] = useState("");
  const [partnerId, setPartnerId] = useState("");

  // Dialogs
  const [recordDialog, setRecordDialog] = useState<{
    open: boolean;
    editing?: LossAbsorptionRecord;
  }>({ open: false });
  const [nbDialog, setNbDialog] = useState<{
    open: boolean;
    editing?: NegativeBalanceEntry;
  }>({ open: false });

  // Data
  const { data: projectsData } = useListProjects();
  const { data: partnersData } = useListPartners();

  const projectOptions = useMemo(
    () => (projectsData as any)?.projects ?? (Array.isArray(projectsData) ? projectsData : []),
    [projectsData],
  );
  const partnerOptions = useMemo(
    () => (partnersData as any)?.partners ?? (Array.isArray(partnersData) ? partnersData : []),
    [partnersData],
  );

  const { data: summaryData, refetch: refetchSummary } = useGetLossAbsorptionSummary(
    { projectId, partnerId },
    { query: { queryKey: getGetLossAbsorptionSummaryQueryKey({ projectId, partnerId }) } },
  );
  const summary = summaryData as any;

  const { data: recordsData, refetch: refetchRecords } = useListLossAbsorptionRecords(
    { projectId: projectId || undefined, partnerId: partnerId || undefined },
  );
  const records: LossAbsorptionRecord[] = useMemo(
    () => (recordsData as any)?.records ?? [],
    [recordsData],
  );

  const { data: nbData, refetch: refetchNb } = useListNegativeBalanceEntries(
    { projectId: projectId || undefined, partnerId: partnerId || undefined },
  );
  const nbEntries: NegativeBalanceEntry[] = useMemo(
    () => (nbData as any)?.entries ?? [],
    [nbData],
  );

  // Mutations
  const confirmMut = useConfirmLossAbsorptionRecord();
  const deleteMut = useDeleteLossAbsorptionRecord();

  const kpis = summary?.kpis ?? {};
  const recovery = summary?.recovery ?? {};
  const analytics: any[] = summary?.periodAnalytics ?? [];

  const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "records", label: "Loss Records" },
    { id: "balances", label: "Negative Balances" },
    { id: "settlement", label: "Settlement Priority" },
  ];

  return (
    <div className="p-6 space-y-6 text-zinc-100">
      {/* Header */}
      <div className="flex items-center gap-3">
        <TrendingDown className="w-6 h-6 text-red-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Loss Absorption Engine</h1>
          <p className="text-sm text-zinc-400">
            Track expected vs actual burden, carry-forward imbalances, and negative balance positions.
            Advisory only — no automatic payments.
          </p>
        </div>
      </div>

      {/* Advisory banner */}
      <div className="flex items-center gap-2 px-4 py-3 bg-amber-950/40 border border-amber-700/50 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="text-sm text-amber-300">
          <strong>Advisory system.</strong> All computations are informational.
          Settlement recommendations must be reviewed and approved manually.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-zinc-400 text-xs whitespace-nowrap">Project</Label>
          <Select value={projectId || "__all__"} onValueChange={(v) => setProjectId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 w-56">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-600">
              <SelectItem value="__all__" className="text-zinc-400">All projects</SelectItem>
              {projectOptions.map((p: any) => (
                <SelectItem key={p.id} value={p.id} className="text-zinc-100">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-zinc-400 text-xs whitespace-nowrap">Partner</Label>
          <Select value={partnerId || "__all__"} onValueChange={(v) => setPartnerId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-100 w-56">
              <SelectValue placeholder="All partners" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-600">
              <SelectItem value="__all__" className="text-zinc-400">All partners</SelectItem>
              {partnerOptions.map((p: any) => (
                <SelectItem key={p.id} value={p.id} className="text-zinc-100">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(projectId || partnerId) && (
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-600 text-zinc-400"
            onClick={() => { setProjectId(""); setPartnerId(""); }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-700">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === t.id
                  ? "border-sky-500 text-sky-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Overview ── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiCard
              label="Total Loss Absorbed"
              value={inr(kpis.totalLossAbsorbed ?? 0)}
              accent="red"
            />
            <KpiCard
              label="Carry-Forward Pending"
              value={inr(kpis.totalCarryForwardPending ?? 0)}
              accent="amber"
            />
            <KpiCard
              label="Current Negative Balance"
              value={inr(kpis.currentNegativeBalance ?? 0)}
              accent={
                (kpis.currentNegativeBalance ?? 0) < 0 ? "red" : "green"
              }
            />
            <KpiCard
              label="Burden Imbalance"
              value={inr(kpis.totalBurdenImbalance ?? 0)}
              accent="amber"
            />
            <KpiCard
              label="Confirmed Records"
              value={String(kpis.confirmedRecordCount ?? 0)}
              accent="green"
            />
            <KpiCard
              label="Draft Records"
              value={String(kpis.draftRecordCount ?? 0)}
              accent="default"
            />
          </div>

          {/* Recovery summary */}
          {projectId && partnerId && (
            <Card className="bg-zinc-900 border-zinc-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-300">Recovery Position</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <p className="text-xs text-zinc-500">Total Negative Created</p>
                    <p className="text-lg font-semibold text-red-400">{inr(recovery.totalNegativeCreated ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Recovered</p>
                    <p className="text-lg font-semibold text-emerald-400">{inr(recovery.totalRecovered ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Outstanding</p>
                    <p className="text-lg font-semibold text-amber-400">{inr(recovery.outstanding ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Recovery Rate</p>
                    <p className="text-lg font-semibold text-sky-400">
                      {pct(recovery.recoveryRate ?? 0)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Period analytics chart */}
          {analytics.length > 0 && (
            <Card className="bg-zinc-900 border-zinc-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-300">Period Analytics — Burden vs Entitlement</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={analytics} margin={{ top: 4, right: 16, left: 16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                    <XAxis dataKey="year" stroke="#71717a" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#71717a" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
                      labelStyle={{ color: "#e4e4e7" }}
                      formatter={(v: number) => inr(v)}
                    />
                    <Legend />
                    <Bar dataKey="expected" name="Expected Burden" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="actual" name="Actual Burden" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="loss" name="Loss Absorbed" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {!projectId || !partnerId ? (
            <p className="text-center text-zinc-500 text-sm py-4">
              Select a project and partner above to see the full summary.
            </p>
          ) : null}
        </div>
      )}

      {/* ── Tab: Loss Records ── */}
      {activeTab === "records" && (
        <div className="space-y-4">
          {isAdminDev && (
            <div className="flex justify-end">
              <Button
                className="bg-sky-700 hover:bg-sky-600 text-white"
                onClick={() => setRecordDialog({ open: true })}
              >
                <Plus className="w-4 h-4 mr-1" /> Add Record
              </Button>
            </div>
          )}

          {records.length === 0 ? (
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="py-12 text-center">
                <TrendingDown className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-500 text-sm">No loss absorption records found.</p>
                {isAdminDev && (
                  <p className="text-zinc-600 text-xs mt-1">Add a record to start tracking burden imbalances.</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-zinc-900 border-zinc-700">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-700 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Period</TableHead>
                    <TableHead className="text-zinc-400">Project</TableHead>
                    <TableHead className="text-zinc-400 text-right">Expected Burden</TableHead>
                    <TableHead className="text-zinc-400 text-right">Actual Burden</TableHead>
                    <TableHead className="text-zinc-400 text-right">Loss Absorbed</TableHead>
                    <TableHead className="text-zinc-400 text-right">Carry-Forward</TableHead>
                    <TableHead className="text-zinc-400">CF Status</TableHead>
                    <TableHead className="text-zinc-400">Status</TableHead>
                    {isAdminDev && <TableHead className="text-zinc-400 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id} className="border-zinc-700 hover:bg-zinc-800/50">
                      <TableCell className="text-zinc-200 font-medium">{r.periodLabel}</TableCell>
                      <TableCell className="text-zinc-400 text-sm">
                        {r.projectName ?? r.projectId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right text-zinc-300">{inr(r.expectedBurden)}</TableCell>
                      <TableCell className="text-right text-zinc-300">{inr(r.actualBurden)}</TableCell>
                      <TableCell className={cn(
                        "text-right font-semibold",
                        parseFloat(String(r.lossAbsorbed)) > 0 ? "text-red-400" : "text-zinc-400"
                      )}>
                        {inr(r.lossAbsorbed)}
                      </TableCell>
                      <TableCell className="text-right text-amber-400">{inr(r.carryForwardAmount)}</TableCell>
                      <TableCell><CarryStatusBadge status={r.carryForwardStatus} /></TableCell>
                      <TableCell><RecordStatusBadge status={r.status} /></TableCell>
                      {isAdminDev && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {r.status === "draft" && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-7 h-7 text-zinc-400 hover:text-zinc-100"
                                  title="Edit"
                                  onClick={() => setRecordDialog({ open: true, editing: r })}
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-7 h-7 text-emerald-400 hover:text-emerald-300"
                                  title="Confirm"
                                  onClick={() =>
                                    confirmMut.mutate({ id: r.id }, { onSuccess: () => refetchRecords() })
                                  }
                                >
                                  <CheckCircle className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                            {role === "admin" && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="w-7 h-7 text-red-400 hover:text-red-300"
                                title="Delete"
                                onClick={() =>
                                  deleteMut.mutate({ id: r.id }, { onSuccess: () => refetchRecords() })
                                }
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Negative Balances ── */}
      {activeTab === "balances" && (
        <div className="space-y-4">
          {isAdminDev && projectId && partnerId && (
            <div className="flex justify-end">
              <Button
                className="bg-sky-700 hover:bg-sky-600 text-white"
                onClick={() => setNbDialog({ open: true })}
              >
                <Plus className="w-4 h-4 mr-1" /> Add Entry
              </Button>
            </div>
          )}

          {nbEntries.length === 0 ? (
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="py-12 text-center">
                <p className="text-zinc-500 text-sm">No negative balance entries found.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-zinc-900 border-zinc-700">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-700 hover:bg-transparent">
                    <TableHead className="text-zinc-400">Period</TableHead>
                    <TableHead className="text-zinc-400">Reference Type</TableHead>
                    <TableHead className="text-zinc-400 text-right">Opening</TableHead>
                    <TableHead className="text-zinc-400 text-right">Change</TableHead>
                    <TableHead className="text-zinc-400 text-right">Closing</TableHead>
                    <TableHead className="text-zinc-400">Recovery</TableHead>
                    <TableHead className="text-zinc-400">Description</TableHead>
                    {isAdminDev && <TableHead className="text-zinc-400 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nbEntries.map((e) => {
                    const change = parseFloat(String(e.changeAmount));
                    return (
                      <TableRow key={e.id} className="border-zinc-700 hover:bg-zinc-800/50">
                        <TableCell className="text-zinc-200 font-medium">{e.periodLabel}</TableCell>
                        <TableCell>
                          <span className="text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-zinc-600">
                            {e.referenceType.replace(/_/g, " ")}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-zinc-400">{inr(e.openingBalance)}</TableCell>
                        <TableCell className={cn(
                          "text-right font-medium",
                          change < 0 ? "text-red-400" : "text-emerald-400"
                        )}>
                          {change >= 0 ? "+" : ""}{inr(change)}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-semibold",
                          parseFloat(String(e.closingBalance)) < 0 ? "text-red-400" : "text-emerald-400"
                        )}>
                          {inr(e.closingBalance)}
                        </TableCell>
                        <TableCell><RecoveryStatusBadge status={e.recoveryStatus} /></TableCell>
                        <TableCell className="text-zinc-400 text-sm max-w-[180px] truncate">
                          {e.description}
                        </TableCell>
                        {isAdminDev && (
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="w-7 h-7 text-zinc-400 hover:text-zinc-100"
                              onClick={() => setNbDialog({ open: true, editing: e })}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ── Tab: Settlement Priority ── */}
      {activeTab === "settlement" && (
        <div className="space-y-4">
          {!projectId || !partnerId ? (
            <Card className="bg-zinc-900 border-zinc-700">
              <CardContent className="py-12 text-center">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">
                  Select a project and partner to compute the advisory settlement priority waterfall.
                </p>
              </CardContent>
            </Card>
          ) : (
            <SettlementWaterfall projectId={projectId} partnerId={partnerId} />
          )}
        </div>
      )}

      {/* Record Dialog */}
      <RecordDialog
        open={recordDialog.open}
        onClose={() => { setRecordDialog({ open: false }); refetchRecords(); refetchSummary(); }}
        existing={recordDialog.editing}
        projectId={projectId}
        partnerId={partnerId}
        projectOptions={projectOptions}
        partnerOptions={partnerOptions}
      />

      {/* Negative Balance Dialog */}
      <NegativeBalanceDialog
        open={nbDialog.open}
        onClose={() => { setNbDialog({ open: false }); refetchNb(); refetchSummary(); }}
        existing={nbDialog.editing}
        projectId={projectId}
        partnerId={partnerId}
      />
    </div>
  );
}
