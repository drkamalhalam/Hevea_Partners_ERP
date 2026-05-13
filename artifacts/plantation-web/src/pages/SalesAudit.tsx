import { useState, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import {
  useGetSaleGovernanceAlerts,
  useListSaleAuditLog,
  useListSales,
  type SaleAuditEvent,
  type SaleGovernanceAlerts,
  getGetSaleGovernanceAlertsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Eye,
  Clock,
  FileText,
  TrendingDown,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ScrollText,
  Info,
  CheckCircle2,
  XCircle,
  Plus,
  Pencil,
  Trash2,
  ArrowUpDown,
} from "lucide-react";
import { useRole } from "@/contexts/RoleContext";

function fmtDate(s: string | undefined | null) {
  if (!s) return "—";
  try { return format(parseISO(s), "dd MMM yyyy, HH:mm"); } catch { return s; }
}

function fmtShort(s: string | undefined | null) {
  if (!s) return "—";
  try { return format(parseISO(s), "dd MMM yyyy"); } catch { return s; }
}

function fmtINR(v: number | undefined | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
}

function RiskBadge({ risk }: { risk: string }) {
  if (risk === "flag") {
    return (
      <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px] px-1.5 py-0">
        <ShieldAlert className="h-2.5 w-2.5 mr-1" />FLAG
      </Badge>
    );
  }
  if (risk === "watch") {
    return (
      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0">
        <Eye className="h-2.5 w-2.5 mr-1" />WATCH
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-600/40 text-slate-400 border-slate-500/20 text-[10px] px-1.5 py-0">
      NORMAL
    </Badge>
  );
}

function EventTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    created: { label: "Created", icon: <Plus className="h-2.5 w-2.5" />, color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
    updated: { label: "Updated", icon: <Pencil className="h-2.5 w-2.5" />, color: "bg-blue-500/15 text-blue-300 border-blue-500/20" },
    confirmed: { label: "Confirmed", icon: <CheckCircle2 className="h-2.5 w-2.5" />, color: "bg-emerald-600/20 text-emerald-200 border-emerald-500/30" },
    cancelled: { label: "Cancelled", icon: <XCircle className="h-2.5 w-2.5" />, color: "bg-slate-600/30 text-slate-400 border-slate-500/20" },
    line_item_added: { label: "Item Added", icon: <Plus className="h-2.5 w-2.5" />, color: "bg-sky-500/15 text-sky-300 border-sky-500/20" },
    line_item_updated: { label: "Item Updated", icon: <Pencil className="h-2.5 w-2.5" />, color: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
    line_item_removed: { label: "Item Removed", icon: <Trash2 className="h-2.5 w-2.5" />, color: "bg-rose-500/15 text-rose-300 border-rose-500/20" },
    deduction_added: { label: "Deduction Added", icon: <TrendingDown className="h-2.5 w-2.5" />, color: "bg-purple-500/15 text-purple-300 border-purple-500/20" },
    deduction_removed: { label: "Deduction Removed", icon: <Trash2 className="h-2.5 w-2.5" />, color: "bg-rose-500/15 text-rose-300 border-rose-500/20" },
  };
  const e = map[type] ?? { label: type, icon: <Info className="h-2.5 w-2.5" />, color: "bg-slate-600/30 text-slate-400 border-slate-500/20" };
  return (
    <Badge className={`${e.color} text-[10px] px-1.5 py-0 flex items-center gap-1 w-fit`}>
      {e.icon}{e.label}
    </Badge>
  );
}

function AuditEventRow({ event }: { event: SaleAuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = event.fieldChanges && event.fieldChanges.length > 0;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${
      event.riskLevel === "flag"
        ? "border-red-500/25 bg-red-500/5"
        : event.riskLevel === "watch"
          ? "border-amber-500/20 bg-amber-500/5"
          : "border-white/5 bg-slate-800/40"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-wrap">
          <EventTypeBadge type={event.eventType} />
          <RiskBadge risk={event.riskLevel} />
          <span className="text-xs text-slate-400">{event.description || `Sale: ${event.transactionId?.slice(0, 8) ?? "—"}…`}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-slate-500">{fmtDate(event.createdAt)}</span>
          <span className="text-[11px] text-slate-500">{event.actorName || "—"}</span>
          {hasChanges && (
            <button
              className="text-slate-500 hover:text-slate-300"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {expanded && hasChanges && (
        <div className="mt-2 border-t border-white/5 pt-2 space-y-1">
          <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-1">
            <span>Field</span><span>Before</span><span>After</span>
          </div>
          {event.fieldChanges!.map((fc, i) => {
            const isRate = fc.field.toLowerCase().includes("rate");
            const oldVal = fc.oldValue;
            const newVal = fc.newValue;
            const beforeStr = typeof oldVal === "number"
              ? (isRate ? `₹${oldVal}` : String(oldVal))
              : (oldVal ?? "—");
            const afterStr = typeof newVal === "number"
              ? (isRate ? `₹${newVal}` : String(newVal))
              : (newVal ?? "—");
            const pctChange = typeof oldVal === "number" && typeof newVal === "number" && oldVal !== 0
              ? ((newVal - oldVal) / Math.abs(oldVal)) * 100
              : null;
            return (
              <div key={i} className="grid grid-cols-3 gap-2 text-xs">
                <span className="text-slate-400 font-mono">{fc.field}</span>
                <span className="text-rose-300/80 font-mono">{String(beforeStr)}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-300/80 font-mono">{String(afterStr)}</span>
                  {pctChange !== null && (
                    <span className={`text-[10px] font-medium ${pctChange > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      ({pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SaleAuditTimeline({ saleId }: { saleId: string }) {
  const { data, isLoading } = useListSaleAuditLog(saleId);

  if (isLoading) return <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;

  const events: SaleAuditEvent[] = (data as unknown as { events?: SaleAuditEvent[] })?.events ?? [];

  if (!events.length) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No audit events yet for this sale.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <AuditEventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function GovernanceAlertsPanel() {
  const { data, isLoading } = useGetSaleGovernanceAlerts(
    {},
    { query: { queryKey: getGetSaleGovernanceAlertsQueryKey({}) } },
  );

  if (isLoading) {
    return (
      <Card className="bg-slate-800/60 border-white/10">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400" /> Governance Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        </CardContent>
      </Card>
    );
  }

  const alerts = data as SaleGovernanceAlerts | undefined;
  const allEvents: SaleAuditEvent[] = alerts?.events ?? [];
  const flagged = allEvents.filter((e) => e.riskLevel === "flag");
  const watched = allEvents.filter((e) => e.riskLevel === "watch");
  const totalAlerts = alerts?.totalCount ?? 0;

  function AlertRow({ event, borderColor, bgColor, textColor }: {
    event: SaleAuditEvent;
    borderColor: string;
    bgColor: string;
    textColor: string;
  }) {
    return (
      <div className={`${bgColor} border ${borderColor} rounded-lg px-3 py-2`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className={`text-xs font-mono ${textColor}`}>{event.saleNumber}</span>
            <div className="text-[11px] text-slate-400 mt-0.5">{event.description}</div>
            {event.riskReason && (
              <div className="text-[11px] text-slate-500 mt-0.5">{event.riskReason}</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] text-slate-500">{fmtShort(event.createdAt)}</div>
            <div className="text-[11px] text-slate-500">{event.actorName}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="bg-slate-800/60 border-white/10">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400" />
            Governance Alerts
          </CardTitle>
          {totalAlerts === 0 ? (
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/20 text-xs">
              <ShieldCheck className="h-3 w-3 mr-1" /> All clear
            </Badge>
          ) : (
            <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-xs">
              {totalAlerts} issue{totalAlerts !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {totalAlerts === 0 && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-40 text-emerald-500" />
            No suspicious edits detected across all sales.
          </div>
        )}

        {flagged.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
              <span className="text-xs font-semibold text-red-300 uppercase tracking-wider">
                Flagged — High Risk ({flagged.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {flagged.map((e) => (
                <AlertRow
                  key={e.id}
                  event={e}
                  borderColor="border-red-500/20"
                  bgColor="bg-red-500/5"
                  textColor="text-red-200"
                />
              ))}
            </div>
          </div>
        )}

        {watched.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                Watch — Moderate Risk ({watched.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {watched.map((e) => (
                <AlertRow
                  key={e.id}
                  event={e}
                  borderColor="border-amber-500/20"
                  bgColor="bg-amber-500/5"
                  textColor="text-amber-200"
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SalesAudit() {
  const { role } = useRole();
  const canView = role === "admin" || role === "developer";

  const { data: salesData } = useListSales({});
  const sales = (salesData as unknown as { transactions?: Array<{ id: string; saleNumber: string; status: string }> })?.transactions ?? [];

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  if (!canView) {
    return (
      <div className="p-6 text-center text-slate-500 text-sm">
        You don't have access to the Sales Audit module.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ScrollText className="h-6 w-6 text-sky-400" />
            Sales Audit
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track edit history, quantity/rate changes, and governance flags across all sales.
          </p>
        </div>
        <Link href="/sales">
          <Button variant="outline" size="sm" className="border-white/10 text-slate-400 hover:text-slate-200 text-xs">
            ← Back to Sales
          </Button>
        </Link>
      </div>

      {/* Governance Alerts */}
      <GovernanceAlertsPanel />

      {/* Per-Sale Audit Timeline */}
      <Card className="bg-slate-800/60 border-white/10">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Clock className="h-4 w-4 text-sky-400" />
              Sale Audit Timeline
            </CardTitle>
            <div className="w-72">
              <Select
                value={selectedSaleId ?? ""}
                onValueChange={(v) => setSelectedSaleId(v || null)}
              >
                <SelectTrigger className="h-8 text-xs bg-slate-800 border-slate-600">
                  <SelectValue placeholder="Select a sale to inspect…" />
                </SelectTrigger>
                <SelectContent>
                  {sales.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      <span className="font-mono">{s.saleNumber}</span>
                      <span className="text-slate-500 ml-2 capitalize">({s.status})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {!selectedSaleId ? (
            <div className="text-center py-10 text-slate-500 text-sm">
              <ArrowUpDown className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Select a sale above to view its full edit history.
            </div>
          ) : (
            <SaleAuditTimeline saleId={selectedSaleId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
