import { useState, useMemo } from "react";
import {
  useListGovernanceOverrides,
  useGetGovernanceOverrideAnalytics,
  useAddGovernanceOverride,
  useListProjects,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import {
  GitCompare,
  Plus,
  Filter,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Scale,
  Shield,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { useRole } from "@/contexts/RoleContext";

// ── Label maps ───────────────────────────────────────────────────────────────

const OVERRIDE_TYPE_LABELS: Record<string, string> = {
  settlement_distribution: "Settlement Override",
  settlement_finalized: "Settlement Finalized",
  settlement_reopened: "Settlement Reopened",
  contribution_dispute_resolved: "Dispute Resolved",
  contribution_dispute_rejected: "Dispute Rejected",
  lca_ledger_adjustment: "LCA Adjustment",
  transfer_price_override: "Transfer Price Override",
  ownership_transfer: "Ownership Transfer",
  expenditure_approved: "Expenditure Approved",
  expenditure_rejected: "Expenditure Rejected",
  governance_manual_note: "Manual Note",
};

const MODULE_LABELS: Record<string, string> = {
  settlement: "Settlement",
  contributions: "Contributions",
  expenditures: "Expenditures",
  lca: "LCA",
  ownership: "Ownership",
  valuations: "Valuations",
  governance: "Governance",
};

const MODULE_COLORS: Record<string, string> = {
  settlement: "#f59e0b",
  contributions: "#3b82f6",
  expenditures: "#ef4444",
  lca: "#8b5cf6",
  ownership: "#10b981",
  valuations: "#f97316",
  governance: "#6366f1",
};

function overrideTypeBadgeClass(type: string): string {
  if (type.includes("reopened") || type.includes("rejected")) return "bg-red-900/60 text-red-300 border-red-700";
  if (type.includes("finalized") || type.includes("resolved")) return "bg-emerald-900/60 text-emerald-300 border-emerald-700";
  if (type.includes("override") || type.includes("adjustment")) return "bg-amber-900/60 text-amber-300 border-amber-700";
  if (type.includes("note")) return "bg-slate-700 text-slate-300 border-slate-600";
  return "bg-slate-700 text-slate-300 border-slate-600";
}

function overrideTypeIcon(type: string) {
  if (type.includes("reopened")) return <RotateCcw className="h-3 w-3" />;
  if (type.includes("rejected")) return <AlertTriangle className="h-3 w-3" />;
  if (type.includes("finalized") || type.includes("resolved")) return <CheckCircle2 className="h-3 w-3" />;
  if (type.includes("override") || type.includes("adjustment")) return <GitCompare className="h-3 w-3" />;
  if (type.includes("transfer")) return <Scale className="h-3 w-3" />;
  return <Shield className="h-3 w-3" />;
}

// ── JSON value pretty-printer ────────────────────────────────────────────────

function ValuePanel({
  label,
  value,
  accent,
}: {
  label: string;
  value: Record<string, unknown> | null | undefined;
  accent: "blue" | "amber";
}) {
  const borderClass = accent === "blue" ? "border-blue-700" : "border-amber-700";
  const labelClass = accent === "blue" ? "text-blue-400" : "text-amber-400";

  return (
    <div className={`rounded-lg border ${borderClass} bg-slate-900/60 p-4 flex-1 min-w-0`}>
      <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${labelClass}`}>{label}</p>
      {value ? (
        <div className="space-y-1.5">
          {Object.entries(value).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 text-xs">
              <span className="text-slate-400 shrink-0 capitalize">{k.replace(/_/g, " ")}</span>
              <span className="text-slate-200 text-right font-mono break-all">
                {v === null || v === undefined ? (
                  <span className="text-slate-600 italic">null</span>
                ) : typeof v === "object" ? (
                  <span className="text-slate-400 italic">{JSON.stringify(v)}</span>
                ) : (
                  String(v)
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-slate-600 text-xs italic">No data recorded</p>
      )}
    </div>
  );
}

// ── Comparison dialog ────────────────────────────────────────────────────────

type OverrideRecord = {
  id: string;
  projectId?: string;
  projectName?: string | null;
  overrideType?: string;
  module?: string;
  title?: string;
  description?: string | null;
  originalValue?: Record<string, unknown> | null;
  finalValue?: Record<string, unknown> | null;
  overrideReason?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  supportingDocuments?: Array<Record<string, unknown>> | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  createdAt?: string;
};

function ComparisonDialog({
  record,
  onClose,
}: {
  record: OverrideRecord;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <GitCompare className="h-5 w-5 text-indigo-400" />
            Override Comparison
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Summary */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 space-y-2">
            <p className="text-sm font-medium text-slate-100">{record.title}</p>
            {record.description && <p className="text-xs text-slate-400">{record.description}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge className={`text-xs border ${overrideTypeBadgeClass(record.overrideType ?? "")} gap-1`}>
                {overrideTypeIcon(record.overrideType ?? "")}
                {OVERRIDE_TYPE_LABELS[record.overrideType ?? ""] ?? record.overrideType}
              </Badge>
              {record.module && (
                <Badge className="text-xs border border-slate-600 bg-slate-700 text-slate-300">
                  {MODULE_LABELS[record.module] ?? record.module}
                </Badge>
              )}
              {record.projectName && (
                <Badge className="text-xs border border-slate-600 bg-slate-700 text-slate-300">
                  {record.projectName}
                </Badge>
              )}
            </div>
          </div>

          {/* Side-by-side comparison */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Value Comparison</p>
            <div className="flex gap-3">
              <ValuePanel label="Original / Before" value={record.originalValue} accent="blue" />
              <ValuePanel label="Final / After" value={record.finalValue} accent="amber" />
            </div>
          </div>

          {/* Override reason */}
          {record.overrideReason && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">Override Reason</p>
              <p className="text-sm text-slate-200">{record.overrideReason}</p>
            </div>
          )}

          {/* Actor + Timing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
              <p className="text-xs text-slate-500 mb-1">Responsible Party</p>
              <p className="text-sm text-slate-200 font-medium">{record.actorName ?? "Unknown"}</p>
              {record.actorRole && (
                <p className="text-xs text-slate-500 capitalize mt-0.5">{record.actorRole}</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
              <p className="text-xs text-slate-500 mb-1">Occurred At</p>
              <p className="text-sm text-slate-200 font-medium">
                {record.occurredAt ? format(new Date(record.occurredAt), "dd MMM yyyy, HH:mm") : "—"}
              </p>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                {record.occurredAt ? new Date(record.occurredAt).toISOString() : ""}
              </p>
            </div>
          </div>

          {/* Related record */}
          {(record.relatedTable || record.relatedRecordId) && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
              <p className="text-xs text-slate-500 mb-1">Linked Record</p>
              <p className="text-xs font-mono text-slate-300">
                {record.relatedTable ?? ""} · {record.relatedRecordId ?? ""}
              </p>
            </div>
          )}

          {/* Supporting documents placeholder */}
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
            <p className="text-xs text-slate-500 mb-1">Supporting Documents</p>
            {record.supportingDocuments && record.supportingDocuments.length > 0 ? (
              <div className="space-y-1">
                {record.supportingDocuments.map((doc, i) => (
                  <p key={i} className="text-xs text-slate-300 font-mono">{JSON.stringify(doc)}</p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600 italic">No documents attached — future upload capability</p>
            )}
          </div>

          {/* Metadata */}
          {record.metadata && Object.keys(record.metadata).length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
              <p className="text-xs text-slate-500 mb-2">Context Metadata</p>
              <div className="space-y-1">
                {Object.entries(record.metadata).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-slate-500 capitalize">{k.replace(/_/g, " ")}</span>
                    <span className="text-slate-300 font-mono">{v === null ? "null" : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Manual note dialog ────────────────────────────────────────────────────────

function AddNoteDialog({
  projects,
  onClose,
}: {
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const addOverride = useAddGovernanceOverride();
  const [form, setForm] = useState({
    projectId: "",
    overrideType: "governance_manual_note",
    module: "governance",
    title: "",
    description: "",
    overrideReason: "",
  });

  const handleSubmit = async () => {
    if (!form.projectId || !form.title || form.overrideReason.length < 5) return;
    await addOverride.mutateAsync({
      data: {
        projectId: form.projectId,
        overrideType: form.overrideType,
        module: form.module,
        title: form.title,
        description: form.description || undefined,
        overrideReason: form.overrideReason,
      },
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Log Governance Action</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-slate-400 text-xs mb-1.5 block">Project</Label>
            <Select value={form.projectId} onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue placeholder="Select project…" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-200 focus:bg-slate-700">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-400 text-xs mb-1.5 block">Module</Label>
            <Select value={form.module} onValueChange={(v) => setForm((f) => ({ ...f, module: v }))}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {Object.entries(MODULE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-slate-200 focus:bg-slate-700">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-400 text-xs mb-1.5 block">Title</Label>
            <Input
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-600"
              placeholder="Brief description of the action…"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-slate-400 text-xs mb-1.5 block">Details (optional)</Label>
            <Textarea
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-600 resize-none"
              rows={2}
              placeholder="Additional context…"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-slate-400 text-xs mb-1.5 block">
              Justification / Override Reason <span className="text-red-400">*</span>
            </Label>
            <Textarea
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-600 resize-none"
              rows={3}
              placeholder="Explain why this governance action was taken (min 5 characters)…"
              value={form.overrideReason}
              onChange={(e) => setForm((f) => ({ ...f, overrideReason: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="text-slate-400 hover:text-slate-200" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={handleSubmit}
            disabled={addOverride.isPending || !form.projectId || !form.title || form.overrideReason.length < 5}
          >
            {addOverride.isPending ? "Saving…" : "Log Action"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function GovernanceOverrides() {
  const { role } = useRole();
  const [tab, setTab] = useState<"history" | "analytics">("history");
  const [projectFilter, setProjectFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [selectedRecord, setSelectedRecord] = useState<OverrideRecord | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: projectsData } = useListProjects({});
  const projects = useMemo(() => {
    if (!projectsData) return [];
    if (Array.isArray(projectsData)) return projectsData as Array<{ id: string; name: string }>;
    return (projectsData as { projects?: Array<{ id: string; name: string }> }).projects ?? [];
  }, [projectsData]);

  const listParams = {
    projectId: projectFilter || undefined,
    overrideType: typeFilter || undefined,
    module: moduleFilter || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    limit,
    offset,
  };

  const { data: listData, isLoading: listLoading } = useListGovernanceOverrides(listParams);
  const { data: analyticsData, isLoading: analyticsLoading } = useGetGovernanceOverrideAnalytics(
    { projectId: projectFilter || undefined, from: fromDate || undefined, to: toDate || undefined },
  );

  const overrides = listData?.overrides ?? [];
  const total = listData?.total ?? 0;
  const analytics = analyticsData;

  const canWrite = role === "admin" || role === "developer";

  const clearFilters = () => {
    setProjectFilter("");
    setTypeFilter("");
    setModuleFilter("");
    setFromDate("");
    setToDate("");
    setOffset(0);
  };
  const hasFilters = !!(projectFilter || typeFilter || moduleFilter || fromDate || toDate);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GitCompare className="h-6 w-6 text-indigo-400" />
            <h1 className="text-2xl font-semibold text-slate-100">Override History</h1>
            {analytics && (
              <Badge className="bg-indigo-900/60 border-indigo-700 text-indigo-300 text-xs">
                {analytics.total} total
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">
            Permanent, tamper-evident record of every manual override, governance deviation, and
            administrative action. No entry may be deleted or modified.
          </p>
        </div>
        {canWrite && (
          <Button
            className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
            onClick={() => setShowAddNote(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Log Action
          </Button>
        )}
      </div>

      {/* Transparency stat cards */}
      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Override Events", value: analytics.total, color: "indigo" },
            { label: "Modules Affected", value: analytics.byModule?.length ?? 0, color: "amber" },
            { label: "Acting Parties", value: analytics.byActor?.length ?? 0, color: "emerald" },
            { label: "Override Types", value: analytics.byType?.length ?? 0, color: "violet" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className={`text-2xl font-bold text-${color}-400`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "history" | "analytics")}>
        <div className="flex items-center gap-3">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="history" className="data-[state=active]:bg-slate-700 text-slate-400 data-[state=active]:text-slate-100">
              History
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-slate-700 text-slate-400 data-[state=active]:text-slate-100">
              Analytics
            </TabsTrigger>
          </TabsList>

          <Button
            variant="ghost"
            size="sm"
            className={`text-slate-400 hover:text-slate-200 gap-1.5 ${hasFilters ? "text-amber-400 hover:text-amber-300" : ""}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasFilters && <Badge className="bg-amber-900/60 text-amber-300 border-amber-700 text-xs ml-0.5">{[projectFilter, typeFilter, moduleFilter, fromDate, toDate].filter(Boolean).length}</Badge>}
            {filtersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="text-slate-500 hover:text-slate-200 gap-1" onClick={clearFilters}>
              <X className="h-3 w-3" /> Clear
            </Button>
          )}
        </div>

        {/* Filter bar */}
        {filtersOpen && (
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-2">
            <div>
              <Label className="text-slate-500 text-xs mb-1 block">Project</Label>
              <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v === "_all" ? "" : v); setOffset(0); }}>
                <SelectTrigger className="bg-slate-900 border-slate-600 text-slate-300 h-8 text-xs">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="_all" className="text-slate-300 focus:bg-slate-700 text-xs">All projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-slate-200 focus:bg-slate-700 text-xs">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-500 text-xs mb-1 block">Override Type</Label>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === "_all" ? "" : v); setOffset(0); }}>
                <SelectTrigger className="bg-slate-900 border-slate-600 text-slate-300 h-8 text-xs">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="_all" className="text-slate-300 focus:bg-slate-700 text-xs">All types</SelectItem>
                  {Object.entries(OVERRIDE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-slate-200 focus:bg-slate-700 text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-500 text-xs mb-1 block">Module</Label>
              <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v === "_all" ? "" : v); setOffset(0); }}>
                <SelectTrigger className="bg-slate-900 border-slate-600 text-slate-300 h-8 text-xs">
                  <SelectValue placeholder="All modules" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-600">
                  <SelectItem value="_all" className="text-slate-300 focus:bg-slate-700 text-xs">All modules</SelectItem>
                  {Object.entries(MODULE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-slate-200 focus:bg-slate-700 text-xs">{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-500 text-xs mb-1 block">From</Label>
              <Input type="date" className="bg-slate-900 border-slate-600 text-slate-300 h-8 text-xs" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setOffset(0); }} />
            </div>
            <div>
              <Label className="text-slate-500 text-xs mb-1 block">To</Label>
              <Input type="date" className="bg-slate-900 border-slate-600 text-slate-300 h-8 text-xs" value={toDate} onChange={(e) => { setToDate(e.target.value); setOffset(0); }} />
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        <TabsContent value="history" className="mt-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800/20 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_140px_100px_150px_100px] gap-4 px-4 py-2.5 border-b border-slate-700 bg-slate-800/40">
              <p className="text-xs text-slate-500 font-medium">Event / Title</p>
              <p className="text-xs text-slate-500 font-medium">Override Type</p>
              <p className="text-xs text-slate-500 font-medium">Module</p>
              <p className="text-xs text-slate-500 font-medium">Responsible Party</p>
              <p className="text-xs text-slate-500 font-medium text-right">Date</p>
            </div>

            {listLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-500 text-sm">Loading override history…</div>
            ) : overrides.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600 gap-2">
                <GitCompare className="h-8 w-8 opacity-30" />
                <p className="text-sm">No override records match these filters</p>
                {hasFilters && (
                  <Button variant="ghost" size="sm" className="text-slate-500 text-xs mt-1" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {overrides.map((o) => (
                  <button
                    key={o.id}
                    className="w-full grid grid-cols-[1fr_140px_100px_150px_100px] gap-4 px-4 py-3 text-left hover:bg-slate-700/30 transition-colors group"
                    onClick={() => setSelectedRecord(o as OverrideRecord)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-medium truncate group-hover:text-white">{o.title ?? "—"}</p>
                      {o.projectName && <p className="text-xs text-slate-500 truncate mt-0.5">{o.projectName}</p>}
                      {o.overrideReason && (
                        <p className="text-xs text-slate-600 truncate mt-0.5 italic">"{o.overrideReason}"</p>
                      )}
                    </div>
                    <div>
                      <Badge className={`text-xs border gap-1 ${overrideTypeBadgeClass(o.overrideType ?? "")}`}>
                        {overrideTypeIcon(o.overrideType ?? "")}
                        <span className="truncate">{OVERRIDE_TYPE_LABELS[o.overrideType ?? ""] ?? o.overrideType ?? "—"}</span>
                      </Badge>
                    </div>
                    <div>
                      <span className="text-xs text-slate-400 capitalize"
                        style={{ color: MODULE_COLORS[o.module ?? ""] }}>
                        {MODULE_LABELS[o.module ?? ""] ?? o.module ?? "—"}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs text-slate-300">{o.actorName ?? "—"}</p>
                      {o.actorRole && <p className="text-xs text-slate-600 capitalize">{o.actorRole}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">
                        {o.occurredAt ? format(new Date(o.occurredAt), "dd MMM yyyy") : "—"}
                      </p>
                      <p className="text-xs text-slate-600">
                        {o.occurredAt ? format(new Date(o.occurredAt), "HH:mm") : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 bg-slate-800/40">
                <p className="text-xs text-slate-500">
                  Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-slate-200 text-xs"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-slate-200 text-xs"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── ANALYTICS TAB ── */}
        <TabsContent value="analytics" className="mt-4">
          {analyticsLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-500 text-sm">Loading analytics…</div>
          ) : !analytics ? (
            <div className="flex items-center justify-center py-16 text-slate-600 text-sm">No analytics data</div>
          ) : (
            <div className="space-y-6">
              {/* Activity over time */}
              {analytics.byMonth && analytics.byMonth.length > 0 && (
                <div className="rounded-lg border border-slate-700 bg-slate-800/20 p-5">
                  <p className="text-sm font-medium text-slate-300 mb-4">Override Activity Over Time</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={analytics.byMonth}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                        labelStyle={{ color: "#94a3b8", fontSize: 11 }}
                        itemStyle={{ color: "#a78bfa", fontSize: 11 }}
                      />
                      <Line type="monotone" dataKey="count" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3, fill: "#a78bfa" }} name="Overrides" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* By Type */}
                {analytics.byType && analytics.byType.length > 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-800/20 p-5">
                    <p className="text-sm font-medium text-slate-300 mb-4">Overrides by Type</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={analytics.byType.map((r) => ({ ...r, label: OVERRIDE_TYPE_LABELS[r.overrideType ?? ""] ?? r.overrideType }))} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                        <XAxis type="number" stroke="#64748b" tick={{ fontSize: 10 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} width={130} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                          itemStyle={{ color: "#f59e0b", fontSize: 11 }}
                        />
                        <Bar dataKey="count" fill="#f59e0b" radius={[0, 3, 3, 0]} name="Count" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* By Module */}
                {analytics.byModule && analytics.byModule.length > 0 && (
                  <div className="rounded-lg border border-slate-700 bg-slate-800/20 p-5">
                    <p className="text-sm font-medium text-slate-300 mb-4">Overrides by Module</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={analytics.byModule.map((r) => ({ ...r, label: MODULE_LABELS[r.module ?? ""] ?? r.module }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} />
                        <YAxis stroke="#64748b" tick={{ fontSize: 10 }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 6 }}
                          itemStyle={{ color: "#6366f1", fontSize: 11 }}
                        />
                        <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} name="Count" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Top actors — governance transparency panel */}
              {analytics.byActor && analytics.byActor.length > 0 && (
                <div className="rounded-lg border border-slate-700 bg-slate-800/20 p-5">
                  <p className="text-sm font-medium text-slate-300 mb-3">
                    Governance Transparency — Actions by Party
                  </p>
                  <p className="text-xs text-slate-500 mb-4">
                    Every party who has performed a governance override or administrative action.
                    This panel serves as accountability evidence for regulatory review.
                  </p>
                  <div className="divide-y divide-slate-800">
                    {analytics.byActor.map((actor, i) => {
                      const maxCount = Math.max(...analytics.byActor!.map((a) => Number(a.count)));
                      const pct = maxCount > 0 ? (Number(actor.count) / maxCount) * 100 : 0;
                      return (
                        <div key={i} className="flex items-center gap-4 py-2.5">
                          <div className="w-6 text-xs text-slate-600 text-right shrink-0">{i + 1}</div>
                          <div className="min-w-[120px] shrink-0">
                            <p className="text-sm text-slate-200">{actor.actorName ?? "Unknown"}</p>
                            {actor.actorRole && (
                              <p className="text-xs text-slate-500 capitalize">{actor.actorRole}</p>
                            )}
                          </div>
                          <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="text-sm text-slate-300 font-mono shrink-0 w-8 text-right">
                            {actor.count}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent 10 — quick transparency view */}
              {analytics.recentActivity && analytics.recentActivity.length > 0 && (
                <div className="rounded-lg border border-slate-700 bg-slate-800/20 p-5">
                  <p className="text-sm font-medium text-slate-300 mb-3">Most Recent Actions</p>
                  <div className="divide-y divide-slate-800">
                    {analytics.recentActivity.map((o) => (
                      <button
                        key={o.id}
                        className="w-full flex items-center gap-4 py-2.5 text-left hover:bg-slate-700/20 transition-colors"
                        onClick={() => { setSelectedRecord(o as OverrideRecord); setTab("history"); }}
                      >
                        <div className="shrink-0">
                          <Badge className={`text-xs border gap-1 ${overrideTypeBadgeClass(o.overrideType ?? "")}`}>
                            {overrideTypeIcon(o.overrideType ?? "")}
                          </Badge>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-300 truncate">{o.title ?? "—"}</p>
                          <p className="text-xs text-slate-500 truncate">{o.projectName ?? ""} · {o.actorName ?? ""}</p>
                        </div>
                        <p className="text-xs text-slate-500 shrink-0">
                          {o.occurredAt ? format(new Date(o.occurredAt), "dd MMM") : "—"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Comparison dialog */}
      {selectedRecord && (
        <ComparisonDialog record={selectedRecord} onClose={() => setSelectedRecord(null)} />
      )}

      {/* Add note dialog */}
      {showAddNote && (
        <AddNoteDialog projects={projects} onClose={() => setShowAddNote(false)} />
      )}
    </div>
  );
}
