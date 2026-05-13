import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import {
  useGetOwnershipSummary,
  useGetProjectOwnership,
  useListOwnershipSnapshots,
  useCreateOwnershipSnapshot,
  getGetOwnershipSummaryQueryKey,
  getGetProjectOwnershipQueryKey,
  getListOwnershipSnapshotsQueryKey,
} from "@workspace/api-client-react";
import type {
  ProjectOwnershipDetail,
  OwnershipPartnerEntry,
  OwnershipSnapshot,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Scale,
  Camera,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  Info,
  TrendingUp,
  Landmark,
  Lock,
  RefreshCw,
  History,
  BarChart3,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Colour palette for chart slices ───────────────────────────────────────────

const PARTNER_COLORS = [
  "#3b82f6", // blue-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#8b5cf6", // violet-500
  "#ef4444", // red-500
  "#06b6d4", // cyan-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
];

function partnerColor(index: number) {
  return PARTNER_COLORS[index % PARTNER_COLORS.length];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Ownership pie chart ────────────────────────────────────────────────────────

function OwnershipPieChart({ entries }: { entries: OwnershipPartnerEntry[] }) {
  const [active, setActive] = useState<number | null>(null);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <Scale className="w-8 h-8 opacity-30" />
        <p>No verified contributions yet</p>
      </div>
    );
  }

  const data = entries.map((e) => ({ name: e.partnerName, value: e.percentage }));

  return (
    <div className="flex flex-col items-center gap-4">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            onMouseEnter={(_, idx) => setActive(idx)}
            onMouseLeave={() => setActive(null)}
          >
            {data.map((_, idx) => (
              <Cell
                key={idx}
                fill={partnerColor(idx)}
                opacity={active === null || active === idx ? 1 : 0.5}
                stroke="transparent"
              />
            ))}
          </Pie>
          <ReTooltip
            formatter={(v: number) => [`${v.toFixed(2)}%`, "Ownership"]}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center">
        {entries.map((e, idx) => (
          <div key={e.partnerKey} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: partnerColor(idx) }} />
            <span className="font-medium">{e.partnerName}</span>
            <span className="text-muted-foreground">{formatPct(e.percentage)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Ownership trend chart (snapshots) ─────────────────────────────────────────

function OwnershipTrendChart({ snapshots }: { snapshots: OwnershipSnapshot[] }) {
  if (snapshots.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <History className="w-8 h-8 opacity-30" />
        <p>Save at least 2 snapshots to see the ownership trend</p>
      </div>
    );
  }

  // Build time-series data — one row per snapshot, columns = unique partner names
  const allPartnerKeys = new Set<string>();
  const partnerNames = new Map<string, string>();
  for (const s of snapshots) {
    for (const e of (s.entries as OwnershipPartnerEntry[])) {
      allPartnerKeys.add(e.partnerKey);
      partnerNames.set(e.partnerKey, e.partnerName);
    }
  }

  const sortedSnaps = [...snapshots].reverse();
  const chartData = sortedSnaps.map((s) => {
    const row: Record<string, unknown> = {
      date: shortDate(s.snapshotAt),
    };
    const entryMap = new Map(
      (s.entries as OwnershipPartnerEntry[]).map((e) => [e.partnerKey, e.percentage]),
    );
    for (const key of allPartnerKeys) {
      row[key] = entryMap.get(key) ?? 0;
    }
    return row;
  });

  const keys = [...allPartnerKeys];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
        <ReTooltip
          formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, partnerNames.get(name) ?? name]}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
        />
        <Legend formatter={(v) => partnerNames.get(v) ?? v} />
        {keys.map((key, idx) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stackId="1"
            stroke={partnerColor(idx)}
            fill={partnerColor(idx)}
            fillOpacity={0.25}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Snapshot Save Dialog ───────────────────────────────────────────────────────

function SaveSnapshotDialog({
  projectId,
  projectName,
  onClose,
  onSaved,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const mutation = useCreateOwnershipSnapshot();

  const handleSave = async () => {
    setError("");
    try {
      await mutation.mutateAsync({
        projectId,
        data: { notes: notes || undefined },
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? "Failed to save snapshot");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600" />
            Save Ownership Snapshot
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            Saves the current live ownership calculation for <strong>{projectName}</strong> as an immutable point-in-time record. This is for monitoring only — ownership is not frozen.
          </p>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Month-end review, Q1 2026…" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save Snapshot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Contribution breakdown table ───────────────────────────────────────────────

function ContributionBreakdown({ entries, landTotal, economicTotal, totalRecognizedAmount }: {
  entries: OwnershipPartnerEntry[];
  landTotal: number;
  economicTotal: number;
  totalRecognizedAmount: number;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Partner</TableHead>
          <TableHead className="text-right">
            <span className="flex items-center justify-end gap-1">
              <Landmark className="w-3.5 h-3.5" />Land
            </span>
          </TableHead>
          <TableHead className="text-right">
            <span className="flex items-center justify-end gap-1">
              <TrendingUp className="w-3.5 h-3.5" />Economic
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
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: partnerColor(idx) }} />
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
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${e.percentage}%`, background: partnerColor(idx) }}
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
            <TableCell className="text-right tabular-nums font-medium text-sm">{formatINR(landTotal)}</TableCell>
            <TableCell className="text-right tabular-nums font-medium text-sm">{formatINR(economicTotal)}</TableCell>
            <TableCell className="text-right tabular-nums font-bold text-sm">{formatINR(totalRecognizedAmount)}</TableCell>
            <TableCell className="text-right font-bold text-sm">100.00%</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

// ── Project detail panel ───────────────────────────────────────────────────────

function ProjectDetail({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const { role } = useRole();
  const isAdminOrDev = role === "admin" || role === "developer";
  const qc = useQueryClient();
  const [saveDialog, setSaveDialog] = useState(false);

  const detailQuery = useGetProjectOwnership(projectId, {
    query: { queryKey: getGetProjectOwnershipQueryKey(projectId) },
  });

  const snapshotsQuery = useListOwnershipSnapshots(
    projectId,
    undefined,
    { query: { queryKey: getListOwnershipSnapshotsQueryKey(projectId) } },
  );

  const detail = detailQuery.data;
  const snapshots = snapshotsQuery.data?.snapshots ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetProjectOwnershipQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getListOwnershipSnapshotsQueryKey(projectId) });
  };

  if (detailQuery.isLoading) {
    return (
      <div className="p-6 text-center text-muted-foreground">Loading…</div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 text-center text-muted-foreground">Not found</div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            {detail.projectName}
            {detail.isFrozen && (
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 text-xs gap-1">
                    <Lock className="w-3 h-3" /> Frozen
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Ownership has been frozen by the maturity declaration workflow</TooltipContent>
              </Tooltip>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Live prematurity ownership guidance · Updated {shortDate(detail.asOf)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: getGetProjectOwnershipQueryKey(projectId) })} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Recalculate
          </Button>
          {isAdminOrDev && (
            <Button size="sm" onClick={() => setSaveDialog(true)} className="gap-1.5">
              <Camera className="w-3.5 h-3.5" /> Save Snapshot
            </Button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Partners</p>
            <p className="text-2xl font-semibold mt-1">{detail.partnerCount}</p>
            <p className="text-xs text-muted-foreground">with recognized contributions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Recognized</p>
            <p className="text-xl font-semibold mt-1 tabular-nums">{formatINR(detail.totalRecognizedAmount)}</p>
            <p className="text-xs text-muted-foreground">land + economic</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Landmark className="w-3 h-3" /> Land Notional
            </p>
            <p className="text-xl font-semibold mt-1 tabular-nums">{formatINR(detail.landTotal)}</p>
            <p className="text-xs text-muted-foreground">
              {detail.totalRecognizedAmount > 0
                ? `${((detail.landTotal / detail.totalRecognizedAmount) * 100).toFixed(1)}% of total`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Economic
            </p>
            <p className="text-xl font-semibold mt-1 tabular-nums">{formatINR(detail.economicTotal)}</p>
            <p className="text-xs text-muted-foreground">
              {detail.totalRecognizedAmount > 0
                ? `${((detail.economicTotal / detail.totalRecognizedAmount) * 100).toFixed(1)}% of total`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Guidance banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-blue-50/60 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-300">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">Prematurity guidance only.</span> These percentages are a real-time approximation based on verified recognized contributions. They are <strong>not legally binding</strong> until the maturity declaration freeze workflow is completed. Only verified land notional and economic investment contributions are included. Operational costs do not affect ownership.
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="breakdown" className="gap-1.5">
            <Users className="w-3.5 h-3.5" /> Contribution Breakdown
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="w-3.5 h-3.5" />
            History
            {snapshots.length > 0 && (
              <Badge className="ml-1 h-4 w-4 rounded-full p-0 justify-center text-xs">
                {snapshots.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Ownership Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <OwnershipPieChart entries={detail.entries} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Partner Rankings</CardTitle>
                <CardDescription className="text-xs">Sorted by ownership % descending</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {detail.entries.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No verified contributions recorded yet.</p>
                )}
                {detail.entries.map((e, idx) => (
                  <div key={e.partnerKey} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-5 text-right">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-sm mb-0.5">
                        <span className="font-medium truncate">{e.partnerName}</span>
                        <span className="tabular-nums font-bold shrink-0 ml-2">{formatPct(e.percentage)}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${e.percentage}%`, background: partnerColor(idx) }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatINR(e.totalAmount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="breakdown" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ContributionBreakdown
                entries={detail.entries}
                landTotal={detail.landTotal}
                economicTotal={detail.economicTotal}
                totalRecognizedAmount={detail.totalRecognizedAmount}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Ownership Trend</CardTitle>
              <CardDescription className="text-xs">
                Stacked area chart of ownership % across saved snapshots
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OwnershipTrendChart snapshots={snapshots} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">Snapshot History</CardTitle>
                  <CardDescription className="text-xs">{snapshots.length} point-in-time records</CardDescription>
                </div>
                {isAdminOrDev && (
                  <Button size="sm" variant="outline" onClick={() => setSaveDialog(true)} className="gap-1.5">
                    <Camera className="w-3.5 h-3.5" /> Save Now
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {snapshots.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-sm">
                  <Camera className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No snapshots saved yet.</p>
                  {isAdminOrDev && (
                    <p className="text-xs mt-1">Use "Save Snapshot" to record the current ownership state.</p>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Partners</TableHead>
                      <TableHead className="text-right">Total Recognized</TableHead>
                      <TableHead>Top Partner</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Saved by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshots.map((s) => {
                      const entries = s.entries as OwnershipPartnerEntry[];
                      const top = entries[0];
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="text-sm">{shortDate(s.snapshotAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">
                              {s.snapshotType.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{entries.length}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{formatINR(s.totalRecognizedAmount)}</TableCell>
                          <TableCell className="text-sm">
                            {top ? (
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ background: partnerColor(0) }} />
                                {top.partnerName} ({formatPct(top.percentage)})
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                            {s.notes ?? "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {s.triggeredByName ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {saveDialog && (
        <SaveSnapshotDialog
          projectId={projectId}
          projectName={detail.projectName}
          onClose={() => setSaveDialog(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

// ── Project summary card ───────────────────────────────────────────────────────

function ProjectCard({
  detail,
  onClick,
}: {
  detail: ProjectOwnershipDetail;
  onClick: () => void;
}) {
  const hasData = detail.totalRecognizedAmount > 0;
  const top = detail.entries[0];

  return (
    <Card
      className={cn(
        "cursor-pointer hover:shadow-md transition-shadow border",
        detail.isFrozen && "border-amber-300 dark:border-amber-700",
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{detail.projectName}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 capitalize">
              {detail.lifecycleStatus.replace(/_/g, " ")}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {detail.isFrozen && (
              <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400 text-xs gap-1">
                <Lock className="w-3 h-3" /> Frozen
              </Badge>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasData ? (
          <p className="text-xs text-muted-foreground py-2">
            No verified contributions recorded yet.
          </p>
        ) : (
          <>
            {/* Stacked ownership bar */}
            <div className="w-full h-3 rounded-full bg-muted overflow-hidden flex">
              {detail.entries.map((e, idx) => (
                <Tooltip key={e.partnerKey}>
                  <TooltipTrigger asChild>
                    <div
                      className="h-full transition-all"
                      style={{ width: `${e.percentage}%`, background: partnerColor(idx) }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>{e.partnerName}: {formatPct(e.percentage)}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Top 3 partners */}
            <div className="space-y-1">
              {detail.entries.slice(0, 3).map((e, idx) => (
                <div key={e.partnerKey} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: partnerColor(idx) }} />
                    {e.partnerName}
                  </span>
                  <span className="font-semibold tabular-nums">{formatPct(e.percentage)}</span>
                </div>
              ))}
              {detail.partnerCount > 3 && (
                <p className="text-xs text-muted-foreground">+{detail.partnerCount - 3} more</p>
              )}
            </div>

            <div className="pt-1 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatINR(detail.totalRecognizedAmount)} recognized</span>
              <span>{detail.partnerCount} partner{detail.partnerCount !== 1 ? "s" : ""}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OwnershipGuidance() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const summaryQuery = useGetOwnershipSummary(
    selectedProjectId ? { projectId: selectedProjectId } : {},
    { query: { queryKey: getGetOwnershipSummaryQueryKey(selectedProjectId ? { projectId: selectedProjectId } : {}) } },
  );

  const projects = summaryQuery.data?.projects ?? [];
  const isLoading = summaryQuery.isLoading;

  // KPI aggregates
  const totalRecognized = projects.reduce((s, p) => s + p.totalRecognizedAmount, 0);
  const frozenCount = projects.filter((p) => p.isFrozen).length;
  const projectsWithData = projects.filter((p) => p.totalRecognizedAmount > 0).length;

  if (selectedProject) {
    return <ProjectDetail projectId={selectedProject} onBack={() => setSelectedProject(null)} />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Scale className="w-6 h-6 text-blue-600" />
          Ownership Guidance
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Dynamic prematurity ownership approximation based on verified recognized contributions.
          Not legally binding — ownership freezes at the maturity declaration stage.
        </p>
      </div>

      {/* Disclaimer banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-amber-50/60 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">Guidance only — not a legal determination.</span> These calculations reflect verified contributions at this point in time. Ownership structure is formally locked only after the maturity declaration workflow. Operational costs are excluded by design.
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Projects</p>
            <p className="text-2xl font-semibold mt-1">{projects.length}</p>
            <p className="text-xs text-muted-foreground">active with ownership data</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">With Contributions</p>
            <p className={cn("text-2xl font-semibold mt-1", projectsWithData === 0 && "text-muted-foreground")}>
              {projectsWithData}
            </p>
            <p className="text-xs text-muted-foreground">have verified recognized entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Recognized</p>
            <p className="text-xl font-semibold mt-1 tabular-nums text-blue-600 dark:text-blue-400">
              {formatINR(totalRecognized)}
            </p>
            <p className="text-xs text-muted-foreground">across all projects</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Frozen</p>
            <p className={cn("text-2xl font-semibold mt-1", frozenCount > 0 && "text-amber-600 dark:text-amber-400")}>
              {frozenCount}
            </p>
            <p className="text-xs text-muted-foreground">ownership structure locked</p>
          </CardContent>
        </Card>
      </div>

      {/* Project grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse h-36" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <Scale className="w-10 h-10 mx-auto text-muted-foreground/30" />
            <p className="font-medium">No projects visible</p>
            <p className="text-sm text-muted-foreground">Projects with verified land notional or economic investment contributions will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard
              key={p.projectId}
              detail={p}
              onClick={() => setSelectedProject(p.projectId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
