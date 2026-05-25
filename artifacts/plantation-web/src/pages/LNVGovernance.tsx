/**
 * LNVGovernance.tsx
 *
 * Land Notional Value Governance Module
 *
 * Purpose:
 *   - View LNV records across all projects
 *   - Track valuation method, basis, and remarks
 *   - Governance review and amendment requests for post-activation changes
 *   - Audit history (via governance overrides)
 *
 * NOT for primary LNV entry — that happens in the Project Creation Wizard (Step 5).
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useListProjects, useUpdateProject } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  Banknote,
  ShieldAlert,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Info,
  Search,
  Edit2,
  TreePine,
  MapPin,
  PenLine,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey } from "@workspace/api-client-react";
import { parseNumeric } from "@/lib/numeric";

// ── Formatting helpers ──────────────────────────────────────────────────────

const fmtINR = (n: number | string | null | undefined) => {
  if (n == null || n === "") return "—";
  return `₹${parseNumeric(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtNum = (n: number | string | null | undefined) => {
  if (n == null) return "—";
  return parseNumeric(n).toLocaleString("en-IN");
};

// ── Method metadata ─────────────────────────────────────────────────────────

const METHOD_META: Record<string, { label: string; icon: any; color: string }> = {
  by_tree_capacity: {
    label: "By Tree Capacity",
    icon: TreePine,
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  by_land_area_kani: {
    label: "By Land Area (Kani)",
    icon: MapPin,
    color: "text-blue-600 bg-blue-50 border-blue-200",
  },
  manual: {
    label: "Manual Entry",
    icon: PenLine,
    color: "text-slate-600 bg-slate-50 border-slate-200",
  },
};

// ── LNV status helpers ──────────────────────────────────────────────────────

function getLNVStatus(project: any): {
  status: "complete" | "incomplete" | "inactive";
  label: string;
  color: string;
} {
  const hasValue = project.landNotionalValue != null && project.landNotionalValue > 0;
  const hasMethod = !!project.valuationMethod;
  const isOwnership = project.commercialModel === "ownership_contribution";

  if (!isOwnership) {
    return hasValue
      ? { status: "inactive", label: "Captured — Inactive (50% Model)", color: "text-sky-600 bg-sky-50 border-sky-200" }
      : { status: "incomplete", label: "Not Captured (50% Model)", color: "text-slate-500 bg-slate-50 border-slate-200" };
  }

  if (hasValue && hasMethod) {
    return { status: "complete", label: "Complete", color: "text-emerald-600 bg-emerald-50 border-emerald-200" };
  }
  return { status: "incomplete", label: "Incomplete", color: "text-red-600 bg-red-50 border-red-200" };
}

function isLocked(project: any): boolean {
  return project.activationStatus === "active" || project.lifecycleStatus === "mature_production" || project.lifecycleStatus === "closed";
}

// ── Amendment Dialog ────────────────────────────────────────────────────────

function AmendmentDialog({
  project,
  open,
  onClose,
}: {
  project: any;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const updateProject = useUpdateProject();
  const qc = useQueryClient();

  const [newValue, setNewValue] = useState(String(project.landNotionalValue ?? ""));
  const [newPerUnit, setNewPerUnit] = useState(String(project.landValuePerUnit ?? ""));
  const [newMethod, setNewMethod] = useState<string>(project.valuationMethod ?? "manual");
  const [newPerTree, setNewPerTree] = useState(String(project.perTreeValue ?? ""));
  const [newRemarks, setNewRemarks] = useState(project.landNotionalValueRemarks ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!reason.trim()) {
      setError("An amendment reason is required for audit purposes.");
      return;
    }
    if (!newValue || isNaN(parseFloat(newValue))) {
      setError("Enter a valid Land Notional Value.");
      return;
    }

    try {
      await updateProject.mutateAsync({
        id: project.id,
        data: {
          landNotionalValue: parseFloat(newValue),
          landValuePerUnit: newPerUnit ? parseFloat(newPerUnit) : undefined,
          valuationMethod: newMethod as any,
          perTreeValue: newPerTree ? parseFloat(newPerTree) : undefined,
          landNotionalValueRemarks: newRemarks.trim()
            ? `[AMENDMENT] ${newRemarks.trim()} | Reason: ${reason.trim()}`
            : `[AMENDMENT] Reason: ${reason.trim()}`,
        } as any,
      });
      qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({ title: "LNV amendment applied", description: "The change has been saved and will appear in governance records." });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to apply amendment.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="w-4 h-4" />
            LNV Amendment — {project.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Warning */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">
              This project is <strong>active or post-activation</strong>. Amending Land Notional Value requires a governance-level reason and will be recorded in the audit trail.
            </p>
          </div>

          {/* Valuation Method */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Valuation Method</label>
            <Select value={newMethod} onValueChange={setNewMethod}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="by_tree_capacity">By Tree Capacity</SelectItem>
                <SelectItem value="by_land_area_kani">By Land Area (Kani)</SelectItem>
                <SelectItem value="manual">Manual Entry</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* New LNV */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">New Land Notional Value (₹) *</label>
            <Input
              type="number"
              step="0.01"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Enter new total land value"
            />
          </div>

          {/* Per unit / per tree */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Value per Unit (₹)</label>
              <Input type="number" step="0.01" value={newPerUnit} onChange={(e) => setNewPerUnit(e.target.value)} placeholder="Per kani/acre" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Value per Tree (₹)</label>
              <Input type="number" step="0.01" value={newPerTree} onChange={(e) => setNewPerTree(e.target.value)} placeholder="Per tree" />
            </div>
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Updated Valuation Remarks</label>
            <Textarea
              value={newRemarks}
              onChange={(e) => setNewRemarks(e.target.value)}
              placeholder="Market reference, deed basis, adjustment rationale..."
              rows={2}
            />
          </div>

          {/* Governance Reason (mandatory) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-red-600">Governance Reason (required) *</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this amendment is necessary — this will be recorded permanently in the audit trail..."
              rows={3}
              className="border-red-200 focus:ring-red-200"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={updateProject.isPending}
          >
            Apply Amendment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Project LNV Card ────────────────────────────────────────────────────────

function ProjectLNVCard({
  project,
  canAmend,
}: {
  project: any;
  canAmend: boolean;
}) {
  const [showAmend, setShowAmend] = useState(false);
  const lnvStatus = getLNVStatus(project);
  const locked = isLocked(project);
  const method = project.valuationMethod;
  const methodMeta = method ? METHOD_META[method] : null;
  const MethodIcon = methodMeta?.icon ?? PenLine;

  return (
    <div className="bg-white border rounded-xl shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm truncate">{project.name}</p>
            {project.projectCode && (
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">
                {project.projectCode}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{project.district}, {project.state}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {locked && <Lock className="w-3.5 h-3.5 text-slate-400" />}
          <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${lnvStatus.color}`}>
            {lnvStatus.label}
          </span>
        </div>
      </div>

      {/* Model + lifecycle badges */}
      <div className="px-4 py-2 border-b bg-slate-50/50 flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${project.commercialModel === "ownership_contribution" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
          {project.commercialModel === "ownership_contribution" ? "Ownership Contribution" : "50% Revenue Split"}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded border font-medium bg-slate-100 text-slate-600 border-slate-200">
          {project.activationStatus}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded border font-medium bg-slate-100 text-slate-600 border-slate-200">
          {project.lifecycleStatus}
        </span>
      </div>

      {/* LNV Details */}
      <div className="p-4 space-y-3">
        {/* Valuation Method */}
        {methodMeta ? (
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded border ${methodMeta.color}`}>
              <MethodIcon className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Valuation Method</p>
              <p className="text-sm font-medium">{methodMeta.label}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            <p className="text-sm">No valuation method recorded</p>
          </div>
        )}

        {/* Value grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Total LNV</p>
            <p className="text-sm font-bold text-slate-800">{fmtINR(project.landNotionalValue)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Per Unit</p>
            <p className="text-sm font-semibold text-slate-700">{fmtINR(project.landValuePerUnit)}</p>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Per Tree</p>
            <p className="text-sm font-semibold text-slate-700">{fmtINR(project.perTreeValue)}</p>
          </div>
        </div>

        {/* Land + capacity context */}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>
            <span className="font-medium text-slate-700">{fmtNum(project.landArea)}</span> {project.landAreaUnit}
          </span>
          {project.rubberCapacity && (
            <span>
              <span className="font-medium text-slate-700">{fmtNum(project.rubberCapacity)}</span> {project.rubberCapacityUnit ?? "trees"}
            </span>
          )}
        </div>

        {/* LCA */}
        {project.commercialModel === "ownership_contribution" && (
          <div className="flex items-center gap-3 text-xs bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
            <TrendingUp className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="text-amber-700">
              LCA: {project.lcaBaseAmount ? fmtINR(project.lcaBaseAmount) : "—"} / yr
              {project.lcaEscalationPct ? ` · ${project.lcaEscalationPct}% escalation` : ""}
            </span>
          </div>
        )}

        {/* Remarks */}
        {project.landNotionalValueRemarks && (
          <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Valuation Remarks</p>
            <p className="text-xs text-slate-600 leading-relaxed">{project.landNotionalValueRemarks}</p>
          </div>
        )}

        {/* 50% model inactive notice */}
        {project.commercialModel !== "ownership_contribution" && project.landNotionalValue && (
          <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-md px-3 py-2">
            <Info className="w-3.5 h-3.5 text-sky-500 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-600">
              Captured for audit — inactive under 50% Revenue Split model. Will activate on model migration.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      {canAmend && (
        <div className="px-4 pb-4">
          <Button
            size="sm"
            variant={locked ? "destructive" : "outline"}
            className="w-full text-xs"
            onClick={() => setShowAmend(true)}
          >
            {locked ? (
              <><Lock className="w-3 h-3 mr-1" /> Request Governance Amendment</>
            ) : (
              <><Edit2 className="w-3 h-3 mr-1" /> Amend LNV</>
            )}
          </Button>
        </div>
      )}

      {showAmend && (
        <AmendmentDialog
          project={project}
          open={showAmend}
          onClose={() => setShowAmend(false)}
        />
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function LNVGovernance() {
  const { role } = useRole();
  const canAmend = role === "admin" || role === "developer";
  const canView = ["admin", "developer", "landowner", "investor"].includes(role);

  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState<"all" | "ownership_contribution" | "fifty_percent_revenue">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "complete" | "incomplete" | "inactive">("all");

  const { data: projectsRaw = [], isLoading } = useListProjects();
  const projects = projectsRaw as any[];

  const filtered = useMemo(() => {
    return projects.filter((p) => {
      if (modelFilter !== "all" && p.commercialModel !== modelFilter) return false;
      if (statusFilter !== "all") {
        const st = getLNVStatus(p);
        if (st.status !== statusFilter) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          p.name?.toLowerCase().includes(q) ||
          p.projectCode?.toLowerCase().includes(q) ||
          p.district?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [projects, modelFilter, statusFilter, search]);

  // Summary stats
  const stats = useMemo(() => {
    const total = projects.length;
    const complete = projects.filter((p) => getLNVStatus(p).status === "complete").length;
    const incomplete = projects.filter((p) => getLNVStatus(p).status === "incomplete").length;
    const inactive = projects.filter((p) => getLNVStatus(p).status === "inactive").length;
    const totalLNV = projects.reduce((acc, p) => acc + (Number(p.landNotionalValue) || 0), 0);
    return { total, complete, incomplete, inactive, totalLNV };
  }, [projects]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Restricted to admin, developer, landowner and investor roles.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <div className="p-2.5 bg-amber-900/20 border border-amber-700/30 rounded-xl shrink-0">
            <Banknote className="w-6 h-6 text-amber-500" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Land Notional Value Governance</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Audit · Amendment workflow · Valuation basis tracking — across all projects
            </p>
          </div>
        </div>

        {/* Architecture note */}
        <div className="flex items-start gap-2 bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 mb-6">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-400">
            Land Notional Value is a <strong className="text-slate-300">foundational commercial parameter</strong> set during project onboarding (Step 5 of the creation wizard).
            This module provides governance visibility, amendment workflow for active projects, and audit tracking.
            Primary entry happens during <strong className="text-slate-300">Project Creation → Capacity &amp; Finance</strong>.
          </p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Projects", value: String(stats.total), color: "text-white" },
            { label: "Complete", value: String(stats.complete), color: "text-emerald-400" },
            { label: "Incomplete", value: String(stats.incomplete), color: "text-red-400" },
            {
              label: "Aggregate LNV",
              value: stats.totalLNV > 0 ? `₹${(stats.totalLNV / 1_00_000).toFixed(1)}L` : "—",
              color: "text-amber-400",
            },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{kpi.label}</p>
              <p className={`text-2xl font-bold font-mono ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
            />
          </div>
          <Select value={modelFilter} onValueChange={(v) => setModelFilter(v as any)}>
            <SelectTrigger className="w-52 bg-slate-900 border-slate-700 text-slate-300 text-sm">
              <SelectValue placeholder="Commercial model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              <SelectItem value="ownership_contribution">Ownership Contribution</SelectItem>
              <SelectItem value="fifty_percent_revenue">50% Revenue Split</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-44 bg-slate-900 border-slate-700 text-slate-300 text-sm">
              <SelectValue placeholder="LNV status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="incomplete">Incomplete</SelectItem>
              <SelectItem value="inactive">Inactive (50%)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Project grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-slate-900/40 border border-slate-800 rounded-xl h-64 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Banknote className="w-10 h-10 mx-auto mb-3 text-slate-700" />
            <p className="text-slate-500">No projects match the current filters.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project) => (
              <ProjectLNVCard key={project.id} project={project} canAmend={canAmend} />
            ))}
          </div>
        )}

        {/* Incomplete projects warning banner */}
        {stats.incomplete > 0 && (
          <div className="mt-6 flex items-start gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-300">
                {stats.incomplete} project{stats.incomplete > 1 ? "s" : ""} missing Land Notional Value
              </p>
              <p className="text-xs text-red-400 mt-0.5">
                Ownership Contribution projects require LNV before activation. Complete these via <strong>Project Creation → Capacity &amp; Finance</strong>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
