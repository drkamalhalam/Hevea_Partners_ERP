import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListOwnershipSnapshots,
  useGetOwnershipSnapshot,
  useListProjects,
  getListOwnershipSnapshotsQueryKey,
  getGetOwnershipSnapshotQueryKey,
} from "@workspace/api-client-react";
import type {
  OwnershipSnapshot,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  History,
  Landmark,
  TrendingUp,
  TrendingDown,
  Eye,
  RefreshCw,
  Layers,
  Star,
  Archive,
  Info,
  Users,
  CalendarDays,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OwnershipPartnerEntry {
  partnerKey: string;
  partnerId: string | null;
  partnerName: string;
  landAmount: number;
  economicAmount: number;
  totalAmount: number;
  percentage: number;
}

// ── Colour palette ────────────────────────────────────────────────────────────

const PARTNER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#ec4899", "#14b8a6",
  "#f97316", "#6366f1",
];

function partnerColor(idx: number) {
  return PARTNER_COLORS[idx % PARTNER_COLORS.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function longDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Snapshot type meta ────────────────────────────────────────────────────────

const SNAPSHOT_TYPE_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string; bg: string; description: string }
> = {
  manual: {
    label: "Manual",
    icon: Camera,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-100 dark:bg-blue-900/40",
    description: "Saved manually by an admin or developer",
  },
  auto_on_verification: {
    label: "Auto",
    icon: RefreshCw,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    description: "Automatically taken when a contribution was verified",
  },
  maturity_declaration: {
    label: "Maturity Declaration",
    icon: Star,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-100 dark:bg-amber-900/40",
    description: "Taken as part of the maturity declaration workflow",
  },
  maturity_preview: {
    label: "Maturity Preview",
    icon: Eye,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-100 dark:bg-purple-900/40",
    description: "Preview snapshot generated before maturity freeze",
  },
};

function getTypeMeta(type: string) {
  return SNAPSHOT_TYPE_META[type] ?? {
    label: type,
    icon: Layers,
    color: "text-muted-foreground",
    bg: "bg-muted",
    description: "Ownership snapshot",
  };
}

// ── Snapshot type badge ───────────────────────────────────────────────────────

function SnapshotTypeBadge({ type }: { type: string }) {
  const meta = getTypeMeta(type);
  const Icon = meta.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
            meta.bg,
            meta.color,
          )}
        >
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{meta.description}</TooltipContent>
    </Tooltip>
  );
}

// ── Lifecycle badge ───────────────────────────────────────────────────────────

function LifecycleBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    prematurity: { label: "Prematurity", color: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
    mature_production: { label: "Mature Production", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    closed: { label: "Closed", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  };
  const m = map[status] ?? { label: status, color: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", m.color)}>
      {m.label}
    </span>
  );
}

// ── Mini pie chart ────────────────────────────────────────────────────────────

function MiniPieChart({ entries }: { entries: OwnershipPartnerEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-xs">
        No partner data
      </div>
    );
  }
  const data = entries.map((e) => ({ name: e.partnerName, value: e.percentage }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={40}
          outerRadius={65}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((_, idx) => (
            <Cell key={idx} fill={partnerColor(idx)} stroke="transparent" />
          ))}
        </Pie>
        <ReTooltip
          formatter={(v: number) => [`${v.toFixed(2)}%`, "Ownership"]}
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 11,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Snapshot preview panel ────────────────────────────────────────────────────

function OwnershipSnapshotPreview({ snapshot }: { snapshot: OwnershipSnapshot }) {
  const entries = (snapshot.entries ?? []) as OwnershipPartnerEntry[];
  const top = entries[0];

  return (
    <div className="border-t bg-muted/20">
      <div className="p-4 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Snapshot Detail
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <SnapshotTypeBadge type={snapshot.snapshotType} />
              <LifecycleBadge status={snapshot.lifecycleStatus} />
              {snapshot.triggeredByName && (
                <span className="text-xs text-muted-foreground">
                  by {snapshot.triggeredByName}
                </span>
              )}
            </div>
            {snapshot.notes && (
              <p className="text-xs text-muted-foreground italic mt-1">
                "{snapshot.notes}"
              </p>
            )}
          </div>

          {/* KPIs */}
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-xs text-muted-foreground">Partners</p>
              <p className="text-lg font-semibold">{entries.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center justify-end gap-0.5">
                <Landmark className="w-3 h-3" /> Land
              </p>
              <p className="text-sm font-medium tabular-nums">{formatINR(snapshot.landTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground flex items-center justify-end gap-0.5">
                <TrendingUp className="w-3 h-3" /> Economic
              </p>
              <p className="text-sm font-medium tabular-nums">{formatINR(snapshot.economicTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-sm font-bold tabular-nums">{formatINR(snapshot.totalRecognizedAmount)}</p>
            </div>
          </div>
        </div>

        {/* Pie + table layout */}
        <div className="grid grid-cols-[160px_1fr] gap-6 items-start">
          <div>
            <MiniPieChart entries={entries} />
            {/* Legend */}
            <div className="space-y-1 mt-1">
              {entries.map((e, idx) => (
                <div key={e.partnerKey} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: partnerColor(idx) }}
                  />
                  <span className="truncate font-medium">{e.partnerName}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {formatPct(e.percentage)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            {entries.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No partner entries in this snapshot
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">
                      <span className="flex items-center justify-end gap-1">
                        <Landmark className="w-3 h-3" /> Land
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="flex items-center justify-end gap-1">
                        <TrendingUp className="w-3 h-3" /> Economic
                      </span>
                    </TableHead>
                    <TableHead className="text-right font-semibold">Total</TableHead>
                    <TableHead className="text-right font-semibold">Ownership %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e, idx) => (
                    <TableRow key={e.partnerKey}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ background: partnerColor(idx) }}
                          />
                          <span className="font-medium text-sm">{e.partnerName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {e.landAmount > 0 ? formatINR(e.landAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {e.economicAmount > 0 ? formatINR(e.economicAmount) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-sm">
                        {formatINR(e.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${e.percentage}%`,
                                background: partnerColor(idx),
                              }}
                            />
                          </div>
                          <span className="tabular-nums font-semibold text-sm w-14 text-right">
                            {formatPct(e.percentage)}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {entries.length > 0 && (
                    <TableRow className="border-t-2 bg-muted/30">
                      <TableCell className="font-semibold text-sm">Total</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-sm">
                        {formatINR(snapshot.landTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-sm">
                        {formatINR(snapshot.economicTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-sm">
                        {formatINR(snapshot.totalRecognizedAmount)}
                      </TableCell>
                      <TableCell className="text-right font-bold text-sm">100.00%</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </div>

        {/* Prematurity guidance note */}
        <div className="flex items-start gap-2 p-2.5 rounded-md border bg-blue-50/60 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            This is a historical ownership record. Percentages are prematurity guidance only and were
            not legally binding at the time of capture unless associated with a maturity declaration.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Snapshot diff types ───────────────────────────────────────────────────────

interface PartnerDiff {
  partnerKey: string;
  partnerName: string;
  prevPct: number | null;
  currPct: number | null;
  pctDelta: number | null;
  status: "new" | "removed" | "changed" | "same";
}

function computeSnapshotDiff(
  curr: OwnershipPartnerEntry[],
  prev: OwnershipPartnerEntry[],
): PartnerDiff[] {
  const prevMap = new Map(prev.map((e) => [e.partnerKey, e]));
  const currMap = new Map(curr.map((e) => [e.partnerKey, e]));
  const allKeys = new Set([...currMap.keys(), ...prevMap.keys()]);

  return Array.from(allKeys)
    .map((key): PartnerDiff => {
      const c = currMap.get(key);
      const p = prevMap.get(key);
      const pctDelta = c && p ? c.percentage - p.percentage : null;
      let status: PartnerDiff["status"];
      if (!p) status = "new";
      else if (!c) status = "removed";
      else if (pctDelta !== null && Math.abs(pctDelta) >= 0.001) status = "changed";
      else status = "same";
      return {
        partnerKey: key,
        partnerName: c?.partnerName ?? p?.partnerName ?? key,
        prevPct: p?.percentage ?? null,
        currPct: c?.percentage ?? null,
        pctDelta,
        status,
      };
    })
    .sort((a, b) => {
      const order: Record<string, number> = { new: 0, removed: 1, changed: 2, same: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    });
}

// ── Snapshot diff panel ───────────────────────────────────────────────────────

function SnapshotDiffPanel({
  curr,
  prev,
}: {
  curr: OwnershipPartnerEntry[];
  prev: OwnershipPartnerEntry[];
}) {
  const diffs = computeSnapshotDiff(curr, prev);
  const hasChanges = diffs.some((d) => d.status !== "same");
  const currTotal = curr.reduce((s, e) => s + e.totalAmount, 0);
  const prevTotal = prev.reduce((s, e) => s + e.totalAmount, 0);
  const totalDelta = currTotal - prevTotal;

  return (
    <div className="border-t">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Changes vs Previous Snapshot
        </span>
        {!hasChanges && (
          <Badge variant="secondary" className="text-[10px] ml-auto">No changes</Badge>
        )}
        {hasChanges && totalDelta !== 0 && (
          <span
            className={cn(
              "ml-auto text-xs font-semibold tabular-nums",
              totalDelta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}
          >
            {totalDelta > 0 ? "+" : ""}
            {formatINR(totalDelta)}
          </span>
        )}
      </div>
      {hasChanges && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="text-left p-2 pl-3 font-medium text-muted-foreground">Partner</th>
                <th className="text-right p-2 font-medium text-muted-foreground">Previous %</th>
                <th className="text-right p-2 font-medium text-muted-foreground">Current %</th>
                <th className="text-right p-2 pr-3 font-medium text-muted-foreground">Change</th>
              </tr>
            </thead>
            <tbody>
              {diffs
                .filter((d) => d.status !== "same")
                .map((d) => (
                  <tr
                    key={d.partnerKey}
                    className={cn(
                      "border-b last:border-0",
                      d.status === "new" && "bg-emerald-50/50 dark:bg-emerald-950/20",
                      d.status === "removed" && "bg-red-50/50 dark:bg-red-950/20",
                    )}
                  >
                    <td className="p-2 pl-3 font-medium">
                      <span className="flex items-center gap-1.5">
                        {d.status === "new" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-4 px-1 border-emerald-400 text-emerald-700 dark:text-emerald-400"
                          >
                            New
                          </Badge>
                        )}
                        {d.status === "removed" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-4 px-1 border-red-400 text-red-700 dark:text-red-400"
                          >
                            Removed
                          </Badge>
                        )}
                        {d.partnerName}
                      </span>
                    </td>
                    <td className="p-2 text-right tabular-nums text-muted-foreground">
                      {d.prevPct !== null ? formatPct(d.prevPct) : "—"}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {d.currPct !== null ? formatPct(d.currPct) : "—"}
                    </td>
                    <td className="p-2 pr-3 text-right tabular-nums">
                      {d.pctDelta !== null ? (
                        <span
                          className={cn(
                            "inline-flex items-center justify-end gap-0.5",
                            d.pctDelta > 0.001 && "text-emerald-600 dark:text-emerald-400",
                            d.pctDelta < -0.001 && "text-red-600 dark:text-red-400",
                          )}
                        >
                          {d.pctDelta > 0.001 && <TrendingUp className="w-3 h-3" />}
                          {d.pctDelta < -0.001 && <TrendingDown className="w-3 h-3" />}
                          {d.pctDelta > 0 ? "+" : ""}
                          {d.pctDelta.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Timeline row ──────────────────────────────────────────────────────────────

function TimelineRow({
  snapshot,
  projectId,
  isLast,
  index,
  prevSnapshot,
}: {
  snapshot: OwnershipSnapshot;
  projectId: string;
  isLast: boolean;
  index: number;
  prevSnapshot?: OwnershipSnapshot;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = getTypeMeta(snapshot.snapshotType);
  const Icon = meta.icon;
  const entries = (snapshot.entries ?? []) as OwnershipPartnerEntry[];
  const top = entries[0];

  // Lazy-load the full snapshot when expanded (uses the single-snapshot endpoint)
  const detailQuery = useGetOwnershipSnapshot(projectId, snapshot.id, {
    query: {
      queryKey: getGetOwnershipSnapshotQueryKey(projectId, snapshot.id),
      enabled: expanded,
    },
  });

  return (
    <div className="relative">
      {/* Vertical track line */}
      {!isLast && (
        <div className="absolute left-[23px] top-10 bottom-0 w-px bg-border" />
      )}

      {/* Row header */}
      <div
        className={cn(
          "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors",
          expanded
            ? "bg-muted/50"
            : "hover:bg-muted/30",
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Type icon node */}
        <div
          className={cn(
            "shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 border-background z-10",
            meta.bg,
          )}
        >
          <Icon className={cn("w-4 h-4", meta.color)} />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{shortDate(snapshot.snapshotAt)}</span>
            <SnapshotTypeBadge type={snapshot.snapshotType} />
            <LifecycleBadge status={snapshot.lifecycleStatus} />
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {entries.length} partner{entries.length !== 1 ? "s" : ""}
            </span>
            <span className="tabular-nums font-medium text-foreground">
              {formatINR(snapshot.totalRecognizedAmount)}
            </span>
            {top && (
              <span>
                Top: {top.partnerName} ({formatPct(top.percentage)})
              </span>
            )}
            {snapshot.triggeredByName && (
              <span>by {snapshot.triggeredByName}</span>
            )}
            {snapshot.notes && (
              <span className="italic truncate max-w-[200px]">"{snapshot.notes}"</span>
            )}
          </div>
        </div>

        {/* Sequence number + expand toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">#{index + 1}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="ml-[52px] mb-2 rounded-lg border overflow-hidden">
          {detailQuery.isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
          ) : detailQuery.data ? (
            <>
              <OwnershipSnapshotPreview snapshot={detailQuery.data} />
              {prevSnapshot && (
                <SnapshotDiffPanel
                  curr={(snapshot.entries ?? []) as OwnershipPartnerEntry[]}
                  prev={(prevSnapshot.entries ?? []) as OwnershipPartnerEntry[]}
                />
              )}
            </>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Could not load snapshot detail.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ownership timeline ────────────────────────────────────────────────────────

function OwnershipTimeline({
  snapshots,
  projectId,
}: {
  snapshots: OwnershipSnapshot[];
  projectId: string;
}) {
  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-3">
        <Archive className="w-10 h-10 opacity-20" />
        <div className="text-center">
          <p className="font-medium text-sm">No snapshots recorded yet</p>
          <p className="text-xs mt-1">
            Use "Save Snapshot" in Ownership Guidance to record the current state.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {snapshots.map((s, idx) => (
        <TimelineRow
          key={s.id}
          snapshot={s}
          projectId={projectId}
          isLast={idx === snapshots.length - 1}
          index={idx}
          prevSnapshot={snapshots[idx + 1]}
        />
      ))}
    </div>
  );
}

// ── Placeholder section: future maturity archive ──────────────────────────────

function MaturityArchivePlaceholder() {
  return (
    <Card className="border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10">
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40">
            <Star className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm">Maturity Ownership Record</h3>
            <p className="text-xs text-muted-foreground mt-1">
              When a project transitions to <strong>Mature Production</strong>, a
              permanent, legally-relevant ownership record will be generated here via
              the maturity declaration workflow. This record will capture the final
              verified ownership split at the point of freeze and serve as the
              authoritative reference for revenue distribution.
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                <Eye className="w-3 h-3" /> Maturity Preview snapshots
              </Badge>
              <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                <Star className="w-3 h-3" /> Maturity Declaration record
              </Badge>
              <Badge variant="outline" className="text-xs gap-1 border-amber-400 text-amber-700 dark:text-amber-400">
                <History className="w-3 h-3" /> Freeze audit trail
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-2 italic">
              Foundation structure in place — freeze workflow not yet active.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OwnershipArchive() {
  const { role } = useRole();
  const isAdminOrDev = role === "admin" || role === "developer";

  const projectsQuery = useListProjects();
  const projects = (projectsQuery.data ?? []) as Array<{ id: string; name: string; lifecycleStatus?: string }>;

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const effectiveProjectId = selectedProjectId ?? projects[0]?.id ?? null;

  const snapshotsQuery = useListOwnershipSnapshots(
    effectiveProjectId ?? "",
    { limit: 100 },
    {
      query: {
        queryKey: getListOwnershipSnapshotsQueryKey(effectiveProjectId ?? ""),
        enabled: !!effectiveProjectId,
      },
    },
  );

  const snapshots = snapshotsQuery.data?.snapshots ?? [];

  // KPIs
  const latestSnap = snapshots[0];
  const snapshotTypes = new Set(snapshots.map((s) => s.snapshotType));
  const maturityPreviewCount = snapshots.filter(
    (s) => s.snapshotType === "maturity_preview",
  ).length;

  const selectedProject = projects.find((p) => p.id === effectiveProjectId);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Archive className="w-6 h-6" />
            Ownership Record Archive
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Historical point-in-time ownership snapshots across all project phases.
            Foundation for the future maturity freeze and ownership record generation.
          </p>
        </div>
      </div>

      {/* Project selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium shrink-0">Project</label>
        {projectsQuery.isLoading ? (
          <div className="h-9 w-48 rounded-md border bg-muted animate-pulse" />
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects available.</p>
        ) : (
          <Select
            value={effectiveProjectId ?? ""}
            onValueChange={(v) => setSelectedProjectId(v)}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select a project…" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {effectiveProjectId && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total Snapshots
                </p>
                <p className="text-3xl font-bold mt-1">{snapshots.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {snapshotTypes.size} type{snapshotTypes.size !== 1 ? "s" : ""}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" /> Latest Snapshot
                </p>
                {latestSnap ? (
                  <>
                    <p className="text-sm font-semibold mt-1">{shortDate(latestSnap.snapshotAt)}</p>
                    <SnapshotTypeBadge type={latestSnap.snapshotType} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">No snapshots yet</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Latest Total
                </p>
                {latestSnap ? (
                  <>
                    <p className="text-lg font-semibold mt-1 tabular-nums">
                      {formatINR(latestSnap.totalRecognizedAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(latestSnap.entries as OwnershipPartnerEntry[]).length} partners
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">—</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Maturity Previews
                </p>
                <p className="text-3xl font-bold mt-1">{maturityPreviewCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {maturityPreviewCount === 0
                    ? "None recorded yet"
                    : "pre-freeze records"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Maturity archive placeholder */}
          <MaturityArchivePlaceholder />

          {/* Timeline card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <History className="w-4 h-4" />
                    Snapshot Timeline
                    {snapshots.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {snapshots.length}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Newest first — click any row to expand the full partner breakdown
                  </CardDescription>
                </div>
                {isAdminOrDev && (
                  <a href="/ownership" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                    Go to Ownership Guidance →
                  </a>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {snapshotsQuery.isLoading ? (
                <div className="space-y-3 py-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : (
                <OwnershipTimeline
                  snapshots={snapshots}
                  projectId={effectiveProjectId}
                />
              )}
            </CardContent>
          </Card>

          {/* Snapshot type legend */}
          {snapshots.length > 0 && (
            <Card className="bg-muted/30">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Snapshot Type Reference
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(SNAPSHOT_TYPE_META).map(([type, meta]) => {
                    const Icon = meta.icon;
                    return (
                      <div key={type} className="flex items-start gap-2">
                        <span className={cn("p-1 rounded", meta.bg)}>
                          <Icon className={cn("w-3.5 h-3.5", meta.color)} />
                        </span>
                        <div>
                          <p className="text-xs font-medium">{meta.label}</p>
                          <p className="text-xs text-muted-foreground">{meta.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
