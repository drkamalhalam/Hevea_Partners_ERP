import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import {
  useListLcaConfigs,
  useCreateLcaConfig,
  useUpdateLcaConfig,
  useDeactivateLcaConfig,
  useGetLcaSchedule,
  useListLcaLedger,
  useCreateLcaLedgerEntry,
  useUpdateLcaLedgerEntry,
  useGetLcaSummary,
  useListProjects,
  useListAgreements,
  getListLcaConfigsQueryKey,
  getListLcaLedgerQueryKey,
  getGetLcaSummaryQueryKey,
  getGetLcaScheduleQueryKey,
} from "@workspace/api-client-react";
import type {
  LcaConfig,
  LcaLedgerEntry,
  LcaScheduleEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Settings,
  Plus,
  TrendingUp,
  Calculator,
  IndianRupee,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  Clock,
  Minus,
  Pencil,
  Trash2,
  ChevronRight,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Formatters ────────────────────────────────────────────────────────────────

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    partial: { label: "Partial", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    paid: { label: "Paid", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    waived: { label: "Waived", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  };
  const s = map[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LCAConfig() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const qc = useQueryClient();

  const isAdminOrDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [activeTab, setActiveTab] = useState("overview");
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: configs = [], isLoading: loadingConfigs } = useListLcaConfigs(
    selectedProjectId ? { projectId: selectedProjectId } : {},
  );

  const { data: summary, isLoading: loadingSummary } = useGetLcaSummary(
    selectedProjectId ? { projectId: selectedProjectId } : {},
  );

  const { data: projects = [] } = useListProjects();
  const { data: agreements = [] } = useListAgreements();

  const { data: ledgerEntries = [], isLoading: loadingLedger } = useListLcaLedger(
    selectedProjectId ? { projectId: selectedProjectId } : {},
  );

  const { data: schedule } = useGetLcaSchedule(
    selectedConfigId ?? "",
    { years: 15 },
    {
      query: {
        enabled: !!selectedConfigId,
        queryKey: getGetLcaScheduleQueryKey(selectedConfigId ?? "", { years: 15 }),
      },
    },
  );

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createConfig = useCreateLcaConfig();
  const updateConfig = useUpdateLcaConfig();
  const deactivateConfig = useDeactivateLcaConfig();
  const createEntry = useCreateLcaLedgerEntry();
  const updateEntry = useUpdateLcaLedgerEntry();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getListLcaConfigsQueryKey() });
    qc.invalidateQueries({ queryKey: getListLcaLedgerQueryKey() });
    qc.invalidateQueries({ queryKey: getGetLcaSummaryQueryKey() });
  };

  // ── Config Dialog ────────────────────────────────────────────────────────────

  const [configDialog, setConfigDialog] = useState<{
    open: boolean;
    mode: "create" | "edit";
    config?: LcaConfig;
  }>({ open: false, mode: "create" });

  const [configForm, setConfigForm] = useState({
    projectId: selectedProjectId ?? "",
    agreementId: "",
    baseAmount: "",
    escalationPct: "5",
    effectiveStartDate: `${CURRENT_YEAR}-01-01`,
    notes: "",
  });

  function openCreateConfig() {
    setConfigForm({
      projectId: selectedProjectId ?? "",
      agreementId: "",
      baseAmount: "",
      escalationPct: "5",
      effectiveStartDate: `${CURRENT_YEAR}-01-01`,
      notes: "",
    });
    setConfigDialog({ open: true, mode: "create" });
  }

  function openEditConfig(cfg: LcaConfig) {
    setConfigForm({
      projectId: cfg.projectId,
      agreementId: cfg.agreementId ?? "",
      baseAmount: String(cfg.baseAmount),
      escalationPct: String(cfg.escalationPct),
      effectiveStartDate: cfg.effectiveStartDate,
      notes: cfg.notes ?? "",
    });
    setConfigDialog({ open: true, mode: "edit", config: cfg });
  }

  async function handleSaveConfig() {
    const base = parseFloat(configForm.baseAmount);
    const esc = parseFloat(configForm.escalationPct);
    if (isNaN(base) || base <= 0) return;

    try {
      if (configDialog.mode === "create") {
        await createConfig.mutateAsync({
          data: {
            projectId: configForm.projectId,
            agreementId: configForm.agreementId || undefined,
            baseAmount: base,
            escalationPct: isNaN(esc) ? 0 : esc,
            effectiveStartDate: configForm.effectiveStartDate,
            notes: configForm.notes || undefined,
          },
        });
      } else if (configDialog.config) {
        await updateConfig.mutateAsync({
          id: configDialog.config.id,
          data: {
            baseAmount: base,
            escalationPct: isNaN(esc) ? 0 : esc,
            agreementId: configForm.agreementId || undefined,
            notes: configForm.notes || undefined,
          },
        });
      }
      setConfigDialog({ open: false, mode: "create" });
      invalidateAll();
    } catch {
      // error visible via mutation state
    }
  }

  // ── Ledger Dialog ────────────────────────────────────────────────────────────

  const [ledgerDialog, setLedgerDialog] = useState<{
    open: boolean;
    mode: "create" | "payment";
    entry?: LcaLedgerEntry;
    scheduleRow?: LcaScheduleEntry & { year: number };
  }>({ open: false, mode: "create" });

  const [ledgerForm, setLedgerForm] = useState({
    configId: "",
    year: String(CURRENT_YEAR),
    amountPaid: "",
    notes: "",
  });

  const [paymentForm, setPaymentForm] = useState({
    amountPaid: "",
    status: "paid" as "pending" | "partial" | "paid" | "waived",
    notes: "",
  });

  function openCreateEntry(cfg: LcaConfig) {
    setLedgerForm({
      configId: cfg.id,
      year: String(CURRENT_YEAR),
      amountPaid: "",
      notes: "",
    });
    setLedgerDialog({ open: true, mode: "create" });
  }

  function openPaymentDialog(entry: LcaLedgerEntry) {
    setPaymentForm({
      amountPaid: String(entry.amountPaid),
      status: entry.status as "pending" | "partial" | "paid" | "waived",
      notes: entry.notes ?? "",
    });
    setLedgerDialog({ open: true, mode: "payment", entry });
  }

  async function handleSaveEntry() {
    const paid = parseFloat(ledgerForm.amountPaid);
    try {
      await createEntry.mutateAsync({
        data: {
          configId: ledgerForm.configId,
          year: parseInt(ledgerForm.year),
          amountPaid: isNaN(paid) ? 0 : paid,
          notes: ledgerForm.notes || undefined,
        },
      });
      setLedgerDialog({ open: false, mode: "create" });
      invalidateAll();
    } catch {
      // error visible via mutation state
    }
  }

  async function handleUpdatePayment() {
    if (!ledgerDialog.entry) return;
    const paid = parseFloat(paymentForm.amountPaid);
    try {
      await updateEntry.mutateAsync({
        id: ledgerDialog.entry.id,
        data: {
          amountPaid: isNaN(paid) ? undefined : paid,
          status: paymentForm.status,
          notes: paymentForm.notes || undefined,
        },
      });
      setLedgerDialog({ open: false, mode: "create" });
      invalidateAll();
    } catch {
      // error visible via mutation state
    }
  }

  // ── Eligible projects (mature_production only) ───────────────────────────────

  const matureProjects = useMemo(
    () => projects.filter((p) => p.lifecycleStatus === "mature_production" && p.isActive),
    [projects],
  );

  const contributionAgreements = useMemo(
    () => agreements.filter((a) => a.revenueModel === "contribution" && a.status !== "terminated"),
    [agreements],
  );

  const filteredAgreements = useMemo(
    () =>
      configForm.projectId
        ? contributionAgreements.filter((a) => a.projectId === configForm.projectId)
        : contributionAgreements,
    [contributionAgreements, configForm.projectId],
  );

  const selectedConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? configs[0] ?? null,
    [configs, selectedConfigId],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <IndianRupee className="w-6 h-6 text-amber-400" />
            Land Contribution Adjustment
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Annual LCA configuration, escalation settings, and payment ledger.
            Applies to contribution-model agreements after maturity only.
          </p>
        </div>
        {isAdminOrDev && (
          <Button
            onClick={openCreateConfig}
            className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
          >
            <Plus className="w-4 h-4 mr-1" />
            New LCA Config
          </Button>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-300">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          LCA is a recurring annual project cost separate from ownership contributions and profit
          distribution. It applies only to projects in the{" "}
          <strong>Mature Production</strong> phase with a <strong>contribution-model</strong>{" "}
          agreement. Unpaid LCA carries forward without additional escalation.
        </span>
      </div>

      {/* 50% revenue model guard */}
      {(() => {
        const selProject = selectedProjectId
          ? projects.find((p) => p.id === selectedProjectId)
          : null;
        if (!selProject || selProject.commercialModel !== "fifty_percent_revenue") return null;
        return (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-red-400" />
            <div>
              <p className="font-semibold text-red-300 mb-1">LCA Does Not Apply to This Project</p>
              <p>
                <strong>{selProject.name}</strong> operates under the{" "}
                <strong>50% Revenue Share</strong> model. This model has no land notional value,
                no ownership equity, and no LCA obligation. All LCA configurations and ledger
                entries shown here belong to contribution-model projects only.
              </p>
              <p className="mt-1 text-red-400/80 text-xs">
                To record post-maturity costs for this project, use the{" "}
                <strong>Post-Maturity Payments</strong> ledger instead.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard label="Active Configs" value={summary.configCount} icon={<Settings className="w-4 h-4" />} />
          <KpiCard label="Total Due" value={formatINR(summary.totalDue)} icon={<IndianRupee className="w-4 h-4" />} amber />
          <KpiCard label="Total Paid" value={formatINR(summary.totalPaid)} icon={<CheckCircle2 className="w-4 h-4" />} green />
          <KpiCard label="Outstanding" value={formatINR(summary.totalBalance)} icon={<AlertCircle className="w-4 h-4" />} red={summary.totalBalance > 0} />
          <KpiCard label="Carry-Forward" value={formatINR(summary.totalCarryForward)} icon={<ChevronRight className="w-4 h-4" />} />
          <KpiCard label="Pending / Partial" value={`${summary.pendingCount + summary.partialCount} entries`} icon={<Clock className="w-4 h-4" />} />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-800 border border-zinc-700">
          <TabsTrigger value="overview">Configurations</TabsTrigger>
          <TabsTrigger value="schedule">Payment Schedule</TabsTrigger>
          <TabsTrigger value="ledger">Payment Ledger</TabsTrigger>
        </TabsList>

        {/* ── Configurations Tab ─────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {loadingConfigs ? (
            <div className="text-zinc-500 text-sm py-8 text-center">Loading configurations…</div>
          ) : configs.length === 0 ? (
            <EmptyState
              title="No LCA configurations"
              description={
                isAdminOrDev
                  ? "Create an LCA configuration for a mature-production project."
                  : "No LCA configurations exist for your accessible projects."
              }
              action={isAdminOrDev ? <Button onClick={openCreateConfig} size="sm" className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"><Plus className="w-3 h-3 mr-1" />New Config</Button> : undefined}
            />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {configs.map((cfg) => (
                <ConfigCard
                  key={cfg.id}
                  config={cfg}
                  isAdmin={isAdmin}
                  isAdminOrDev={isAdminOrDev}
                  onEdit={() => openEditConfig(cfg)}
                  onDeactivate={async () => {
                    if (!confirm("Deactivate this LCA configuration? Ledger entries will be preserved.")) return;
                    await deactivateConfig.mutateAsync({ id: cfg.id });
                    invalidateAll();
                  }}
                  onAddEntry={() => openCreateEntry(cfg)}
                  onViewSchedule={() => {
                    setSelectedConfigId(cfg.id);
                    setActiveTab("schedule");
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Schedule Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="schedule" className="space-y-4 mt-4">
          {configs.length === 0 ? (
            <EmptyState title="No configurations" description="Create an LCA configuration to view the payment schedule." />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Label className="text-zinc-400 text-sm">Config:</Label>
                <Select
                  value={selectedConfigId ?? selectedConfig?.id ?? ""}
                  onValueChange={setSelectedConfigId}
                >
                  <SelectTrigger className="w-72 bg-zinc-800 border-zinc-700 text-zinc-200">
                    <SelectValue placeholder="Select configuration" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {configs.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-zinc-200">
                        {c.projectName ?? c.projectId} — Base {formatINR(c.baseAmount)} @ {c.escalationPct}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {schedule ? (
                <div className="rounded-lg border border-zinc-700 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-700 bg-zinc-800/60">
                        <TableHead className="text-zinc-400">Year</TableHead>
                        <TableHead className="text-zinc-400 text-right">Gross Due</TableHead>
                        <TableHead className="text-zinc-400 text-right">Carry-Forward</TableHead>
                        <TableHead className="text-zinc-400 text-right">Total Due</TableHead>
                        <TableHead className="text-zinc-400 text-right">Paid</TableHead>
                        <TableHead className="text-zinc-400 text-right">Balance</TableHead>
                        <TableHead className="text-zinc-400">Status</TableHead>
                        {isAdminOrDev && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {schedule.schedule.map((row) => {
                        const isCurrent = row.year === CURRENT_YEAR;
                        return (
                          <TableRow
                            key={row.year}
                            className={cn(
                              "border-zinc-700/50 hover:bg-zinc-800/40",
                              isCurrent && "bg-amber-500/5 border-l-2 border-l-amber-500",
                            )}
                          >
                            <TableCell className="text-zinc-200 font-medium">
                              {row.year}
                              {isCurrent && <span className="ml-2 text-xs text-amber-400 font-normal">current</span>}
                            </TableCell>
                            <TableCell className="text-right text-zinc-300">{formatINR(row.grossDue)}</TableCell>
                            <TableCell className="text-right text-zinc-400">
                              {row.carryForward > 0 ? (
                                <span className="text-red-400">+{formatINR(row.carryForward)}</span>
                              ) : (
                                <span className="text-zinc-600">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-zinc-200 font-medium">{formatINR(row.totalDue)}</TableCell>
                            <TableCell className="text-right text-emerald-400">{row.amountPaid > 0 ? formatINR(row.amountPaid) : <span className="text-zinc-600">—</span>}</TableCell>
                            <TableCell className={cn("text-right font-medium", row.balance > 0 ? "text-red-400" : "text-emerald-400")}>
                              {row.balance > 0 ? formatINR(row.balance) : <span className="text-zinc-500">—</span>}
                            </TableCell>
                            <TableCell>{statusBadge(row.status)}</TableCell>
                            {isAdminOrDev && (
                              <TableCell>
                                {!row.hasLedgerEntry && selectedConfig ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-xs text-amber-400 hover:text-amber-300 h-7 px-2"
                                    onClick={() => {
                                      setLedgerForm({
                                        configId: selectedConfig.id,
                                        year: String(row.year),
                                        amountPaid: "",
                                        notes: "",
                                      });
                                      setLedgerDialog({ open: true, mode: "create" });
                                    }}
                                  >
                                    Record
                                  </Button>
                                ) : row.ledgerEntryId ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-xs text-blue-400 hover:text-blue-300 h-7 px-2"
                                    onClick={() => {
                                      const entry = ledgerEntries.find((e) => e.id === row.ledgerEntryId);
                                      if (entry) openPaymentDialog(entry);
                                    }}
                                  >
                                    Update
                                  </Button>
                                ) : null}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-zinc-500 text-sm py-8 text-center">Select a configuration to view the payment schedule.</div>
              )}

              {selectedConfig && (
                <div className="text-xs text-zinc-500 flex items-center gap-1 mt-1">
                  <Info className="w-3 h-3" />
                  Escalation: {selectedConfig.escalationPct}% per annum compounded. Carried-forward unpaid balances do not attract additional escalation.
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Ledger Tab ────────────────────────────────────────────────────── */}
        <TabsContent value="ledger" className="space-y-4 mt-4">
          {loadingLedger ? (
            <div className="text-zinc-500 text-sm py-8 text-center">Loading ledger…</div>
          ) : ledgerEntries.length === 0 ? (
            <EmptyState
              title="No ledger entries"
              description="Ledger entries are created when you record a yearly LCA payment."
            />
          ) : (
            <div className="rounded-lg border border-zinc-700 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-700 bg-zinc-800/60">
                    <TableHead className="text-zinc-400">Project</TableHead>
                    <TableHead className="text-zinc-400">Year</TableHead>
                    <TableHead className="text-zinc-400 text-right">Total Due</TableHead>
                    <TableHead className="text-zinc-400 text-right">Carry-Fwd</TableHead>
                    <TableHead className="text-zinc-400 text-right">Paid</TableHead>
                    <TableHead className="text-zinc-400 text-right">Balance</TableHead>
                    <TableHead className="text-zinc-400">Status</TableHead>
                    <TableHead className="text-zinc-400">Paid Date</TableHead>
                    {isAdminOrDev && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledgerEntries.map((entry) => (
                    <TableRow key={entry.id} className="border-zinc-700/50 hover:bg-zinc-800/40">
                      <TableCell className="text-zinc-300 text-sm">{entry.projectName ?? entry.projectId.slice(0, 8)}</TableCell>
                      <TableCell className="text-zinc-200 font-medium">{entry.year}</TableCell>
                      <TableCell className="text-right text-zinc-200">{formatINR(entry.totalDue)}</TableCell>
                      <TableCell className="text-right">
                        {entry.carryForward > 0 ? (
                          <span className="text-red-400 text-sm">{formatINR(entry.carryForward)}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-emerald-400">{entry.amountPaid > 0 ? formatINR(entry.amountPaid) : <span className="text-zinc-600">—</span>}</TableCell>
                      <TableCell className={cn("text-right font-medium", entry.balance > 0 ? "text-red-400" : "text-zinc-500")}>
                        {entry.balance > 0 ? formatINR(entry.balance) : "—"}
                      </TableCell>
                      <TableCell>{statusBadge(entry.status)}</TableCell>
                      <TableCell className="text-zinc-400 text-sm">{entry.paidAt ?? "—"}</TableCell>
                      {isAdminOrDev && (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-blue-400 hover:text-blue-300 h-7 px-2"
                            onClick={() => openPaymentDialog(entry)}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            Update
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Config Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={configDialog.open} onOpenChange={(o) => setConfigDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {configDialog.mode === "create" ? "New LCA Configuration" : "Edit LCA Configuration"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {configDialog.mode === "create" && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Project <span className="text-zinc-500">(mature production only)</span></Label>
                <Select
                  value={configForm.projectId}
                  onValueChange={(v) => setConfigForm((f) => ({ ...f, projectId: v, agreementId: "" }))}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {matureProjects.length === 0 ? (
                      <SelectItem value="__none__" disabled className="text-zinc-500">
                        No mature-production projects
                      </SelectItem>
                    ) : (
                      matureProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                          {p.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {matureProjects.length === 0 && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    LCA requires at least one project in Mature Production phase.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Linked Agreement <span className="text-zinc-500">(contribution model)</span></Label>
              <Select
                value={configForm.agreementId}
                onValueChange={(v) => setConfigForm((f) => ({ ...f, agreementId: v }))}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                  <SelectValue placeholder="Select agreement (optional)" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value="none" className="text-zinc-400">None</SelectItem>
                  {filteredAgreements.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-zinc-200">
                      {a.id.slice(0, 8)}… — {a.revenueModel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Base Annual Amount (₹)</Label>
                <Input
                  type="number"
                  min={1}
                  step={1000}
                  value={configForm.baseAmount}
                  onChange={(e) => setConfigForm((f) => ({ ...f, baseAmount: e.target.value }))}
                  placeholder="e.g. 50000"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Escalation % / Year</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={configForm.escalationPct}
                  onChange={(e) => setConfigForm((f) => ({ ...f, escalationPct: e.target.value }))}
                  placeholder="e.g. 5"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Effective Start Date</Label>
              <Input
                type="date"
                value={configForm.effectiveStartDate}
                onChange={(e) => setConfigForm((f) => ({ ...f, effectiveStartDate: e.target.value }))}
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Notes</Label>
              <Input
                value={configForm.notes}
                onChange={(e) => setConfigForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>

            {/* Preview */}
            {configForm.baseAmount && !isNaN(parseFloat(configForm.baseAmount)) && (
              <div className="rounded-md bg-zinc-800/60 border border-zinc-700 p-3 text-xs text-zinc-400 space-y-1">
                <div className="font-medium text-zinc-300">Escalation Preview</div>
                {[0, 1, 2, 4, 9].map((n) => {
                  const base = parseFloat(configForm.baseAmount);
                  const esc = parseFloat(configForm.escalationPct) || 0;
                  const amount = base * Math.pow(1 + esc / 100, n);
                  const year = new Date(configForm.effectiveStartDate).getFullYear() + n;
                  return (
                    <div key={n} className="flex justify-between">
                      <span>Year {year} (Y+{n})</span>
                      <span className="text-zinc-300">{formatINR(amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-zinc-400" onClick={() => setConfigDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
              onClick={handleSaveConfig}
              disabled={createConfig.isPending || updateConfig.isPending || !configForm.projectId || !configForm.baseAmount}
            >
              {createConfig.isPending || updateConfig.isPending ? "Saving…" : "Save Configuration"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Ledger Entry Dialog ────────────────────────────────────────────── */}
      <Dialog open={ledgerDialog.open && ledgerDialog.mode === "create"} onOpenChange={(o) => !o && setLedgerDialog((d) => ({ ...d, open: false }))}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Record LCA Year Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Year</Label>
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  value={ledgerForm.year}
                  onChange={(e) => setLedgerForm((f) => ({ ...f, year: e.target.value }))}
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Amount Paid (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  value={ledgerForm.amountPaid}
                  onChange={(e) => setLedgerForm((f) => ({ ...f, amountPaid: e.target.value }))}
                  placeholder="0"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Notes</Label>
              <Input
                value={ledgerForm.notes}
                onChange={(e) => setLedgerForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
                className="bg-zinc-800 border-zinc-600 text-zinc-200"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="text-zinc-400" onClick={() => setLedgerDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
              onClick={handleSaveEntry}
              disabled={createEntry.isPending}
            >
              {createEntry.isPending ? "Saving…" : "Record Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Payment Update Dialog ──────────────────────────────────────────── */}
      <Dialog open={ledgerDialog.open && ledgerDialog.mode === "payment"} onOpenChange={(o) => !o && setLedgerDialog((d) => ({ ...d, open: false }))}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Update Payment — {ledgerDialog.entry?.year}</DialogTitle>
          </DialogHeader>
          {ledgerDialog.entry && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-zinc-800/50 border border-zinc-700 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Total Due</span>
                  <span className="text-zinc-200 font-medium">{formatINR(ledgerDialog.entry.totalDue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Carry-Forward</span>
                  <span className="text-zinc-300">{ledgerDialog.entry.carryForward > 0 ? formatINR(ledgerDialog.entry.carryForward) : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Current Balance</span>
                  <span className={ledgerDialog.entry.balance > 0 ? "text-red-400 font-medium" : "text-emerald-400"}>
                    {formatINR(ledgerDialog.entry.balance)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-zinc-300 text-sm">Amount Paid (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    value={paymentForm.amountPaid}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, amountPaid: e.target.value }))}
                    className="bg-zinc-800 border-zinc-600 text-zinc-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-300 text-sm">Status Override</Label>
                  <Select
                    value={paymentForm.status}
                    onValueChange={(v) => setPaymentForm((f) => ({ ...f, status: v as typeof f.status }))}
                  >
                    <SelectTrigger className="bg-zinc-800 border-zinc-600 text-zinc-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="pending" className="text-zinc-200">Pending</SelectItem>
                      <SelectItem value="partial" className="text-zinc-200">Partial</SelectItem>
                      <SelectItem value="paid" className="text-zinc-200">Paid</SelectItem>
                      <SelectItem value="waived" className="text-zinc-200">Waived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Notes</Label>
                <Input
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                  className="bg-zinc-800 border-zinc-600 text-zinc-200"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" className="text-zinc-400" onClick={() => setLedgerDialog((d) => ({ ...d, open: false }))}>
              Cancel
            </Button>
            <Button
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold"
              onClick={handleUpdatePayment}
              disabled={updateEntry.isPending}
            >
              {updateEntry.isPending ? "Saving…" : "Update Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  amber,
  green,
  red,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  amber?: boolean;
  green?: boolean;
  red?: boolean;
}) {
  return (
    <Card className="bg-zinc-800/60 border-zinc-700">
      <CardContent className="p-3">
        <div className={cn("flex items-center gap-1.5 mb-1", amber ? "text-amber-400" : green ? "text-emerald-400" : red ? "text-red-400" : "text-zinc-400")}>
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <div className="text-lg font-bold text-white truncate">{value}</div>
      </CardContent>
    </Card>
  );
}

function ConfigCard({
  config,
  isAdmin,
  isAdminOrDev,
  onEdit,
  onDeactivate,
  onAddEntry,
  onViewSchedule,
}: {
  config: LcaConfig;
  isAdmin: boolean;
  isAdminOrDev: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
  onAddEntry: () => void;
  onViewSchedule: () => void;
}) {
  const startYear = config.startYear;
  const currentOffset = CURRENT_YEAR - startYear;
  const currentGross =
    currentOffset >= 0
      ? config.baseAmount * Math.pow(1 + config.escalationPct / 100, currentOffset)
      : config.baseAmount;

  return (
    <Card className="bg-zinc-800/60 border-zinc-700">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-white text-base">{config.projectName ?? config.projectId.slice(0, 8)}</CardTitle>
            <CardDescription className="text-zinc-500 text-xs mt-0.5">
              Effective: {config.effectiveStartDate} · Start year: {startYear}
            </CardDescription>
          </div>
          <Badge variant="outline" className={config.isActive ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-zinc-600 text-zinc-500"}>
            {config.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-zinc-500 text-xs">Base Amount</div>
            <div className="text-zinc-200 font-medium">{formatINR(config.baseAmount)}</div>
          </div>
          <div>
            <div className="text-zinc-500 text-xs">Escalation</div>
            <div className="text-zinc-200 font-medium">{config.escalationPct}% p.a.</div>
          </div>
          <div>
            <div className="text-zinc-500 text-xs">
              {CURRENT_YEAR} Due
            </div>
            <div className="text-amber-400 font-medium">{formatINR(currentGross)}</div>
          </div>
        </div>
        {config.notes && (
          <p className="text-xs text-zinc-500 italic">{config.notes}</p>
        )}
        {isAdminOrDev && (
          <div className="flex items-center gap-1.5 pt-1 flex-wrap">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-zinc-300 hover:text-white" onClick={onViewSchedule}>
              <Calculator className="w-3 h-3 mr-1" />
              Schedule
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300" onClick={onAddEntry}>
              <Plus className="w-3 h-3 mr-1" />
              Record Year
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-blue-400 hover:text-blue-300" onClick={onEdit}>
              <Pencil className="w-3 h-3 mr-1" />
              Edit
            </Button>
            {isAdmin && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-400 hover:text-red-300" onClick={onDeactivate}>
                <Trash2 className="w-3 h-3 mr-1" />
                Deactivate
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
      <IndianRupee className="w-10 h-10 text-zinc-700" />
      <div>
        <p className="text-zinc-400 font-medium">{title}</p>
        <p className="text-zinc-600 text-sm mt-1 max-w-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
