import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListOperationalAlerts,
  useGetOperationalAlertSummary,
  useGenerateOperationalAlerts,
  useUpdateOperationalAlert,
} from "@workspace/api-client-react";
import type { OperationalAlert } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  ShieldAlert,
  Info,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  PackageX,
  Link2Off,
  BarChart3,
  TrendingUp,
  ShoppingCart,
  ClipboardX,
  Filter,
  ScanSearch,
  Loader2,
} from "lucide-react";
import type { AlertSummary, UpdateAlertBodyAction, ListOperationalAlertsParams } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListOperationalAlertsQueryKey, getGetOperationalAlertSummaryQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ── Type helpers ─────────────────────────────────────────────────────────────

type AlertSeverity = "critical" | "warning" | "info";
type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed";
type AlertType =
  | "negative_stock"
  | "missing_batch_linkage"
  | "inventory_inconsistency"
  | "suspicious_adjustment"
  | "unusual_sales_change"
  | "missing_operational_record";

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; icon: typeof AlertTriangle; bg: string; text: string; border: string; dot: string }> = {
  critical: { label: "Critical", icon: ShieldAlert, bg: "bg-red-950/40", text: "text-red-400", border: "border-red-800/50", dot: "bg-red-500" },
  warning:  { label: "Warning",  icon: AlertTriangle, bg: "bg-amber-950/30", text: "text-amber-400", border: "border-amber-700/50", dot: "bg-amber-500" },
  info:     { label: "Info",     icon: Info,          bg: "bg-sky-950/30",   text: "text-sky-400",   border: "border-sky-700/40",    dot: "bg-sky-500" },
};

const STATUS_CONFIG: Record<AlertStatus, { label: string; badgeCls: string }> = {
  open:         { label: "Open",         badgeCls: "bg-red-900/50 text-red-300 border-red-700/50" },
  acknowledged: { label: "Acknowledged", badgeCls: "bg-amber-900/40 text-amber-300 border-amber-700/40" },
  resolved:     { label: "Resolved",     badgeCls: "bg-emerald-900/40 text-emerald-400 border-emerald-700/40" },
  dismissed:    { label: "Dismissed",    badgeCls: "bg-neutral-800 text-neutral-400 border-neutral-700" },
};

const TYPE_CONFIG: Record<AlertType, { label: string; icon: typeof PackageX; color: string }> = {
  negative_stock:            { label: "Negative Stock",         icon: PackageX,    color: "text-red-400" },
  missing_batch_linkage:     { label: "Missing Batch Link",      icon: Link2Off,    color: "text-amber-400" },
  inventory_inconsistency:   { label: "Inventory Discrepancy",  icon: BarChart3,   color: "text-orange-400" },
  suspicious_adjustment:     { label: "Suspicious Adjustment",   icon: TrendingUp,  color: "text-yellow-400" },
  unusual_sales_change:      { label: "Unusual Sales Change",    icon: ShoppingCart,color: "text-violet-400" },
  missing_operational_record:{ label: "Missing Record",         icon: ClipboardX,  color: "text-sky-400" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity: AlertSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return <span className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", cfg.dot)} />;
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded border", cfg.bg, cfg.text, cfg.border)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: AlertStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded border", cfg.badgeCls)}>
      {cfg.label}
    </span>
  );
}

function TypeBadge({ alertType }: { alertType: AlertType }) {
  const cfg = TYPE_CONFIG[alertType];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", cfg.color)}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

function MetadataViewer({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return (
    <div className="mt-3 rounded-md bg-neutral-900 border border-neutral-800 p-3">
      <p className="text-xs text-neutral-500 font-medium mb-2 uppercase tracking-wide">Raw Detection Data</p>
      <pre className="text-xs text-neutral-300 font-mono whitespace-pre-wrap overflow-auto max-h-40">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </div>
  );
}

// ── Resolve / Dismiss dialog ──────────────────────────────────────────────────

interface ActionDialogProps {
  alert: OperationalAlert | null;
  action: "resolve" | "dismiss" | null;
  onClose: () => void;
  onConfirm: (alertId: string, action: string, notes: string) => void;
  isLoading: boolean;
}
function ActionDialog({ alert, action, onClose, onConfirm, isLoading }: ActionDialogProps) {
  const [notes, setNotes] = useState("");

  if (!alert || !action) return null;

  const isResolve = action === "resolve";
  const title = isResolve ? "Resolve Alert" : "Dismiss Alert";
  const desc = isResolve
    ? "Confirm that the root cause has been addressed. Add resolution notes for the audit trail."
    : "Mark this alert as not actionable or a false positive.";

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="bg-neutral-900 border-neutral-800 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <p className="text-sm text-neutral-400 mt-1">{desc}</p>
        </DialogHeader>
        <div className="mt-2 p-3 rounded-md bg-neutral-800/60 border border-neutral-700">
          <p className="text-xs text-neutral-500 mb-0.5">Alert</p>
          <p className="text-sm text-white font-medium">{alert.title}</p>
        </div>
        <div className="mt-2">
          <Label className="text-neutral-300 text-sm">{isResolve ? "Resolution notes" : "Reason (optional)"}</Label>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={isResolve ? "Describe how the issue was resolved…" : "Reason for dismissal (optional)"}
            className="mt-1.5 bg-neutral-800 border-neutral-700 text-white text-sm min-h-[80px]"
          />
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={onClose} className="border-neutral-700">Cancel</Button>
          <Button
            size="sm"
            onClick={() => onConfirm(alert.id, action, notes)}
            disabled={isLoading}
            className={isResolve ? "bg-emerald-700 hover:bg-emerald-600 text-white" : "bg-neutral-700 hover:bg-neutral-600 text-white"}
          >
            {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
            {isResolve ? "Mark Resolved" : "Dismiss Alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Alert row ────────────────────────────────────────────────────────────────

interface AlertRowProps {
  alert: OperationalAlert;
  isAdmin: boolean;
  onAcknowledge: (id: string) => void;
  onResolve: (alert: OperationalAlert) => void;
  onDismiss: (alert: OperationalAlert) => void;
  onReopen: (id: string) => void;
  loading: string | null;
}

function AlertRow({ alert, isAdmin, onAcknowledge, onResolve, onDismiss, onReopen, loading }: AlertRowProps) {
  const [expanded, setExpanded] = useState(false);
  const severity = alert.severity as AlertSeverity;
  const status = alert.status as AlertStatus;
  const alertType = alert.alertType as AlertType;
  const cfg = SEVERITY_CONFIG[severity];
  const isActionable = status === "open" || status === "acknowledged";
  const isLoading = loading === alert.id;

  const detectedDate = new Date(alert.detectedAt).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

  return (
    <div className={cn("rounded-lg border transition-all", cfg.border, status === "open" ? cfg.bg : "bg-neutral-900/30 border-neutral-800")}>
      {/* Row header */}
      <div
        className="flex items-start gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(x => !x)}
      >
        <SeverityDot severity={severity} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{alert.title}</span>
            <SeverityBadge severity={severity} />
            <StatusBadge status={status} />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <TypeBadge alertType={alertType} />
            {alert.projectName && (
              <span className="text-xs text-neutral-500">{alert.projectName}</span>
            )}
            {alert.entityRef && (
              <span className="text-xs text-neutral-600 font-mono">{alert.entityRef}</span>
            )}
            <span className="text-xs text-neutral-600">Detected {detectedDate}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isActionable && (
            <>
              {status === "open" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs border-neutral-700 text-neutral-300 hover:text-white"
                  onClick={e => { e.stopPropagation(); onAcknowledge(alert.id); }}
                  disabled={isLoading}
                >
                  <Eye className="w-3 h-3 mr-1" />
                  Ack
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs border-emerald-800 text-emerald-400 hover:bg-emerald-900/30"
                onClick={e => { e.stopPropagation(); onResolve(alert); }}
                disabled={isLoading}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs border-neutral-700 text-neutral-400 hover:bg-neutral-800"
                onClick={e => { e.stopPropagation(); onDismiss(alert); }}
                disabled={isLoading}
              >
                <XCircle className="w-3 h-3 mr-1" />
                Dismiss
              </Button>
            </>
          )}
          {(status === "resolved" || status === "dismissed") && isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs border-neutral-700 text-neutral-500 hover:text-neutral-300"
              onClick={e => { e.stopPropagation(); onReopen(alert.id); }}
              disabled={isLoading}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reopen
            </Button>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-neutral-800/60 pt-3 space-y-3">
          <p className="text-sm text-neutral-300">{alert.description}</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {alert.entityType && (
              <div>
                <p className="text-neutral-500 mb-0.5">Entity</p>
                <p className="text-neutral-300 capitalize">{alert.entityType.replace(/_/g, " ")}</p>
              </div>
            )}
            {alert.entityRef && (
              <div>
                <p className="text-neutral-500 mb-0.5">Reference</p>
                <p className="text-neutral-300 font-mono">{alert.entityRef}</p>
              </div>
            )}
            {alert.acknowledgedByName && (
              <div>
                <p className="text-neutral-500 mb-0.5">Acknowledged by</p>
                <p className="text-neutral-300">{alert.acknowledgedByName}</p>
              </div>
            )}
            {alert.resolvedByName && (
              <div>
                <p className="text-neutral-500 mb-0.5">{status === "dismissed" ? "Dismissed by" : "Resolved by"}</p>
                <p className="text-neutral-300">{alert.resolvedByName}</p>
              </div>
            )}
            {alert.resolutionNotes && (
              <div className="col-span-full">
                <p className="text-neutral-500 mb-0.5">Notes</p>
                <p className="text-neutral-300 italic">"{alert.resolutionNotes}"</p>
              </div>
            )}
          </div>

          <MetadataViewer metadata={alert.metadata as Record<string, unknown> | null | undefined} />
        </div>
      )}
    </div>
  );
}

// ── Summary KPI cards ─────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: AlertSummary | undefined }) {
  if (!summary) return null;

  const cards = [
    {
      label: "Critical Active",
      value: summary.criticalActive,
      icon: ShieldAlert,
      color: "text-red-400",
      bg: "bg-red-950/30",
      border: "border-red-800/40",
    },
    {
      label: "Warnings Active",
      value: summary.warningActive,
      icon: AlertTriangle,
      color: "text-amber-400",
      bg: "bg-amber-950/20",
      border: "border-amber-800/40",
    },
    {
      label: "Open Alerts",
      value: summary.openCount,
      icon: Eye,
      color: "text-sky-400",
      bg: "bg-sky-950/20",
      border: "border-sky-800/40",
    },
    {
      label: "Resolved",
      value: summary.resolvedCount,
      icon: CheckCircle2,
      color: "text-emerald-400",
      bg: "bg-emerald-950/20",
      border: "border-emerald-800/30",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {cards.map(c => {
        const Icon = c.icon;
        return (
          <div key={c.label} className={cn("rounded-xl border p-4", c.bg, c.border)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-neutral-400">{c.label}</span>
              <Icon className={cn("w-4 h-4", c.color)} />
            </div>
            <p className={cn("text-2xl font-bold", c.color)}>{c.value}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Type breakdown strip ──────────────────────────────────────────────────────

function TypeBreakdown({ byType }: { byType: Record<string, number> | undefined }) {
  if (!byType) return null;

  const items: { key: string; label: string; icon: typeof PackageX; color: string }[] = [
    { key: "negativeStock",            label: "Neg. Stock",   icon: PackageX,    color: "text-red-400" },
    { key: "missingBatchLinkage",      label: "Batch Link",   icon: Link2Off,    color: "text-amber-400" },
    { key: "inventoryInconsistency",   label: "Inv. Discr.",  icon: BarChart3,   color: "text-orange-400" },
    { key: "suspiciousAdjustment",     label: "Susp. Adj.",   icon: TrendingUp,  color: "text-yellow-400" },
    { key: "unusualSalesChange",       label: "Sales Flag",   icon: ShoppingCart,color: "text-violet-400" },
    { key: "missingOperationalRecord", label: "Miss. Record", icon: ClipboardX,  color: "text-sky-400" },
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {items.map(item => {
        const count = (byType as Record<string, number>)[item.key] ?? 0;
        const Icon = item.icon;
        return (
          <div key={item.key} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-800/60 border border-neutral-700/60 text-xs">
            <Icon className={cn("w-3 h-3", item.color)} />
            <span className="text-neutral-400">{item.label}</span>
            <span className={cn("font-bold", count > 0 ? item.color : "text-neutral-600")}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function OperationalAlerts() {
  const { role } = useRole();
  const isAdmin = role === "admin";
  const qc = useQueryClient();

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Dialog state
  const [actionDialog, setActionDialog] = useState<{ alert: OperationalAlert; action: "resolve" | "dismiss" } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const params = {
    status: statusFilter !== "all" ? statusFilter : undefined,
    severity: severityFilter !== "all" ? severityFilter : undefined,
    alertType: typeFilter !== "all" ? typeFilter : undefined,
  };

  const { data: summary, isLoading: summaryLoading } = useGetOperationalAlertSummary({}) as { data: AlertSummary | undefined; isLoading: boolean };
  const { data: alerts = [], isLoading: alertsLoading, refetch } = useListOperationalAlerts(params as ListOperationalAlertsParams);
  const generateMutation = useGenerateOperationalAlerts();
  const updateMutation = useUpdateOperationalAlert();

  const filtered = alerts.filter(a =>
    !search || a.title.toLowerCase().includes(search.toLowerCase()) || (a.projectName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListOperationalAlertsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetOperationalAlertSummaryQueryKey() });
  };

  const handleGenerate = async () => {
    await generateMutation.mutateAsync();
    invalidate();
  };

  const handleAction = async (id: string, action: string, notes?: string) => {
    setActionLoading(id);
    try {
      await updateMutation.mutateAsync({ id, data: { action: action as UpdateAlertBodyAction, resolutionNotes: notes } });
      invalidate();
      setActionDialog(null);
    } finally {
      setActionLoading(null);
    }
  };

  if (role === "landowner" || role === "investor" || role === "employee" || role === "operational_staff") {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <ShieldAlert className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
          <p className="text-neutral-400">Operational monitoring is not available for your role.</p>
        </div>
      </div>
    );
  }

  const isGenerating = generateMutation.isPending;
  const totalActive = (summary?.criticalActive ?? 0) + (summary?.warningActive ?? 0);

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-4 lg:p-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScanSearch className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold text-white">Operational Alert Monitor</h1>
            {totalActive > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-900/60 text-red-300 border border-red-700/50">
                {totalActive} active
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-400">
            Governance and compliance monitoring — detect inventory anomalies, batch traceability gaps, and suspicious operational patterns.
          </p>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="bg-amber-700 hover:bg-amber-600 text-white shrink-0 gap-2"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {isGenerating ? "Scanning…" : "Run Detection"}
        </Button>
      </div>

      {/* Last generation feedback */}
      {generateMutation.data && (
        <div className="mb-4 px-3 py-2 rounded-md bg-emerald-950/40 border border-emerald-800/50 text-sm text-emerald-400">
          Detection complete — <span className="font-medium">{generateMutation.data.generated}</span> new alert{generateMutation.data.generated !== 1 ? "s" : ""} generated,{" "}
          <span className="font-medium">{generateMutation.data.skipped}</span> duplicate{generateMutation.data.skipped !== 1 ? "s" : ""} skipped.
        </div>
      )}

      {/* KPI cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-neutral-800/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <SummaryCards summary={summary} />
      )}

      {/* Type breakdown */}
      <TypeBreakdown byType={summary?.byType as Record<string, number> | undefined} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
          <Input
            placeholder="Search alerts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 bg-neutral-800 border-neutral-700 text-sm text-white h-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-neutral-800 border-neutral-700 text-sm text-white h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-neutral-900 border-neutral-800 text-white">
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-32 bg-neutral-800 border-neutral-700 text-sm text-white h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-neutral-900 border-neutral-800 text-white">
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44 bg-neutral-800 border-neutral-700 text-sm text-white h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-neutral-900 border-neutral-800 text-white">
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="negative_stock">Negative Stock</SelectItem>
            <SelectItem value="missing_batch_linkage">Missing Batch Link</SelectItem>
            <SelectItem value="inventory_inconsistency">Inv. Discrepancy</SelectItem>
            <SelectItem value="suspicious_adjustment">Suspicious Adj.</SelectItem>
            <SelectItem value="unusual_sales_change">Sales Anomaly</SelectItem>
            <SelectItem value="missing_operational_record">Missing Record</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Alert list */}
      {alertsLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-neutral-800/40 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mb-3" />
          <p className="text-neutral-300 font-medium">No alerts match the current filters</p>
          <p className="text-sm text-neutral-500 mt-1">
            {statusFilter === "open"
              ? "No open alerts — run detection to check for new issues."
              : 'Try a different filter or run "Run Detection" to scan for issues.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 border-neutral-700 text-neutral-400"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Run Detection
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(alert => (
            <AlertRow
              key={alert.id}
              alert={alert}
              isAdmin={isAdmin}
              loading={actionLoading}
              onAcknowledge={id => handleAction(id, "acknowledge")}
              onResolve={alert => setActionDialog({ alert, action: "resolve" })}
              onDismiss={alert => setActionDialog({ alert, action: "dismiss" })}
              onReopen={id => handleAction(id, "reopen")}
            />
          ))}
          <p className="text-xs text-neutral-600 text-center pt-2">
            {filtered.length} alert{filtered.length !== 1 ? "s" : ""} shown
          </p>
        </div>
      )}

      {/* Inventory discrepancy panel (always visible as context when filter is not set) */}
      {statusFilter === "open" && !alertsLoading && summary && (summary.byType as Record<string, number> | undefined)?.["inventoryInconsistency"] === 0 && (summary.byType as Record<string, number> | undefined)?.["negativeStock"] === 0 && (
        <div className="mt-6 rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-emerald-400">Inventory integrity check passed</p>
            <p className="text-xs text-neutral-400 mt-0.5">
              No negative stock or batch reconciliation discrepancies detected in the last detection run. Run detection regularly to keep this check current.
            </p>
          </div>
        </div>
      )}

      {/* Action dialog */}
      <ActionDialog
        alert={actionDialog?.alert ?? null}
        action={actionDialog?.action ?? null}
        onClose={() => setActionDialog(null)}
        onConfirm={handleAction}
        isLoading={actionLoading !== null}
      />
    </div>
  );
}
