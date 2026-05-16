import { useState, useMemo, useEffect } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useGetLandownerAccountSummary,
  useListLandownerLedgerEntries,
  useCreateLandownerLedgerEntry,
  useUpdateLandownerLedgerEntry,
  useReverseLandownerLedgerEntry,
  useGetLandownerLcaReceivable,
  useListProjects,
  useListPartners,
  getGetLandownerAccountSummaryQueryKey,
  getListLandownerLedgerEntriesQueryKey,
  getGetLandownerLcaReceivableQueryKey,
  getListPartnersQueryKey,
} from "@workspace/api-client-react";
import type { LandownerLedgerEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Landmark,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  ArrowUpCircle,
  ArrowDownCircle,
  Scale,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Info,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 10_00_000)
    return `₹${(n / 10_00_000).toFixed(1)}L`;
  if (Math.abs(n) >= 1_00_000)
    return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (Math.abs(n) >= 1_000)
    return `₹${(n / 1_000).toFixed(0)}K`;
  return fmt(n);
}

// ── Entry type helpers ────────────────────────────────────────────────────────

const ENTRY_TYPES = [
  { value: "revenue_entitlement", label: "Revenue Entitlement", direction: "credit" as const },
  { value: "operational_burden", label: "Operational Burden", direction: "debit" as const },
  { value: "recoverable_adjustment", label: "Recoverable Adjustment", direction: null },
  { value: "lca_credit", label: "LCA Credit", direction: "credit" as const },
  { value: "other_credit", label: "Other Credit", direction: "credit" as const },
  { value: "other_debit", label: "Other Debit", direction: "debit" as const },
];

const ENTRY_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ENTRY_TYPES.map((e) => [e.value, e.label]),
);

function entryTypeBadge(type: string, direction: string) {
  const isCredit = direction === "credit";
  const map: Record<string, string> = {
    revenue_entitlement: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    operational_burden: "bg-red-500/15 text-red-400 border-red-500/30",
    recoverable_adjustment: isCredit
      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : "bg-orange-500/15 text-orange-400 border-orange-500/30",
    lca_credit: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    other_credit: "bg-teal-500/15 text-teal-400 border-teal-500/30",
    other_debit: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return map[type] ?? "bg-zinc-500/15 text-zinc-400";
}

function statusBadge(status: string) {
  const map: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
    draft: { cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30", icon: Clock, label: "Draft" },
    confirmed: { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2, label: "Confirmed" },
    disputed: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertCircle, label: "Disputed" },
    reversed: { cls: "bg-red-500/15 text-red-400 border-red-500/30", icon: XCircle, label: "Reversed" },
  };
  return map[status] ?? map.draft;
}

// ── Form state ────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  projectId: "",
  partnerId: "",
  entryType: "revenue_entitlement",
  direction: "credit",
  periodLabel: "",
  periodStart: "",
  periodEnd: "",
  description: "",
  amount: "",
  grossRevenue: "",
  ownershipPct: "",
  revenueModelType: "",
  isRecoverable: false,
  notes: "",
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function LandownerAccount() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [filterProjectId, setFilterProjectId] = useState("");
  const [filterPartnerId, setFilterPartnerId] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const [addDialog, setAddDialog] = useState(false);
  const [editTarget, setEditTarget] = useState<LandownerLedgerEntry | null>(null);
  const [reverseTarget, setReverseTarget] = useState<LandownerLedgerEntry | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Reset partner filter whenever project changes (governance isolation)
  useEffect(() => {
    setFilterPartnerId("");
  }, [filterProjectId]);

  // Queries
  const { data: projects = [] } = useListProjects({});

  // Project-scoped landowner list for the filter bar.
  // When a project is selected, only landowners linked to THAT project are shown.
  // When no project is selected, all landowners across all projects are shown.
  const filterLandownerParams = filterProjectId
    ? { projectId: filterProjectId, role: "landowner" }
    : { role: "landowner" };
  const { data: filterLandowners = [] } = useListPartners(filterLandownerParams, {
    query: {
      queryKey: getListPartnersQueryKey(filterLandownerParams),
    },
  });

  const summaryQuery = useGetLandownerAccountSummary(
    {
      projectId: filterProjectId || undefined,
      partnerId: filterPartnerId || undefined,
    },
    {
      query: {
        queryKey: getGetLandownerAccountSummaryQueryKey({
          projectId: filterProjectId || undefined,
          partnerId: filterPartnerId || undefined,
        }),
      },
    },
  );
  const summary = summaryQuery.data;

  const entriesQuery = useListLandownerLedgerEntries(
    {
      projectId: filterProjectId || undefined,
      partnerId: filterPartnerId || undefined,
    },
    {
      query: {
        queryKey: getListLandownerLedgerEntriesQueryKey({
          projectId: filterProjectId || undefined,
          partnerId: filterPartnerId || undefined,
        }),
      },
    },
  );
  const allEntries = entriesQuery.data ?? [];

  const lcaReceivableQuery = useGetLandownerLcaReceivable(
    { projectId: filterProjectId || undefined },
    {
      query: {
        queryKey: getGetLandownerLcaReceivableQueryKey({
          projectId: filterProjectId || undefined,
        }),
      },
    },
  );
  const lcaData = lcaReceivableQuery.data;

  // Mutations
  const createEntry = useCreateLandownerLedgerEntry();
  const updateEntry = useUpdateLandownerLedgerEntry();
  const reverseEntry = useReverseLandownerLedgerEntry();

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["getLandownerAccountSummary"] });
    qc.invalidateQueries({ queryKey: ["listLandownerLedgerEntries"] });
    qc.invalidateQueries({ queryKey: ["getLandownerLcaReceivable"] });
  }

  // Tab-filtered entries
  const tabEntries = useMemo(() => {
    const typeMap: Record<string, string[]> = {
      revenue: ["revenue_entitlement"],
      burden: ["operational_burden"],
      adjustments: ["recoverable_adjustment", "other_credit", "other_debit", "lca_credit"],
    };
    if (activeTab === "all") return allEntries;
    return allEntries.filter((e) => (typeMap[activeTab] ?? []).includes(e.entryType));
  }, [allEntries, activeTab]);

  // Chart data — group confirmed entries by period
  const chartData = useMemo(() => {
    const confirmed = allEntries.filter((e) => e.status === "confirmed");
    const periods = new Map<string, { label: string; revenue: number; burden: number; adj: number }>();
    for (const e of confirmed) {
      const key = e.periodLabel;
      if (!periods.has(key)) periods.set(key, { label: key, revenue: 0, burden: 0, adj: 0 });
      const p = periods.get(key)!;
      const amt = e.amount;
      if (e.entryType === "revenue_entitlement") p.revenue += amt;
      else if (e.entryType === "operational_burden") p.burden += amt;
      else if (e.direction === "credit") p.adj += amt;
      else p.adj -= amt;
    }
    return Array.from(periods.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allEntries]);

  // Form helpers
  function openAdd() {
    setForm({ ...EMPTY_FORM });
    setAddDialog(true);
  }

  function openEdit(entry: LandownerLedgerEntry) {
    setForm({
      projectId: entry.projectId,
      partnerId: entry.partnerId,
      entryType: entry.entryType,
      direction: entry.direction,
      periodLabel: entry.periodLabel,
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      description: entry.description,
      amount: String(entry.amount),
      grossRevenue: entry.grossRevenue != null ? String(entry.grossRevenue) : "",
      ownershipPct: entry.ownershipPct != null ? String(entry.ownershipPct) : "",
      revenueModelType: entry.revenueModelType ?? "",
      isRecoverable: entry.isRecoverable,
      notes: entry.notes ?? "",
    });
    setEditTarget(entry);
  }

  function setEntryType(type: string) {
    const preset = ENTRY_TYPES.find((t) => t.value === type);
    setForm((f) => ({
      ...f,
      entryType: type,
      direction: preset?.direction ?? f.direction,
    }));
  }

  async function handleCreate() {
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) return;
    try {
      await createEntry.mutateAsync({
        data: {
          projectId: form.projectId,
          partnerId: form.partnerId,
          entryType: form.entryType as never,
          direction: form.direction as "credit" | "debit",
          periodLabel: form.periodLabel,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          description: form.description,
          amount: amt,
          grossRevenue: form.grossRevenue ? parseFloat(form.grossRevenue) : undefined,
          ownershipPct: form.ownershipPct ? parseFloat(form.ownershipPct) : undefined,
          revenueModelType: form.revenueModelType || undefined,
          isRecoverable: form.isRecoverable,
          notes: form.notes || undefined,
        },
      });
      setAddDialog(false);
      invalidateAll();
    } catch {
      // mutation error shown inline
    }
  }

  async function handleUpdate() {
    if (!editTarget) return;
    const amt = parseFloat(form.amount);
    try {
      await updateEntry.mutateAsync({
        id: editTarget.id,
        data: {
          description: form.description,
          amount: !isNaN(amt) && amt > 0 ? amt : undefined,
          grossRevenue: form.grossRevenue ? parseFloat(form.grossRevenue) : undefined,
          ownershipPct: form.ownershipPct ? parseFloat(form.ownershipPct) : undefined,
          revenueModelType: form.revenueModelType || undefined,
          periodLabel: form.periodLabel,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          isRecoverable: form.isRecoverable,
          notes: form.notes || undefined,
        },
      });
      setEditTarget(null);
      invalidateAll();
    } catch {
      // mutation error shown inline
    }
  }

  async function handleConfirm(entry: LandownerLedgerEntry) {
    await updateEntry.mutateAsync({ id: entry.id, data: { status: "confirmed" } });
    invalidateAll();
  }

  async function handleReverse() {
    if (!reverseTarget) return;
    await reverseEntry.mutateAsync({ id: reverseTarget.id });
    setReverseTarget(null);
    invalidateAll();
  }

  const netPositionColor = (summary?.netPosition ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Landmark className="w-6 h-6 text-amber-400" />
            Landowner Account
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Revenue entitlement, operational burden, recoverable adjustments, and LCA receivable &mdash; separate from ownership and economic pool accounting.
          </p>
        </div>
        {isAdminOrDev && (
          <Button
            className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
            onClick={openAdd}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Entry
          </Button>
        )}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Label className="text-zinc-400 text-sm shrink-0">Project:</Label>
          <Select value={filterProjectId || "__all__"} onValueChange={(v) => setFilterProjectId(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-56 bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="__all__" className="text-zinc-200">All projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isAdminOrDev && (
          <div className="flex items-center gap-2">
            <Label className="text-zinc-400 text-sm shrink-0">Landowner:</Label>
            <Select
              value={filterPartnerId || "__all__"}
              onValueChange={(v) => setFilterPartnerId(v === "__all__" ? "" : v)}
              disabled={!!filterProjectId && filterLandowners.length === 0}
            >
              <SelectTrigger className="w-56 bg-zinc-800 border-zinc-700 text-zinc-200">
                <SelectValue placeholder={
                  filterProjectId && filterLandowners.length === 0
                    ? "No landowners linked to this project"
                    : "All landowners"
                } />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {filterProjectId && filterLandowners.length === 0 ? (
                  <div className="px-3 py-4 text-center">
                    <p className="text-xs text-zinc-500">No landowners linked to this project.</p>
                    <p className="text-xs text-zinc-600 mt-1">Add landowner ledger entries to link participants.</p>
                  </div>
                ) : (
                  <>
                    <SelectItem value="__all__" className="text-zinc-200">All landowners</SelectItem>
                    {filterLandowners.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Revenue Entitlement"
          value={summary ? fmt(summary.revenueEntitlement) : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          color="emerald"
          sub="Confirmed credits"
        />
        <KpiCard
          label="Operational Burden"
          value={summary ? fmt(summary.operationalBurden) : "—"}
          icon={<TrendingDown className="w-4 h-4" />}
          color="red"
          sub="Confirmed debits"
        />
        <KpiCard
          label="Recoverable Adj."
          value={summary ? fmt(summary.recoverableNet) : "—"}
          icon={<Scale className="w-4 h-4" />}
          color={summary && summary.recoverableNet >= 0 ? "blue" : "orange"}
          sub="Net (credit − debit)"
        />
        <KpiCard
          label="LCA Receivable"
          value={summary ? fmt(summary.lcaReceivable) : "—"}
          icon={<Receipt className="w-4 h-4" />}
          color="amber"
          sub={`${summary?.lcaEntryCount ?? 0} outstanding years`}
        />
        <KpiCard
          label="Net Position"
          value={summary ? fmt(summary.netPosition) : "—"}
          icon={<Landmark className="w-4 h-4" />}
          color={summary && summary.netPosition >= 0 ? "emerald" : "red"}
          sub="Revenue − Burden + Adj + LCA"
          large
        />
      </div>

      {/* ── Net Position Breakdown ─────────────────────────────────────── */}
      {summary && (
        <Card className="bg-zinc-800/40 border-zinc-700">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm text-zinc-400 font-medium">Net Position Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <AccountingLine label="Revenue Entitlement" amount={summary.revenueEntitlement} sign="+" color="emerald" />
              <AccountingLine label="Operational Burden" amount={summary.operationalBurden} sign="−" color="red" />
              {summary.recoverableAdjCredit > 0 && (
                <AccountingLine label="Recoverable Adj (Credit)" amount={summary.recoverableAdjCredit} sign="+" color="blue" />
              )}
              {summary.recoverableAdjDebit > 0 && (
                <AccountingLine label="Recoverable Adj (Debit)" amount={summary.recoverableAdjDebit} sign="−" color="orange" />
              )}
              {summary.otherCredit > 0 && (
                <AccountingLine label="Other Credits" amount={summary.otherCredit} sign="+" color="teal" />
              )}
              {summary.otherDebit > 0 && (
                <AccountingLine label="Other Debits" amount={summary.otherDebit} sign="−" color="red" />
              )}
              <AccountingLine label="LCA Receivable" amount={summary.lcaReceivable} sign="+" color="amber" />
              <div className="border-l border-zinc-600 pl-4 ml-2">
                <span className="text-zinc-400">Net Position </span>
                <span className={cn("font-bold text-base", netPositionColor)}>{fmt(summary.netPosition)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Revenue vs Burden Chart ────────────────────────────────────── */}
      {chartData.length > 0 && (
        <Card className="bg-zinc-800/40 border-zinc-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300 font-medium">Revenue vs Burden by Period (Confirmed entries)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={{ stroke: "#52525b" }} />
                <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={{ stroke: "#52525b" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                  labelStyle={{ color: "#e4e4e7" }}
                  formatter={(v: number, name: string) => [fmt(v), name]}
                />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                <Bar dataKey="revenue" name="Revenue Entitlement" fill="#34d399" radius={[3, 3, 0, 0]} />
                <Bar dataKey="burden" name="Operational Burden" fill="#f87171" radius={[3, 3, 0, 0]} />
                <Bar dataKey="adj" name="Net Adjustments" fill="#60a5fa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Entries Tabs ───────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-800 border border-zinc-700">
          <TabsTrigger value="all" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            All ({allEntries.filter((e) => e.status !== "reversed").length})
          </TabsTrigger>
          <TabsTrigger value="revenue" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Revenue ({allEntries.filter((e) => e.entryType === "revenue_entitlement").length})
          </TabsTrigger>
          <TabsTrigger value="burden" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Burden ({allEntries.filter((e) => e.entryType === "operational_burden").length})
          </TabsTrigger>
          <TabsTrigger value="adjustments" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            Adjustments
          </TabsTrigger>
          <TabsTrigger value="lca" className="data-[state=active]:bg-zinc-700 text-zinc-400 data-[state=active]:text-white">
            LCA Receivable ({lcaData?.outstandingCount ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* All / Revenue / Burden / Adjustments */}
        {["all", "revenue", "burden", "adjustments"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <EntryTable
              entries={activeTab === tab ? tabEntries : []}
              isAdminOrDev={isAdminOrDev}
              isAdmin={isAdmin}
              onEdit={openEdit}
              onConfirm={handleConfirm}
              onReverse={setReverseTarget}
            />
          </TabsContent>
        ))}

        {/* LCA Receivable */}
        <TabsContent value="lca">
          <LcaReceivableTable data={lcaData} loading={lcaReceivableQuery.isLoading} />
        </TabsContent>
      </Tabs>

      {/* ── Add Entry Dialog ───────────────────────────────────────────── */}
      <EntryFormDialog
        open={addDialog}
        onClose={() => setAddDialog(false)}
        title="Add Ledger Entry"
        form={form}
        setForm={setForm}
        setEntryType={setEntryType}
        projects={projects}
        onSubmit={handleCreate}
        isPending={createEntry.isPending}
        submitLabel="Create Entry"
        showProjectPartner
      />

      {/* ── Edit Entry Dialog ──────────────────────────────────────────── */}
      <EntryFormDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Entry — ${editTarget?.periodLabel ?? ""}`}
        form={form}
        setForm={setForm}
        setEntryType={setEntryType}
        projects={projects}
        onSubmit={handleUpdate}
        isPending={updateEntry.isPending}
        submitLabel="Save Changes"
        showProjectPartner={false}
      />

      {/* ── Reverse Confirm ────────────────────────────────────────────── */}
      <AlertDialog open={!!reverseTarget} onOpenChange={(o) => !o && setReverseTarget(null)}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Reverse Entry?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This will mark the entry as <strong>Reversed</strong>. It will be excluded from all summaries and net position calculations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-zinc-800 text-zinc-300 border-zinc-600">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-500 text-white"
              onClick={handleReverse}
            >
              Reverse Entry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Entry Table ───────────────────────────────────────────────────────────────

function EntryTable({
  entries,
  isAdminOrDev,
  isAdmin,
  onEdit,
  onConfirm,
  onReverse,
}: {
  entries: LandownerLedgerEntry[];
  isAdminOrDev: boolean;
  isAdmin: boolean;
  onEdit: (e: LandownerLedgerEntry) => void;
  onConfirm: (e: LandownerLedgerEntry) => void;
  onReverse: (e: LandownerLedgerEntry) => void;
}) {
  const visible = entries.filter((e) => e.status !== "reversed");

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-zinc-600">
        <Landmark className="w-8 h-8 mb-2" />
        <p className="text-sm">No entries in this category yet.</p>
        {isAdminOrDev && <p className="text-xs mt-1">Use &ldquo;Add Entry&rdquo; to create one.</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 overflow-hidden mt-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800/80">
              <TableHead className="text-zinc-400">Period</TableHead>
              <TableHead className="text-zinc-400">Type</TableHead>
              <TableHead className="text-zinc-400">Partner</TableHead>
              <TableHead className="text-zinc-400">Project</TableHead>
              <TableHead className="text-zinc-400">Description</TableHead>
              <TableHead className="text-zinc-400 text-right">Amount</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
              {isAdminOrDev && <TableHead className="text-zinc-400 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((entry) => {
              const sb = statusBadge(entry.status);
              const SIcon = sb.icon;
              const isCredit = entry.direction === "credit";
              return (
                <TableRow key={entry.id} className="border-zinc-700/50 hover:bg-zinc-800/50">
                  <TableCell className="text-zinc-300 text-sm">
                    <div>{entry.periodLabel}</div>
                    <div className="text-zinc-600 text-xs">{entry.periodStart} → {entry.periodEnd}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", entryTypeBadge(entry.entryType, entry.direction))}>
                      {ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}
                    </Badge>
                    {entry.revenueModelType && (
                      <div className="text-xs text-zinc-600 mt-0.5">{entry.revenueModelType}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-zinc-300 text-sm">{entry.partnerName ?? "—"}</TableCell>
                  <TableCell className="text-zinc-300 text-sm">{entry.projectName ?? "—"}</TableCell>
                  <TableCell className="text-zinc-400 text-sm max-w-[220px]">
                    <div className="truncate">{entry.description}</div>
                    {entry.ownershipPct != null && (
                      <div className="text-xs text-zinc-600">{entry.ownershipPct}% ownership</div>
                    )}
                    {entry.grossRevenue != null && (
                      <div className="text-xs text-zinc-600">Gross rev: {fmt(entry.grossRevenue)}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={cn("font-semibold", isCredit ? "text-emerald-400" : "text-red-400")}>
                      {isCredit ? "+" : "−"}{fmt(entry.amount)}
                    </span>
                    {entry.isRecoverable && (
                      <div className="text-xs text-blue-400 text-right">recoverable</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-xs", sb.cls)}>
                      <SIcon className="w-3 h-3 mr-1" />
                      {sb.label}
                    </Badge>
                  </TableCell>
                  {isAdminOrDev && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {entry.status === "draft" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                            onClick={() => onConfirm(entry)}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Confirm
                          </Button>
                        )}
                        {entry.status !== "reversed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-zinc-400 hover:text-zinc-300"
                            onClick={() => onEdit(entry)}
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                        )}
                        {isAdmin && entry.status !== "reversed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-red-400 hover:text-red-300"
                            onClick={() => onReverse(entry)}
                          >
                            <Trash2 className="w-3 h-3" />
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
      </div>
    </div>
  );
}

// ── LCA Receivable Table ──────────────────────────────────────────────────────

function LcaReceivableTable({ data, loading }: {
  data: { totalReceivable: number; totalPaid: number; totalDue: number; outstandingCount: number; entries: {
    id: string; projectId: string; projectName?: string; year: number; grossDue: number;
    carryForward: number; totalDue: number; amountPaid: number; balance: number; status: string;
  }[] } | undefined;
  loading: boolean;
}) {
  if (loading) return <div className="py-8 text-center text-zinc-500 text-sm">Loading LCA receivable…</div>;
  if (!data || data.entries.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-zinc-600">
        <Receipt className="w-8 h-8 mb-2" />
        <p className="text-sm">No LCA entries found for this selection.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
          <div className="text-zinc-500 text-xs mb-0.5">Total Due</div>
          <div className="text-white font-bold">{fmt(data.totalDue)}</div>
        </div>
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
          <div className="text-zinc-500 text-xs mb-0.5">Total Paid</div>
          <div className="text-emerald-400 font-bold">{fmt(data.totalPaid)}</div>
        </div>
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
          <div className="text-zinc-500 text-xs mb-0.5">Outstanding Receivable</div>
          <div className="text-amber-400 font-bold">{fmt(data.totalReceivable)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-700 bg-zinc-800/80 hover:bg-zinc-800/80">
              <TableHead className="text-zinc-400">Year</TableHead>
              <TableHead className="text-zinc-400">Project</TableHead>
              <TableHead className="text-zinc-400 text-right">Gross Due</TableHead>
              <TableHead className="text-zinc-400 text-right">Carry-Fwd</TableHead>
              <TableHead className="text-zinc-400 text-right">Total Due</TableHead>
              <TableHead className="text-zinc-400 text-right">Paid</TableHead>
              <TableHead className="text-zinc-400 text-right">Balance</TableHead>
              <TableHead className="text-zinc-400">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => {
              const outstanding = e.status !== "paid" && e.status !== "waived";
              return (
                <TableRow key={e.id} className="border-zinc-700/50 hover:bg-zinc-800/50">
                  <TableCell className="text-zinc-200 font-medium">{e.year}</TableCell>
                  <TableCell className="text-zinc-300 text-sm">{e.projectName ?? "—"}</TableCell>
                  <TableCell className="text-right text-zinc-400">{fmt(e.grossDue)}</TableCell>
                  <TableCell className="text-right">
                    {e.carryForward > 0 ? <span className="text-red-400">+{fmt(e.carryForward)}</span> : <span className="text-zinc-600">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-white font-semibold">{fmt(e.totalDue)}</TableCell>
                  <TableCell className="text-right text-emerald-400">
                    {e.amountPaid > 0 ? fmt(e.amountPaid) : <span className="text-zinc-600">—</span>}
                  </TableCell>
                  <TableCell className={cn("text-right font-medium", outstanding ? "text-amber-400" : "text-zinc-500")}>
                    {e.balance > 0 ? fmt(e.balance) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      e.status === "paid" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : e.status === "waived" ? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                        : e.status === "partial" ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                        : "bg-amber-500/15 text-amber-400 border-amber-500/30",
                    )}>
                      {e.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-zinc-600 px-1">
        LCA receivable is sourced from the LCA Ledger. Manage LCA entries from the LCA Ledger page.
      </p>
    </div>
  );
}

// ── Entry Form Dialog ─────────────────────────────────────────────────────────

function EntryFormDialog({
  open,
  onClose,
  title,
  form,
  setForm,
  setEntryType,
  projects,
  onSubmit,
  isPending,
  submitLabel,
  showProjectPartner,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  setEntryType: (t: string) => void;
  projects: { id: string; name: string }[];
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
  showProjectPartner: boolean;
}) {
  // ── Project-scoped landowner list ─────────────────────────────────────────
  // When the user picks a project in this dialog, only landowners linked to
  // THAT project appear in the partner dropdown — governance data isolation.
  const dialogLandownerParams = form.projectId
    ? { projectId: form.projectId, role: "landowner" }
    : { role: "landowner" };
  const { data: landowners = [] } = useListPartners(dialogLandownerParams, {
    query: {
      enabled: open,
      queryKey: getListPartnersQueryKey(dialogLandownerParams),
    },
  });

  // Clear partnerId when the form's project selection changes
  useEffect(() => {
    setForm((f) => ({ ...f, partnerId: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.projectId]);
  const showRevenueFields = form.entryType === "revenue_entitlement";
  const showRecoverableToggle =
    form.entryType === "operational_burden" || form.entryType === "recoverable_adjustment";
  const showDirectionPicker = form.entryType === "recoverable_adjustment";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-700 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {showProjectPartner && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Project</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Landowner Partner</Label>
                <Select
                  value={form.partnerId}
                  onValueChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
                  disabled={!!form.projectId && landowners.length === 0}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                    <SelectValue placeholder={
                      form.projectId && landowners.length === 0
                        ? "No landowners linked to this project"
                        : "Select landowner"
                    } />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {form.projectId && landowners.length === 0 ? (
                      <div className="px-3 py-3 text-center">
                        <p className="text-xs text-zinc-500">No landowners linked to this project.</p>
                        <p className="text-xs text-zinc-600 mt-0.5">Select a different project or add this landowner via the project participants first.</p>
                      </div>
                    ) : (
                      landowners.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-zinc-200">{p.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {form.projectId && landowners.length > 0 && (
                  <p className="text-[10px] text-zinc-600">
                    Showing only landowners linked to the selected project.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Entry Type</Label>
              <Select value={form.entryType} onValueChange={setEntryType}>
                <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {ENTRY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-zinc-200">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showDirectionPicker ? (
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Direction</Label>
                <Select value={form.direction} onValueChange={(v) => setForm((f) => ({ ...f, direction: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="credit" className="text-emerald-400">Credit (+)</SelectItem>
                    <SelectItem value="debit" className="text-red-400">Debit (−)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Direction</Label>
                <div className={cn(
                  "h-9 flex items-center px-3 rounded-md border text-sm font-medium",
                  form.direction === "credit"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400",
                )}>
                  {form.direction === "credit" ? "Credit (+)" : "Debit (−)"}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Period Label</Label>
            <Input
              value={form.periodLabel}
              onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))}
              placeholder='e.g. "FY 2024-25 Q1" or "2024-03"'
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Period Start</Label>
              <Input
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Period End</Label>
              <Input
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of this entry"
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Amount (₹)</Label>
            <Input
              type="number"
              min={0.01}
              step={1000}
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="Always enter as a positive number"
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>

          {showRevenueFields && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Gross Revenue (₹)</Label>
                <Input
                  type="number"
                  value={form.grossRevenue}
                  onChange={(e) => setForm((f) => ({ ...f, grossRevenue: e.target.value }))}
                  placeholder="Optional"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Ownership %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={form.ownershipPct}
                  onChange={(e) => setForm((f) => ({ ...f, ownershipPct: e.target.value }))}
                  placeholder="e.g. 25"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Revenue Model</Label>
                <Select
                  value={form.revenueModelType || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, revenueModelType: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="__none__" className="text-zinc-400">Not specified</SelectItem>
                    <SelectItem value="contribution" className="text-zinc-200">Contribution model</SelectItem>
                    <SelectItem value="fifty_percent_revenue" className="text-zinc-200">50% revenue model</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {showRecoverableToggle && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isRecoverable"
                checked={form.isRecoverable}
                onChange={(e) => setForm((f) => ({ ...f, isRecoverable: e.target.checked }))}
                className="rounded border-zinc-600"
              />
              <Label htmlFor="isRecoverable" className="text-zinc-300 text-sm cursor-pointer">
                Mark as recoverable (can be netted against future revenue)
              </Label>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-sm">Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
              className="bg-zinc-800 border-zinc-600 text-zinc-200"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-zinc-400" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
            onClick={onSubmit}
            disabled={isPending}
          >
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function KpiCard({ label, value, icon, color, sub, large }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: "emerald" | "red" | "amber" | "blue" | "orange" | "teal";
  sub?: string;
  large?: boolean;
}) {
  const colorMap = {
    emerald: "text-emerald-400",
    red: "text-red-400",
    amber: "text-amber-400",
    blue: "text-blue-400",
    orange: "text-orange-400",
    teal: "text-teal-400",
  };
  return (
    <Card className={cn("border-zinc-700", large ? "bg-zinc-800/80" : "bg-zinc-800/50")}>
      <CardContent className="p-3">
        <div className={cn("flex items-center gap-1.5 mb-1 text-xs", colorMap[color])}>
          {icon}{label}
        </div>
        <div className={cn("font-bold text-white truncate", large ? "text-xl" : "text-base")}>{value}</div>
        {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AccountingLine({ label, amount, sign, color }: {
  label: string;
  amount: number;
  sign: "+" | "−";
  color: "emerald" | "red" | "blue" | "orange" | "amber" | "teal";
}) {
  if (amount === 0) return null;
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    red: "text-red-400",
    blue: "text-blue-400",
    orange: "text-orange-400",
    amber: "text-amber-400",
    teal: "text-teal-400",
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-zinc-500">{label}:</span>
      <span className={cn("font-medium", colorMap[color])}>{sign}{fmt(amount)}</span>
    </div>
  );
}
