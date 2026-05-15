/**
 * SnapshotArchive.tsx
 *
 * Historical Record Snapshot Preservation System.
 *
 * Provides four tools for working with the immutable snapshot archive:
 *   Archive     — browse and search all stored snapshots
 *   Compare     — pick any two snapshots and view a structured diff
 *   Timeline    — select an entity to see its full change history
 *   Restore Preview — compare a historical snapshot against current state
 *
 * All snapshots are write-once and immutable. This page never mutates data
 * except for triggering new capture via POST /api/snapshots/capture.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListProjects } from "@workspace/api-client-react";
import { useRole } from "../contexts/RoleContext";
import {
  Archive,
  Camera,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  FileText,
  GitCompare,
  History as HistoryIcon,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Snapshot {
  id: string;
  snapshotType: string;
  entityId: string | null;
  entityType: string;
  projectId: string | null;
  projectName: string | null;
  label: string | null;
  notes: string | null;
  triggerType: string;
  capturedByName: string | null;
  capturedByRole: string | null;
  createdAt: string;
}

interface SnapshotFull extends Snapshot {
  snapshotData: Record<string, unknown>;
}

interface DiffNode {
  type: "changed" | "added" | "removed";
  path: string;
  before?: unknown;
  after?: unknown;
  value?: unknown;
}

interface CompareResult {
  a: SnapshotFull;
  b: SnapshotFull;
  diff: DiffNode[];
  diffCount: { added: number; removed: number; changed: number };
}

interface RestorePreviewResult {
  snapshot: SnapshotFull;
  currentState: Record<string, unknown>;
  diff: DiffNode[];
  diffCount: { added: number; removed: number; changed: number };
  hasDifferences: boolean;
}

interface TimelineSnapshot extends SnapshotFull {
  diffFromPrevious: DiffNode[] | null;
  diffCount: { added: number; removed: number; changed: number } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const SNAPSHOT_TYPES = [
  { value: "ownership_state", label: "Ownership State", icon: Shield, color: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800/30" },
  { value: "agreement", label: "Agreement", icon: FileText, color: "text-blue-400", bg: "bg-blue-950/40 border-blue-800/30" },
  { value: "settlement_session", label: "Settlement Session", icon: TrendingUp, color: "text-purple-400", bg: "bg-purple-950/40 border-purple-800/30" },
  { value: "distribution_preview", label: "Distribution Preview", icon: Database, color: "text-yellow-400", bg: "bg-yellow-950/40 border-yellow-800/30" },
  { value: "financial_position", label: "Financial Position", icon: TrendingUp, color: "text-orange-400", bg: "bg-orange-950/40 border-orange-800/30" },
  { value: "lca_position", label: "LCA Position", icon: Archive, color: "text-cyan-400", bg: "bg-cyan-950/40 border-cyan-800/30" },
];

const TYPE_ENTITY_LABEL: Record<string, string> = {
  ownership_state: "Project ID",
  agreement: "Agreement ID",
  settlement_session: "Session ID",
  distribution_preview: "Preview ID",
  financial_position: "Project ID",
  lca_position: "Project ID",
};

const TYPE_ENTITY_TABLE: Record<string, string> = {
  ownership_state: "partner_ownership_states",
  agreement: "agreements",
  settlement_session: "fifty_pct_sessions",
  distribution_preview: "distribution_previews",
  financial_position: "landowner_ledger_entries",
  lca_position: "lca_ledger",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) {
    const h = Math.floor(diff / 3600000);
    if (h === 0) {
      const m = Math.floor(diff / 60000);
      return m <= 1 ? "just now" : `${m}m ago`;
    }
    return `${h}h ago`;
  }
  if (d < 30) return `${d}d ago`;
  return fmtDateTime(iso);
}

function cap(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function typeInfo(t: string) {
  return SNAPSHOT_TYPES.find((s) => s.value === t) ?? {
    value: t,
    label: cap(t),
    icon: Database,
    color: "text-slate-400",
    bg: "bg-slate-800/40 border-slate-700/30",
  };
}

function TypeBadge({ type }: { type: string }) {
  const info = typeInfo(type);
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${info.bg} ${info.color} font-medium`}>
      <info.icon className="h-2.5 w-2.5" />
      {info.label}
    </span>
  );
}

function TriggerBadge({ trigger }: { trigger: string }) {
  const colors: Record<string, string> = {
    manual: "text-slate-400 bg-slate-800 border-slate-600",
    auto_pre_transfer: "text-orange-400 bg-orange-950/40 border-orange-700/40",
    auto_pre_settlement: "text-purple-400 bg-purple-950/40 border-purple-700/40",
    auto_lifecycle: "text-blue-400 bg-blue-950/40 border-blue-700/40",
    auto_maturity: "text-emerald-400 bg-emerald-950/40 border-emerald-700/40",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colors[trigger] ?? "text-slate-400 bg-slate-800 border-slate-600"}`}>
      {cap(trigger)}
    </span>
  );
}

// ── Diff renderer ─────────────────────────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return v.toLocaleString("en-IN");
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}

function DiffLine({ node, mode }: { node: DiffNode; mode: "compare" | "restore" }) {
  const [expanded, setExpanded] = useState(false);
  const isComplex = (v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (node.type === "added") {
    return (
      <div className="flex items-start gap-2 py-1.5 px-2 rounded bg-emerald-950/20 border-l-2 border-emerald-500/50 text-xs">
        <Plus className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-slate-400 font-mono text-[10px]">{node.path}</span>
          <div className="text-emerald-300 font-mono text-[11px] mt-0.5 break-all">
            {isComplex(node.value)
              ? <pre className="whitespace-pre-wrap text-[10px]">{JSON.stringify(node.value, null, 2)}</pre>
              : formatValue(node.value)
            }
          </div>
        </div>
      </div>
    );
  }

  if (node.type === "removed") {
    return (
      <div className="flex items-start gap-2 py-1.5 px-2 rounded bg-red-950/20 border-l-2 border-red-500/50 text-xs">
        <X className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-slate-400 font-mono text-[10px]">{node.path}</span>
          <div className="text-red-300 font-mono text-[11px] mt-0.5 break-all">
            {isComplex(node.value)
              ? <pre className="whitespace-pre-wrap text-[10px]">{JSON.stringify(node.value, null, 2)}</pre>
              : formatValue(node.value)
            }
          </div>
        </div>
      </div>
    );
  }

  // changed
  return (
    <div className="py-1.5 px-2 rounded bg-yellow-950/20 border-l-2 border-yellow-500/50 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <GitCompare className="h-3 w-3 text-yellow-400 shrink-0" />
        <span className="text-slate-400 font-mono text-[10px]">{node.path}</span>
        {(isComplex(node.before) || isComplex(node.after)) && (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
          >
            {expanded ? "collapse" : "expand"}
          </button>
        )}
      </div>
      {expanded || (!isComplex(node.before) && !isComplex(node.after)) ? (
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">{mode === "compare" ? "Snapshot A" : "Snapshot"}</p>
            <p className="text-red-300 font-mono text-[11px] break-all bg-red-950/20 px-1 py-0.5 rounded">
              {formatValue(node.before)}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-slate-600 mb-0.5">{mode === "compare" ? "Snapshot B" : "Current"}</p>
            <p className="text-emerald-300 font-mono text-[11px] break-all bg-emerald-950/20 px-1 py-0.5 rounded">
              {formatValue(node.after)}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-slate-500 text-[10px] italic">Complex object — click expand to view</p>
      )}
    </div>
  );
}

function DiffView({ diff, mode, title }: {
  diff: DiffNode[];
  mode: "compare" | "restore";
  title?: string;
}) {
  const [filter, setFilter] = useState<"all" | "changed" | "added" | "removed">("all");
  const filtered = filter === "all" ? diff : diff.filter((d) => d.type === filter);
  const counts = {
    changed: diff.filter((d) => d.type === "changed").length,
    added: diff.filter((d) => d.type === "added").length,
    removed: diff.filter((d) => d.type === "removed").length,
  };

  if (diff.length === 0) {
    return (
      <div className="text-center py-6">
        <Copy className="h-8 w-8 text-emerald-500/60 mx-auto mb-2" />
        <p className="text-emerald-300 text-sm font-medium">Identical — no differences found</p>
        <p className="text-slate-500 text-xs mt-1">Both snapshots contain exactly the same data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {title && <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{title}</p>}
      <div className="flex flex-wrap gap-2 items-center">
        {(["all", "changed", "added", "removed"] as const).map((f) => {
          const cnt = f === "all" ? diff.length : counts[f];
          const cls = {
            all: filter === "all" ? "bg-slate-700 text-slate-100" : "text-slate-500",
            changed: filter === "changed" ? "bg-yellow-900 text-yellow-300" : "text-yellow-600",
            added: filter === "added" ? "bg-emerald-900 text-emerald-300" : "text-emerald-700",
            removed: filter === "removed" ? "bg-red-900 text-red-300" : "text-red-700",
          }[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-0.5 rounded border border-slate-700/50 ${cls} transition-colors`}
            >
              {cap(f)} ({cnt})
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
        {filtered.map((node, i) => (
          <DiffLine key={i} node={node} mode={mode} />
        ))}
      </div>
    </div>
  );
}

// ── Snapshot Card ─────────────────────────────────────────────────────────────

function SnapshotCard({
  snap,
  selected,
  onSelect,
  compact = false,
}: {
  snap: Snapshot;
  selected?: boolean;
  onSelect?: (s: Snapshot) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-lg border transition-colors ${
        selected
          ? "bg-blue-950/30 border-blue-600/60"
          : "bg-slate-800/50 border-slate-700/50 hover:border-slate-600/70"
      } ${onSelect ? "cursor-pointer" : ""}`}
      onClick={() => onSelect?.(snap)}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <TypeBadge type={snap.snapshotType} />
            <TriggerBadge trigger={snap.triggerType} />
            {selected && <span className="text-[10px] text-blue-400 font-medium">Selected</span>}
          </div>
          {snap.label && (
            <p className="text-slate-200 text-sm font-medium truncate">{snap.label}</p>
          )}
          <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-slate-500">
            {snap.projectName && (
              <span className="flex items-center gap-1">
                <Database className="h-2.5 w-2.5" />{snap.projectName}
              </span>
            )}
            {snap.capturedByName && (
              <span className="flex items-center gap-1">
                <User className="h-2.5 w-2.5" />{snap.capturedByName}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />{fmtRelative(snap.createdAt)}
            </span>
          </div>
          {!compact && snap.entityId && (
            <p className="text-[10px] text-slate-600 font-mono mt-1 truncate">{snap.entityId}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Capture Modal ─────────────────────────────────────────────────────────────

function CaptureForm({
  projectList,
  onClose,
  onSuccess,
}: {
  projectList: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [snapshotType, setSnapshotType] = useState("ownership_state");
  const [entityId, setEntityId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE_URL}/api/snapshots/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotType,
          entityId: entityId || projectId,
          projectId: projectId || undefined,
          label: label || undefined,
          notes: notes || undefined,
          triggerType: "manual",
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Capture failed");
      }
      return res.json();
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  const needsProjectId = ["ownership_state", "financial_position", "lca_position"].includes(snapshotType);
  const entityLabel = TYPE_ENTITY_LABEL[snapshotType] ?? "Entity ID";

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-blue-400" />
            <h2 className="text-slate-100 font-semibold">Capture Snapshot</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <Label className="text-slate-300 text-xs mb-1.5 block">Snapshot Type</Label>
            <Select value={snapshotType} onValueChange={(v) => { setSnapshotType(v); setEntityId(""); setProjectId(""); }}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {SNAPSHOT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-slate-200 text-sm">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsProjectId ? (
            <div>
              <Label className="text-slate-300 text-xs mb-1.5 block">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                  <SelectValue placeholder="Select project…" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {projectList.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-slate-200 text-sm">{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-slate-300 text-xs mb-1.5 block">{entityLabel}</Label>
              <Input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="Paste UUID…"
                className="bg-slate-800 border-slate-700 text-slate-200 h-9 font-mono text-xs"
              />
            </div>
          )}

          <div>
            <Label className="text-slate-300 text-xs mb-1.5 block">Label (optional)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Pre-transfer baseline, FY 2024-25 close"
              className="bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm"
            />
          </div>

          <div>
            <Label className="text-slate-300 text-xs mb-1.5 block">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context for this snapshot…"
              className="bg-slate-800 border-slate-700 text-slate-200 text-sm resize-none"
              rows={2}
            />
          </div>

          {mutation.error && (
            <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
              {(mutation.error as Error).message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 p-4 border-t border-slate-700/60">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-slate-600 text-slate-300"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || (!projectId && !entityId)}
            className="bg-blue-700 hover:bg-blue-600 text-white"
          >
            {mutation.isPending ? "Capturing…" : "Capture Snapshot"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SnapshotArchive() {
  const { role } = useRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"archive" | "compare" | "timeline" | "restore">("archive");
  const [showCapture, setShowCapture] = useState(false);

  // Archive filters
  const [archiveTypeFilter, setArchiveTypeFilter] = useState("all");
  const [archiveProjectFilter, setArchiveProjectFilter] = useState("all");
  const [archiveSearch, setArchiveSearch] = useState("");

  // Compare
  const [compareA, setCompareA] = useState<Snapshot | null>(null);
  const [compareB, setCompareB] = useState<Snapshot | null>(null);
  const [comparePick, setComparePick] = useState<"a" | "b" | null>(null);

  // Timeline
  const [timelineType, setTimelineType] = useState("");
  const [timelineEntityId, setTimelineEntityId] = useState("");
  const [timelineProjectId, setTimelineProjectId] = useState("");

  // Restore preview
  const [restoreSnap, setRestoreSnap] = useState<Snapshot | null>(null);

  const projectsQuery = useListProjects();
  const projectList = (projectsQuery.data as { id: string; name: string }[] | undefined) ?? [];

  // ── Data queries ────────────────────────────────────────────────────────────

  const archiveQuery = useQuery({
    queryKey: ["/api/snapshots", archiveTypeFilter, archiveProjectFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (archiveTypeFilter !== "all") params.set("snapshotType", archiveTypeFilter);
      if (archiveProjectFilter !== "all") params.set("projectId", archiveProjectFilter);
      const res = await fetch(`${BASE_URL}/api/snapshots?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ snapshots: Snapshot[]; total: number }>;
    },
  });

  const compareQuery = useQuery({
    queryKey: ["/api/snapshots/compare", compareA?.id, compareB?.id],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/snapshots/compare?a=${compareA!.id}&b=${compareB!.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<CompareResult>;
    },
    enabled: !!compareA && !!compareB,
  });

  const resolvedTimelineEntityId = useMemo(() => {
    if (!timelineType) return "";
    if (["ownership_state", "financial_position", "lca_position"].includes(timelineType)) {
      return timelineProjectId;
    }
    return timelineEntityId;
  }, [timelineType, timelineProjectId, timelineEntityId]);

  const resolvedTimelineEntityType = TYPE_ENTITY_TABLE[timelineType] ?? timelineType;

  const timelineQuery = useQuery({
    queryKey: ["/api/snapshots/entity", resolvedTimelineEntityType, resolvedTimelineEntityId],
    queryFn: async () => {
      const res = await fetch(
        `${BASE_URL}/api/snapshots/entity/${resolvedTimelineEntityType}/${resolvedTimelineEntityId}?limit=50`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ snapshots: TimelineSnapshot[]; total: number }>;
    },
    enabled: !!resolvedTimelineEntityId && !!resolvedTimelineEntityType,
  });

  const restoreQuery = useQuery({
    queryKey: ["/api/snapshots/restore-preview", restoreSnap?.id],
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/snapshots/restore-preview/${restoreSnap!.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<RestorePreviewResult>;
    },
    enabled: !!restoreSnap,
  });

  // ── Archive filter ──────────────────────────────────────────────────────────

  const filteredSnapshots = useMemo(() => {
    const all = archiveQuery.data?.snapshots ?? [];
    if (!archiveSearch.trim()) return all;
    const q = archiveSearch.toLowerCase();
    return all.filter(
      (s) =>
        s.label?.toLowerCase().includes(q) ||
        s.projectName?.toLowerCase().includes(q) ||
        s.capturedByName?.toLowerCase().includes(q) ||
        s.entityId?.toLowerCase().includes(q) ||
        s.snapshotType.toLowerCase().includes(q),
    );
  }, [archiveQuery.data, archiveSearch]);

  const handleArchiveSelect = useCallback(
    (snap: Snapshot) => {
      if (comparePick === "a") { setCompareA(snap); setComparePick(null); }
      else if (comparePick === "b") { setCompareB(snap); setComparePick(null); }
      else if (tab === "restore") { setRestoreSnap(snap); }
    },
    [comparePick, tab],
  );

  if (!["admin", "developer"].includes(role ?? "")) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Lock className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Access restricted to administrators and developers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60">
            <HistoryIcon className="h-6 w-6 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-100">Snapshot Archive</h1>
              <Badge className="text-xs bg-slate-800 text-slate-400 border border-slate-700">Immutable</Badge>
            </div>
            <p className="text-slate-400 text-sm mt-0.5">
              Historical record preservation — ownership, agreements, settlements, financial positions. Write-once, tamper-evident.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-700"
            onClick={() => { void archiveQuery.refetch(); }}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-blue-700 hover:bg-blue-600 text-white"
            onClick={() => setShowCapture(true)}
          >
            <Camera className="h-4 w-4 mr-1.5" />
            Capture Snapshot
          </Button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {SNAPSHOT_TYPES.map((t) => {
          const cnt = (archiveQuery.data?.snapshots ?? []).filter((s) => s.snapshotType === t.value).length;
          return (
            <button
              key={t.value}
              onClick={() => { setArchiveTypeFilter(t.value); setTab("archive"); }}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                archiveTypeFilter === t.value
                  ? t.bg
                  : "bg-slate-800/40 border-slate-700/40 hover:border-slate-600/60"
              }`}
            >
              <t.icon className={`h-3.5 w-3.5 mb-1 ${t.color}`} />
              <p className={`text-sm font-bold ${t.color}`}>{cnt}</p>
              <p className="text-[10px] text-slate-500">{t.label}</p>
            </button>
          );
        })}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="bg-slate-800/80 border border-slate-700/60 h-9">
          {[
            { value: "archive", icon: Archive, label: "Archive" },
            { value: "compare", icon: GitCompare, label: "Compare" },
            { value: "timeline", icon: HistoryIcon, label: "Timeline" },
            { value: "restore", icon: RotateCcw, label: "Restore Preview" },
          ].map(({ value, icon: Icon, label }) => (
            <TabsTrigger key={value} value={value} className="text-xs data-[state=active]:bg-slate-700 data-[state=active]:text-slate-100">
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── ARCHIVE TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="archive" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                value={archiveSearch}
                onChange={(e) => setArchiveSearch(e.target.value)}
                placeholder="Search by label, project, entity ID…"
                className="pl-9 bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500 h-9 text-sm"
              />
            </div>
            <Select value={archiveTypeFilter} onValueChange={setArchiveTypeFilter}>
              <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all" className="text-slate-200 text-sm">All Types</SelectItem>
                {SNAPSHOT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-slate-200 text-sm">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={archiveProjectFilter} onValueChange={setArchiveProjectFilter}>
              <SelectTrigger className="w-44 bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all" className="text-slate-200 text-sm">All Projects</SelectItem>
                {projectList.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-slate-200 text-sm">{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {archiveQuery.data && (
              <span className="self-center text-xs text-slate-500">
                {filteredSnapshots.length} of {archiveQuery.data.total} snapshots
              </span>
            )}
          </div>

          {archiveQuery.isLoading ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 bg-slate-800/60 rounded-lg" />)}</div>
          ) : filteredSnapshots.length === 0 ? (
            <div className="text-center py-12">
              <Archive className="h-12 w-12 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No snapshots found</p>
              <p className="text-slate-500 text-sm mt-1">Capture a snapshot to start building the historical archive.</p>
              <Button
                size="sm"
                className="mt-4 bg-blue-700 hover:bg-blue-600 text-white"
                onClick={() => setShowCapture(true)}
              >
                <Camera className="h-4 w-4 mr-1.5" />
                Capture First Snapshot
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSnapshots.map((snap) => (
                <div key={snap.id} className="group relative">
                  <SnapshotCard snap={snap} />
                  <div className="absolute top-3 right-3 hidden group-hover:flex items-center gap-1">
                    <button
                      onClick={() => { setCompareA(snap); setTab("compare"); }}
                      title="Use as Compare A"
                      className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 hover:text-blue-400 border border-slate-600/50"
                    >
                      A
                    </button>
                    <button
                      onClick={() => { setCompareB(snap); setTab("compare"); }}
                      title="Use as Compare B"
                      className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 hover:text-blue-400 border border-slate-600/50"
                    >
                      B
                    </button>
                    <button
                      onClick={() => { setRestoreSnap(snap); setTab("restore"); }}
                      title="Restore Preview"
                      className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 hover:text-orange-400 border border-slate-600/50"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── COMPARE TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="compare" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Slot A */}
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-medium text-slate-400 flex items-center justify-between">
                  <span className="text-red-400 font-bold">◀ Snapshot A</span>
                  <button
                    onClick={() => { setComparePick("a"); setTab("archive"); }}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <Search className="h-2.5 w-2.5" /> Browse
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                {compareA ? (
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <SnapshotCard snap={compareA} compact />
                    </div>
                    <button onClick={() => setCompareA(null)} className="text-slate-600 hover:text-slate-400 mt-1">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setComparePick("a"); setTab("archive"); }}
                    className="w-full p-4 border-2 border-dashed border-slate-700/60 rounded-lg text-slate-500 text-sm hover:border-blue-600/40 hover:text-blue-400 transition-colors text-center"
                  >
                    <Search className="h-5 w-5 mx-auto mb-1" />
                    Click to select Snapshot A from Archive
                  </button>
                )}
              </CardContent>
            </Card>

            {/* Slot B */}
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-medium text-slate-400 flex items-center justify-between">
                  <span className="text-emerald-400 font-bold">Snapshot B ▶</span>
                  <button
                    onClick={() => { setComparePick("b"); setTab("archive"); }}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <Search className="h-2.5 w-2.5" /> Browse
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                {compareB ? (
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <SnapshotCard snap={compareB} compact />
                    </div>
                    <button onClick={() => setCompareB(null)} className="text-slate-600 hover:text-slate-400 mt-1">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setComparePick("b"); setTab("archive"); }}
                    className="w-full p-4 border-2 border-dashed border-slate-700/60 rounded-lg text-slate-500 text-sm hover:border-blue-600/40 hover:text-blue-400 transition-colors text-center"
                  >
                    <Search className="h-5 w-5 mx-auto mb-1" />
                    Click to select Snapshot B from Archive
                  </button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Diff result */}
          {compareA && compareB && (
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardContent className="p-4">
                {compareQuery.isLoading ? (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 bg-slate-700/60 rounded" />)}</div>
                ) : compareQuery.isError ? (
                  <p className="text-red-400 text-sm text-center py-4">Failed to compare snapshots.</p>
                ) : compareQuery.data ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 pb-3 border-b border-slate-700/40">
                      <div className="flex gap-2 text-xs">
                        <span className="text-yellow-400">{compareQuery.data.diffCount.changed} changed</span>
                        <span className="text-emerald-400">{compareQuery.data.diffCount.added} added</span>
                        <span className="text-red-400">{compareQuery.data.diffCount.removed} removed</span>
                      </div>
                      <p className="text-slate-500 text-xs ml-auto">
                        A: {fmtDateTime(compareQuery.data.a.createdAt)} → B: {fmtDateTime(compareQuery.data.b.createdAt)}
                      </p>
                    </div>
                    <DiffView diff={compareQuery.data.diff} mode="compare" />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TIMELINE TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="timeline" className="mt-4 space-y-4">
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-3">
                <div>
                  <Label className="text-slate-400 text-xs mb-1 block">Snapshot Type</Label>
                  <Select value={timelineType} onValueChange={(v) => { setTimelineType(v); setTimelineEntityId(""); setTimelineProjectId(""); }}>
                    <SelectTrigger className="w-52 bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {SNAPSHOT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value} className="text-slate-200 text-sm">{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {timelineType && (
                  ["ownership_state", "financial_position", "lca_position"].includes(timelineType) ? (
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">Project</Label>
                      <Select value={timelineProjectId} onValueChange={setTimelineProjectId}>
                        <SelectTrigger className="w-52 bg-slate-800 border-slate-700 text-slate-200 h-9 text-sm">
                          <SelectValue placeholder="Select project…" />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          {projectList.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-slate-200 text-sm">{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div>
                      <Label className="text-slate-400 text-xs mb-1 block">{TYPE_ENTITY_LABEL[timelineType] ?? "Entity ID"}</Label>
                      <Input
                        value={timelineEntityId}
                        onChange={(e) => setTimelineEntityId(e.target.value)}
                        placeholder="Paste UUID…"
                        className="w-72 bg-slate-800 border-slate-700 text-slate-200 h-9 font-mono text-xs"
                      />
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          {!resolvedTimelineEntityId ? (
            <div className="text-center py-10">
              <HistoryIcon className="h-10 w-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400">Select a snapshot type and entity to view its change history.</p>
            </div>
          ) : timelineQuery.isLoading ? (
            <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 bg-slate-800/60 rounded-xl" />)}</div>
          ) : !timelineQuery.data?.snapshots.length ? (
            <div className="text-center py-10">
              <Camera className="h-10 w-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400">No snapshots found for this entity.</p>
              <p className="text-slate-500 text-sm mt-1">Capture a snapshot to start tracking this entity's history.</p>
            </div>
          ) : (
            <div className="relative pl-6">
              {/* timeline line */}
              <div className="absolute left-2.5 top-0 bottom-0 w-px bg-slate-700/60" />

              <div className="space-y-4">
                {timelineQuery.data.snapshots.map((snap, i) => (
                  <div key={snap.id} className="relative">
                    {/* dot */}
                    <div className={`absolute -left-6 top-3 w-3 h-3 rounded-full border-2 ${
                      i === 0
                        ? "bg-blue-500 border-blue-400"
                        : "bg-slate-700 border-slate-500"
                    }`} />

                    <Card className="bg-slate-800/50 border-slate-700/50">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <TypeBadge type={snap.snapshotType} />
                          <TriggerBadge trigger={snap.triggerType} />
                          {i === 0 && <span className="text-[10px] text-blue-400 font-medium">Latest</span>}
                          <span className="ml-auto text-xs text-slate-500">{fmtDateTime(snap.createdAt)}</span>
                        </div>
                        {snap.label && <p className="text-slate-200 text-sm font-medium">{snap.label}</p>}
                        <div className="text-xs text-slate-500 flex gap-3">
                          {snap.capturedByName && <span>{snap.capturedByName}</span>}
                          {snap.notes && <span className="italic">{snap.notes}</span>}
                        </div>

                        {snap.diffCount && snap.diffFromPrevious && (
                          <div className="mt-2 border-t border-slate-700/40 pt-2">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Changes from previous snapshot</span>
                              <span className="text-yellow-400 text-[10px]">{snap.diffCount.changed}↔</span>
                              <span className="text-emerald-400 text-[10px]">+{snap.diffCount.added}</span>
                              <span className="text-red-400 text-[10px]">-{snap.diffCount.removed}</span>
                            </div>
                            {snap.diffFromPrevious.length > 0 && (
                              <DiffView
                                diff={snap.diffFromPrevious.slice(0, 10)}
                                mode="compare"
                              />
                            )}
                            {snap.diffFromPrevious.length > 10 && (
                              <p className="text-xs text-slate-500 text-center mt-2">
                                +{snap.diffFromPrevious.length - 10} more changes
                              </p>
                            )}
                          </div>
                        )}

                        {!snap.diffFromPrevious && i < timelineQuery.data.snapshots.length - 1 && (
                          <p className="text-[10px] text-slate-600 italic">First snapshot — no prior state.</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── RESTORE PREVIEW TAB ──────────────────────────────────────────── */}
        <TabsContent value="restore" className="mt-4 space-y-4">
          <Card className="bg-orange-950/20 border-orange-800/30">
            <CardContent className="p-3 flex items-start gap-2">
              <RotateCcw className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
              <p className="text-xs text-orange-300">
                <strong>Read-only preview.</strong> This shows what the current state looks like compared to the selected snapshot. No data is modified — this is purely informational for governance review before any manual restore action.
              </p>
            </CardContent>
          </Card>

          {!restoreSnap ? (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">Select a snapshot from the Archive to preview a restore:</p>
              <button
                onClick={() => setTab("archive")}
                className="flex items-center gap-2 px-4 py-3 bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-300 hover:border-slate-600/70 hover:text-slate-100 text-sm transition-colors w-full"
              >
                <Search className="h-4 w-4 text-slate-500" />
                Browse Archive to select a snapshot
                <ChevronRight className="h-4 w-4 ml-auto text-slate-600" />
              </button>
              <p className="text-slate-600 text-xs">Tip: You can also click the ↩ button on any snapshot card in the Archive tab.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-xs text-slate-500 mb-1.5">Selected Snapshot</p>
                  <SnapshotCard snap={restoreSnap} />
                </div>
                <button onClick={() => setRestoreSnap(null)} className="text-slate-600 hover:text-slate-400 mt-6">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {restoreQuery.isLoading ? (
                <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 bg-slate-700/60 rounded" />)}</div>
              ) : restoreQuery.isError ? (
                <p className="text-red-400 text-sm text-center py-4">Failed to generate restore preview. The entity may no longer exist.</p>
              ) : restoreQuery.data ? (
                <Card className="bg-slate-800/50 border-slate-700/50">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-3 pb-3 border-b border-slate-700/40">
                      {restoreQuery.data.hasDifferences ? (
                        <>
                          <span className="text-orange-400 text-sm font-medium">
                            {restoreQuery.data.diff.length} field{restoreQuery.data.diff.length !== 1 ? "s" : ""} differ from current state
                          </span>
                          <div className="flex gap-2 text-xs ml-auto">
                            <span className="text-yellow-400">{restoreQuery.data.diffCount.changed} changed</span>
                            <span className="text-emerald-400">{restoreQuery.data.diffCount.added} added</span>
                            <span className="text-red-400">{restoreQuery.data.diffCount.removed} removed</span>
                          </div>
                        </>
                      ) : (
                        <span className="text-emerald-400 text-sm font-medium">
                          Current state matches snapshot — no differences
                        </span>
                      )}
                    </div>
                    <DiffView
                      diff={restoreQuery.data.diff}
                      mode="restore"
                      title="Snapshot (left) vs Current State (right)"
                    />
                  </CardContent>
                </Card>
              ) : null}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Legal notice ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 p-3 bg-slate-800/40 border border-slate-700/40 rounded-lg text-xs text-slate-500">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        <p>
          Snapshots are <span className="text-slate-400">write-once and tamper-evident</span>. No retroactive modification is possible.
          The restore preview is read-only — any actual restoration requires a formal governance action.
        </p>
      </div>

      {/* ── Capture modal ─────────────────────────────────────────────────────── */}
      {showCapture && (
        <CaptureForm
          projectList={projectList}
          onClose={() => setShowCapture(false)}
          onSuccess={() => { void qc.invalidateQueries({ queryKey: ["/api/snapshots"] }); }}
        />
      )}
    </div>
  );
}
