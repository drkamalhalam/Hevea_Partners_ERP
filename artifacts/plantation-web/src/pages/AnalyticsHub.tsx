/**
 * AnalyticsHub.tsx
 *
 * Enterprise-grade Advanced Analytics Search & Filtering System.
 * Provides multi-dimensional filtering, saved views, custom dashboard layouts,
 * and real-time aggregated analytics across all plantation modules.
 *
 * Routes: /analytics-hub
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Search, SlidersHorizontal, Save, Star, StarOff, Trash2, RefreshCw,
  ChevronLeft, ChevronRight, X, TrendingUp, TrendingDown, IndianRupee,
  BarChart3, Activity, Globe, AlertTriangle, CheckCircle,
  Package, Scale, Layers, FolderOpen, Users, Zap, Filter, Bell,
  LayoutGrid, LayoutList, Plus, Edit, BookOpen, Eye,
  ArrowUpRight, Minus, ShieldAlert, ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  projectCode?: string | null;
  commercialModel: string;
  lifecycleStatus: string;
  activationStatus: string;
}

interface Partner {
  id: string;
  name: string;
}

interface FilterState {
  searchText: string;
  projectIds: string[];
  dateStart: string;
  dateEnd: string;
  lifecyclePhases: string[];
  activationStatuses: string[];
  commercialModels: string[];
  partnerIds: string[];
  expenditureCategories: string[];
  governanceStatuses: string[];
}

interface SearchResults {
  matchedProjectCount: number;
  projects: Project[];
  summary: Record<string, number>;
  financialTimeline: { month: string; revenue: number; expenditure: number; profit: number }[];
  expenditureByCategory: { category: string; count: number; total: number }[];
  partnerSummary: { name: string; contributions: number; distributions: number }[];
  governanceSummary: {
    disputes: { total: number; open: number; critical: number; resolved: number };
    alerts: { total: number; open: number; critical: number; high: number };
    overrides: number;
  };
  operationalSummary: {
    productionBatches: number;
    totalProducedKg: number;
    inventoryStockTypes: number;
    inventoryTotalQty: number;
    inventoryValue: number;
  };
  projectBreakdown: {
    id: string; name: string; projectCode?: string | null;
    commercialModel: string; lifecycleStatus: string; activationStatus: string;
    revenue: number; expenditure: number; distributed: number;
    openDisputes: number; partnerCount: number;
  }[];
}

interface SavedView {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  filters: Record<string, unknown>;
  widgetConfig: unknown[];
  activeTab?: string | null;
  isPinned: boolean;
  isPublic: boolean;
  accessCount: number;
  lastAccessedAt?: string | null;
  userId: string;
  userName?: string | null;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: FilterState = {
  searchText: "",
  projectIds: [],
  dateStart: "",
  dateEnd: "",
  lifecyclePhases: [],
  activationStatuses: [],
  commercialModels: [],
  partnerIds: [],
  expenditureCategories: [],
  governanceStatuses: [],
};

const LIFECYCLE_LABELS: Record<string, string> = {
  prematurity: "Prematurity",
  mature_production: "Mature Production",
  closed: "Closed",
};

const ACTIVATION_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_verification: "Pending Verification",
  ready_for_activation: "Ready for Activation",
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

const MODEL_LABELS: Record<string, string> = {
  ownership_contribution: "Ownership / Contribution",
  fifty_percent_revenue: "50% Revenue Split",
};

const CATEGORY_LABELS: Record<string, string> = {
  labor: "Labour",
  fertilizer: "Fertilizer",
  transport: "Transport",
  machinery: "Machinery",
  maintenance: "Maintenance",
  consumables: "Consumables",
  plantation_operations: "Plantation Ops",
  miscellaneous: "Miscellaneous",
};

const GOV_STATUS_LABELS: Record<string, string> = {
  clean: "Clean",
  alerts_pending: "Alerts Pending",
  disputes_open: "Disputes Open",
  critical: "Critical",
};

const VIEW_COLORS: Record<string, string> = {
  violet: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  blue:   "bg-blue-500/20 text-blue-300 border-blue-500/30",
  green:  "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  amber:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
  rose:   "bg-rose-500/20 text-rose-300 border-rose-500/30",
  cyan:   "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
};

const CHART_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#ec4899"];

const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtC = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
const fmtKg = (n: number) => `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(n)} kg`;

// ── Sub-components ──────────────────────────────────────────────────────────────

function KpiCard({
  title, value, sub, icon: Icon, color = "violet",
  trend, trendLabel, compact = false,
}: {
  title: string; value: string | number; sub?: string;
  icon: React.FC<{ className?: string }>; color?: string;
  trend?: "up" | "down" | "neutral"; trendLabel?: string; compact?: boolean;
}) {
  const colorMap: Record<string, string> = {
    violet: "text-violet-400 bg-violet-500/10",
    blue:   "text-blue-400 bg-blue-500/10",
    green:  "text-emerald-400 bg-emerald-500/10",
    amber:  "text-amber-400 bg-amber-500/10",
    rose:   "text-rose-400 bg-rose-500/10",
    cyan:   "text-cyan-400 bg-cyan-500/10",
    slate:  "text-slate-400 bg-slate-500/10",
  };
  const ic = colorMap[color] ?? colorMap.violet;

  return (
    <Card className={`bg-slate-900/80 border-slate-700/50 ${compact ? "p-3" : ""}`}>
      <CardContent className={compact ? "p-0" : "p-5"}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 truncate mb-1">{title}</p>
            <p className={`font-bold text-white truncate ${compact ? "text-lg" : "text-2xl"}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>}
            {trendLabel && (
              <div className="flex items-center gap-1 mt-1">
                {trend === "up" && <ArrowUpRight className="h-3 w-3 text-emerald-400" />}
                {trend === "down" && <TrendingDown className="h-3 w-3 text-rose-400" />}
                {trend === "neutral" && <Minus className="h-3 w-3 text-slate-400" />}
                <span className={`text-xs ${trend === "up" ? "text-emerald-400" : trend === "down" ? "text-rose-400" : "text-slate-400"}`}>
                  {trendLabel}
                </span>
              </div>
            )}
          </div>
          <div className={`p-2 rounded-lg shrink-0 ${ic}`}>
            <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 whitespace-nowrap">
      {label}
      <button onClick={onRemove} className="hover:text-white transition-colors ml-0.5">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function MultiCheckFilter({
  label, options, selected, onChange, searchable = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = searchable
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  };

  return (
    <div>
      <p className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">{label}</p>
      {searchable && (
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}…`}
          className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200 mb-2"
        />
      )}
      <div className={`space-y-1 ${searchable ? "max-h-40 overflow-y-auto pr-1" : ""}`}>
        {filtered.map(opt => (
          <label key={opt.value} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              className="accent-violet-500 h-3 w-3"
            />
            <span className="text-xs text-slate-300 group-hover:text-white transition-colors truncate">
              {opt.label}
            </span>
          </label>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-slate-500 italic">No matches</p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AnalyticsHub() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [pendingFilters, setPendingFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [compact, setCompact] = useState(false);

  // ── Saved views state ───────────────────────────────────────────────────────
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [viewForm, setViewForm] = useState({ name: "", description: "", icon: "BarChart3", color: "violet", isPublic: false });

  // ── Meta data ───────────────────────────────────────────────────────────────
  const { data: meta } = useQuery({
    queryKey: ["analytics-hub-meta"],
    queryFn: async () => {
      const r = await fetch("/api/analytics-hub/meta", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load meta");
      return r.json() as Promise<{ projects: Project[]; partners: Partner[]; filterOptions: Record<string, unknown> }>;
    },
  });

  // ── Search query ────────────────────────────────────────────────────────────
  const [searchEnabled, setSearchEnabled] = useState(true);
  const { data: results, isFetching, refetch } = useQuery({
    queryKey: ["analytics-hub-search", appliedFilters],
    queryFn: async () => {
      const r = await fetch("/api/analytics-hub/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(appliedFilters),
      });
      if (!r.ok) throw new Error("Search failed");
      return r.json() as Promise<SearchResults>;
    },
    enabled: searchEnabled,
  });

  // ── Saved views ─────────────────────────────────────────────────────────────
  const { data: savedViewsData, refetch: refetchViews } = useQuery({
    queryKey: ["analytics-hub-saved-views"],
    queryFn: async () => {
      const r = await fetch("/api/analytics-hub/saved-views", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load views");
      return r.json() as Promise<{ views: SavedView[]; publicViews: SavedView[] }>;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: string; payload: Record<string, unknown> }) => {
      const url = data.id ? `/api/analytics-hub/saved-views/${data.id}` : "/api/analytics-hub/saved-views";
      const method = data.id ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(data.payload) });
      if (!r.ok) throw new Error("Save failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "View saved" });
      refetchViews();
      setSaveDialogOpen(false);
      setEditingView(null);
    },
    onError: () => toast({ title: "Failed to save view", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/analytics-hub/saved-views/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Delete failed");
      return r.json();
    },
    onSuccess: () => { toast({ title: "View deleted" }); refetchViews(); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const pinMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/analytics-hub/saved-views/${id}/pin`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("Pin failed");
      return r.json();
    },
    onSuccess: () => refetchViews(),
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const applyFilters = () => setAppliedFilters({ ...pendingFilters });
  const resetFilters = () => {
    setPendingFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };

  const updatePending = <K extends keyof FilterState>(key: K, val: FilterState[K]) =>
    setPendingFilters(p => ({ ...p, [key]: val }));

  const loadView = (view: SavedView) => {
    const f = view.filters as Partial<FilterState>;
    const newF: FilterState = { ...EMPTY_FILTERS, ...f };
    setPendingFilters(newF);
    setAppliedFilters(newF);
    if (view.activeTab) setActiveTab(view.activeTab);
    setSavedViewsOpen(false);
    toast({ title: `Loaded: ${view.name}` });
  };

  const openSaveDialog = (existing?: SavedView) => {
    if (existing) {
      setEditingView(existing);
      setViewForm({ name: existing.name, description: existing.description ?? "", icon: existing.icon ?? "BarChart3", color: existing.color ?? "violet", isPublic: existing.isPublic });
    } else {
      setEditingView(null);
      setViewForm({ name: "", description: "", icon: "BarChart3", color: "violet", isPublic: false });
    }
    setSaveDialogOpen(true);
  };

  const handleSaveView = () => {
    saveMutation.mutate({
      id: editingView?.id,
      payload: {
        ...viewForm,
        filters: appliedFilters,
        widgetConfig: [],
        activeTab,
      },
    });
  };

  // ── Active filter chips ──────────────────────────────────────────────────────

  const activeChips: { label: string; onRemove: () => void }[] = [];
  if (appliedFilters.searchText) activeChips.push({ label: `"${appliedFilters.searchText}"`, onRemove: () => setAppliedFilters(p => ({ ...p, searchText: "" })) });
  appliedFilters.projectIds.forEach(id => {
    const p = meta?.projects.find(pr => pr.id === id);
    if (p) activeChips.push({ label: p.name, onRemove: () => setAppliedFilters(p2 => ({ ...p2, projectIds: p2.projectIds.filter(x => x !== id) })) });
  });
  if (appliedFilters.dateStart || appliedFilters.dateEnd) {
    const label = [appliedFilters.dateStart, appliedFilters.dateEnd].filter(Boolean).join(" → ");
    activeChips.push({ label: `Date: ${label}`, onRemove: () => setAppliedFilters(p => ({ ...p, dateStart: "", dateEnd: "" })) });
  }
  appliedFilters.lifecyclePhases.forEach(v => activeChips.push({ label: LIFECYCLE_LABELS[v] ?? v, onRemove: () => setAppliedFilters(p => ({ ...p, lifecyclePhases: p.lifecyclePhases.filter(x => x !== v) })) }));
  appliedFilters.activationStatuses.forEach(v => activeChips.push({ label: ACTIVATION_LABELS[v] ?? v, onRemove: () => setAppliedFilters(p => ({ ...p, activationStatuses: p.activationStatuses.filter(x => x !== v) })) }));
  appliedFilters.commercialModels.forEach(v => activeChips.push({ label: MODEL_LABELS[v] ?? v, onRemove: () => setAppliedFilters(p => ({ ...p, commercialModels: p.commercialModels.filter(x => x !== v) })) }));
  appliedFilters.partnerIds.forEach(id => {
    const pt = meta?.partners.find(x => x.id === id);
    if (pt) activeChips.push({ label: pt.name, onRemove: () => setAppliedFilters(p => ({ ...p, partnerIds: p.partnerIds.filter(x => x !== id) })) });
  });
  appliedFilters.expenditureCategories.forEach(v => activeChips.push({ label: CATEGORY_LABELS[v] ?? v, onRemove: () => setAppliedFilters(p => ({ ...p, expenditureCategories: p.expenditureCategories.filter(x => x !== v) })) }));
  appliedFilters.governanceStatuses.forEach(v => activeChips.push({ label: GOV_STATUS_LABELS[v] ?? v, onRemove: () => setAppliedFilters(p => ({ ...p, governanceStatuses: p.governanceStatuses.filter(x => x !== v) })) }));

  const s = results?.summary ?? {};
  const profit = (s.operatingProfit ?? 0);
  const margin = (s.profitMargin ?? 0);

  const pinnedViews = savedViewsData?.views.filter(v => v.isPinned) ?? [];

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-slate-950 text-white overflow-hidden">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/80 shrink-0">
          <SlidersHorizontal className="h-5 w-5 text-violet-400 shrink-0" />
          <h1 className="text-base font-semibold text-white shrink-0">Analytics Hub</h1>

          {/* Search box */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={pendingFilters.searchText}
              onChange={e => updatePending("searchText", e.target.value)}
              onKeyDown={e => e.key === "Enter" && applyFilters()}
              placeholder="Search projects, partners…"
              className="pl-9 h-8 text-sm bg-slate-800 border-slate-600 text-slate-200 placeholder:text-slate-500"
            />
          </div>

          {/* Pinned views quick access */}
          {pinnedViews.length > 0 && (
            <div className="flex items-center gap-1">
              {pinnedViews.slice(0, 3).map(v => (
                <Button key={v.id} variant="ghost" size="sm" onClick={() => loadView(v)}
                  className="h-7 px-2 text-xs text-slate-300 hover:text-white hover:bg-slate-700 gap-1">
                  <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                  {v.name}
                </Button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 ml-auto shrink-0">
            {/* Saved views */}
            <Button variant="outline" size="sm" onClick={() => setSavedViewsOpen(true)}
              className="h-8 text-xs border-slate-600 bg-slate-800 text-slate-300 hover:text-white gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Saved Views
              {(savedViewsData?.views.length ?? 0) > 0 && (
                <Badge className="h-4 px-1 text-[10px] bg-violet-600 text-white border-0 ml-0.5">
                  {savedViewsData!.views.length}
                </Badge>
              )}
            </Button>

            {/* Save current */}
            <Button variant="outline" size="sm" onClick={() => openSaveDialog()}
              className="h-8 text-xs border-slate-600 bg-slate-800 text-slate-300 hover:text-white gap-1.5">
              <Save className="h-3.5 w-3.5" />
              Save View
            </Button>

            {/* Layout toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setCompact(c => !c)}
                  className="h-8 w-8 text-slate-400 hover:text-white">
                  {compact ? <LayoutGrid className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{compact ? "Standard view" : "Compact view"}</TooltipContent>
            </Tooltip>

            {/* Refresh */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => refetch()}
                  className="h-8 w-8 text-slate-400 hover:text-white">
                  <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>

            {/* Filter panel toggle */}
            <Button variant="ghost" size="icon" onClick={() => setFilterPanelOpen(o => !o)}
              className="h-8 w-8 text-slate-400 hover:text-white">
              {filterPanelOpen ? <ChevronRight className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* ── Active filter chips ──────────────────────────────────────────── */}
        {activeChips.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60 bg-slate-900/40 shrink-0 overflow-x-auto">
            <span className="text-xs text-slate-500 shrink-0">Filters:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeChips.map((c, i) => <FilterChip key={i} label={c.label} onRemove={c.onRemove} />)}
            </div>
            <Button variant="ghost" size="sm" onClick={resetFilters}
              className="h-6 px-2 text-xs text-slate-500 hover:text-white shrink-0 ml-auto">
              Clear all
            </Button>
          </div>
        )}

        {/* ── Main body ───────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* ── Filter panel ──────────────────────────────────────────────── */}
          {filterPanelOpen && (
            <div className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/60 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Filters</span>
                <Button variant="ghost" size="sm" onClick={resetFilters}
                  className="h-6 px-2 text-[11px] text-slate-500 hover:text-white">
                  Reset
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-5">

                {/* Date range */}
                <div>
                  <p className="text-xs font-semibold text-slate-300 mb-2 uppercase tracking-wide">Date Range</p>
                  <div className="space-y-1.5">
                    <Input type="date" value={pendingFilters.dateStart}
                      onChange={e => updatePending("dateStart", e.target.value)}
                      className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200 [color-scheme:dark]" />
                    <Input type="date" value={pendingFilters.dateEnd}
                      onChange={e => updatePending("dateEnd", e.target.value)}
                      className="h-7 text-xs bg-slate-800 border-slate-600 text-slate-200 [color-scheme:dark]" />
                  </div>
                </div>

                {/* Projects */}
                <MultiCheckFilter
                  label="Project"
                  options={(meta?.projects ?? []).map(p => ({ value: p.id, label: p.name }))}
                  selected={pendingFilters.projectIds}
                  onChange={v => updatePending("projectIds", v)}
                  searchable
                />

                {/* Lifecycle phase */}
                <MultiCheckFilter
                  label="Lifecycle Phase"
                  options={["prematurity", "mature_production", "closed"].map(v => ({ value: v, label: LIFECYCLE_LABELS[v] }))}
                  selected={pendingFilters.lifecyclePhases}
                  onChange={v => updatePending("lifecyclePhases", v)}
                />

                {/* Activation status */}
                <MultiCheckFilter
                  label="Activation Status"
                  options={["draft", "pending_verification", "ready_for_activation", "active", "suspended", "closed"].map(v => ({ value: v, label: ACTIVATION_LABELS[v] }))}
                  selected={pendingFilters.activationStatuses}
                  onChange={v => updatePending("activationStatuses", v)}
                />

                {/* Agreement model */}
                <MultiCheckFilter
                  label="Agreement Model"
                  options={[
                    { value: "ownership_contribution", label: "Ownership / Contribution" },
                    { value: "fifty_percent_revenue", label: "50% Revenue Split" },
                  ]}
                  selected={pendingFilters.commercialModels}
                  onChange={v => updatePending("commercialModels", v)}
                />

                {/* Partners */}
                <MultiCheckFilter
                  label="Partner"
                  options={(meta?.partners ?? []).map(p => ({ value: p.id, label: p.name }))}
                  selected={pendingFilters.partnerIds}
                  onChange={v => updatePending("partnerIds", v)}
                  searchable
                />

                {/* Financial category */}
                <MultiCheckFilter
                  label="Financial Category"
                  options={Object.entries(CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                  selected={pendingFilters.expenditureCategories}
                  onChange={v => updatePending("expenditureCategories", v)}
                />

                {/* Governance status */}
                <MultiCheckFilter
                  label="Governance Status"
                  options={Object.entries(GOV_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                  selected={pendingFilters.governanceStatuses}
                  onChange={v => updatePending("governanceStatuses", v)}
                />
              </div>

              {/* Apply button */}
              <div className="p-3 border-t border-slate-800 shrink-0 space-y-2">
                <Button onClick={applyFilters} className="w-full h-8 text-sm bg-violet-600 hover:bg-violet-700 text-white">
                  Apply Filters
                </Button>
                {isFetching && <p className="text-center text-xs text-slate-500 animate-pulse">Loading…</p>}
              </div>
            </div>
          )}

          {/* ── Dashboard area ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">

            {/* Result count banner */}
            {results && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className="bg-violet-600/20 text-violet-300 border-violet-500/30 text-xs">
                    {results.matchedProjectCount} project{results.matchedProjectCount !== 1 ? "s" : ""} matched
                  </Badge>
                  {isFetching && <span className="text-xs text-slate-500 animate-pulse">Refreshing…</span>}
                </div>
                <span className="text-xs text-slate-500">
                  {activeChips.length > 0 ? `${activeChips.length} active filter${activeChips.length > 1 ? "s" : ""}` : "No active filters — showing all accessible data"}
                </span>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="bg-slate-800/60 border border-slate-700 h-9">
                <TabsTrigger value="overview" className="text-xs data-[state=active]:bg-violet-600">Overview</TabsTrigger>
                <TabsTrigger value="financial" className="text-xs data-[state=active]:bg-violet-600">Financial</TabsTrigger>
                <TabsTrigger value="projects" className="text-xs data-[state=active]:bg-violet-600">Projects</TabsTrigger>
                <TabsTrigger value="operations" className="text-xs data-[state=active]:bg-violet-600">Operations</TabsTrigger>
                <TabsTrigger value="governance" className="text-xs data-[state=active]:bg-violet-600">Governance</TabsTrigger>
                <TabsTrigger value="partners" className="text-xs data-[state=active]:bg-violet-600">Partners</TabsTrigger>
              </TabsList>

              {/* ── Overview tab ─────────────────────────────────────────── */}
              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className={`grid gap-3 ${compact ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
                  <KpiCard title="Total Revenue" value={fmtC(s.totalRevenue ?? 0)} icon={IndianRupee} color="green" compact={compact}
                    sub={`${fmt(s.salesTransactions ?? 0)} transactions`} />
                  <KpiCard title="Total Expenditure" value={fmtC(s.totalExpenditure ?? 0)} icon={TrendingDown} color="rose" compact={compact} />
                  <KpiCard title="Operating Profit" value={fmtC(profit)} icon={profit >= 0 ? TrendingUp : TrendingDown}
                    color={profit >= 0 ? "green" : "rose"} compact={compact}
                    trendLabel={`${margin.toFixed(1)}% margin`} trend={profit >= 0 ? "up" : "down"} />
                  <KpiCard title="Total Distributed" value={fmtC(s.totalDistributed ?? 0)} icon={Scale} color="blue" compact={compact} />
                  <KpiCard title="Contributions" value={fmtC(s.totalContributions ?? 0)} icon={IndianRupee} color="violet" compact={compact} />
                  <KpiCard title="Rubber Sold" value={fmtKg(s.totalSalesKg ?? 0)} icon={Package} color="amber" compact={compact}
                    sub={s.avgRatePerKg ? `₹${Number(s.avgRatePerKg).toFixed(2)}/kg avg` : undefined} />
                  <KpiCard title="Open Disputes" value={fmt(s.openDisputes ?? 0)} icon={AlertTriangle}
                    color={(s.openDisputes ?? 0) > 0 ? "rose" : "green"} compact={compact} />
                  <KpiCard title="Critical Alerts" value={fmt(s.criticalAlerts ?? 0)} icon={ShieldAlert}
                    color={(s.criticalAlerts ?? 0) > 0 ? "rose" : "green"} compact={compact} />
                </div>

                {/* Financial timeline */}
                {(results?.financialTimeline.length ?? 0) > 0 && (
                  <Card className="bg-slate-900/80 border-slate-700/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-slate-200 font-medium">Revenue vs Expenditure</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={compact ? 160 : 220}>
                        <AreaChart data={results!.financialTimeline}>
                          <defs>
                            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                          <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                          <ReTooltip
                            contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }}
                            formatter={(v: number) => fmtC(v)}
                          />
                          <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" fill="url(#rev)" strokeWidth={2} />
                          <Area type="monotone" dataKey="expenditure" name="Expenditure" stroke="#ef4444" fill="url(#exp)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Financial tab ─────────────────────────────────────────── */}
              <TabsContent value="financial" className="mt-4 space-y-4">
                <div className={`grid gap-3 ${compact ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-3"}`}>
                  <KpiCard title="Total Revenue" value={fmtC(s.totalRevenue ?? 0)} icon={IndianRupee} color="green" compact={compact} />
                  <KpiCard title="Approved Expenditure" value={fmtC(s.totalExpenditure ?? 0)} icon={TrendingDown} color="rose" compact={compact} />
                  <KpiCard title="LCA Carry-Forward" value={fmtC(s.lcaCarryForward ?? 0)} icon={Layers} color="amber" compact={compact} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Timeline */}
                  {(results?.financialTimeline.length ?? 0) > 0 && (
                    <Card className="bg-slate-900/80 border-slate-700/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-slate-200 font-medium">Monthly P&L</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={results!.financialTimeline}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="month" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                            <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                            <ReTooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }} formatter={(v: number) => fmtC(v)} />
                            <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                            <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="expenditure" name="Expenditure" fill="#ef4444" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="profit" name="Profit" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Expenditure by category */}
                  {(results?.expenditureByCategory.length ?? 0) > 0 && (
                    <Card className="bg-slate-900/80 border-slate-700/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-slate-200 font-medium">Expenditure by Category</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie data={results!.expenditureByCategory} dataKey="total" nameKey="category"
                              cx="50%" cy="50%" outerRadius={75} innerRadius={35} paddingAngle={2}>
                              {results!.expenditureByCategory.map((_, i) => (
                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                              ))}
                            </Pie>
                            <ReTooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }}
                              formatter={(v: number, name: string) => [fmtC(v), CATEGORY_LABELS[name] ?? name]} />
                            <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}
                              formatter={(v: string) => CATEGORY_LABELS[v] ?? v} />
                          </PieChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Category breakdown table */}
                {(results?.expenditureByCategory.length ?? 0) > 0 && (
                  <Card className="bg-slate-900/80 border-slate-700/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-slate-200 font-medium">Category Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-800">
                            <th className="text-left p-3 text-slate-400 font-medium">Category</th>
                            <th className="text-right p-3 text-slate-400 font-medium">Records</th>
                            <th className="text-right p-3 text-slate-400 font-medium">Total</th>
                            <th className="text-right p-3 text-slate-400 font-medium">% Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results!.expenditureByCategory.map((row, i) => {
                            const totalExp = results!.expenditureByCategory.reduce((a, r) => a + r.total, 0);
                            const pct = totalExp > 0 ? ((row.total / totalExp) * 100).toFixed(1) : "0.0";
                            return (
                              <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                                <td className="p-3 text-slate-300">{CATEGORY_LABELS[row.category] ?? row.category}</td>
                                <td className="p-3 text-right text-slate-400">{fmt(row.count)}</td>
                                <td className="p-3 text-right text-white font-medium">{fmtC(row.total)}</td>
                                <td className="p-3 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                      <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                    <span className="text-slate-400 w-8 text-right">{pct}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* ── Projects tab ──────────────────────────────────────────── */}
              <TabsContent value="projects" className="mt-4 space-y-4">
                {(results?.projectBreakdown.length ?? 0) > 0 && (
                  <>
                    {/* Bar chart */}
                    <Card className="bg-slate-900/80 border-slate-700/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-slate-200 font-medium">Project Revenue Comparison</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={compact ? 160 : 220}>
                          <BarChart data={results!.projectBreakdown.slice(0, 10)} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                            <XAxis type="number" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                            <YAxis type="category" dataKey="name" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} width={100} />
                            <ReTooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }} formatter={(v: number) => fmtC(v)} />
                            <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                            <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[0, 2, 2, 0]} />
                            <Bar dataKey="expenditure" name="Expenditure" fill="#ef4444" radius={[0, 2, 2, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>

                    {/* Table */}
                    <Card className="bg-slate-900/80 border-slate-700/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-slate-200 font-medium">Project Breakdown</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-800">
                                <th className="text-left p-3 text-slate-400 font-medium">Project</th>
                                <th className="text-left p-3 text-slate-400 font-medium hidden md:table-cell">Model</th>
                                <th className="text-left p-3 text-slate-400 font-medium hidden lg:table-cell">Lifecycle</th>
                                <th className="text-right p-3 text-slate-400 font-medium">Revenue</th>
                                <th className="text-right p-3 text-slate-400 font-medium">Expenditure</th>
                                <th className="text-right p-3 text-slate-400 font-medium hidden md:table-cell">Distributed</th>
                                <th className="text-center p-3 text-slate-400 font-medium hidden lg:table-cell">Partners</th>
                                <th className="text-center p-3 text-slate-400 font-medium">Disputes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {results!.projectBreakdown.map((row, i) => (
                                <tr key={row.id} className={`border-b border-slate-800/40 hover:bg-slate-800/30 ${i % 2 === 0 ? "" : "bg-slate-900/30"}`}>
                                  <td className="p-3">
                                    <div className="font-medium text-white">{row.name}</div>
                                    {row.projectCode && <div className="text-slate-500 text-[10px]">{row.projectCode}</div>}
                                  </td>
                                  <td className="p-3 hidden md:table-cell">
                                    <Badge className={`text-[10px] ${row.commercialModel === "ownership_contribution" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
                                      {row.commercialModel === "ownership_contribution" ? "Ownership" : "50% Rev"}
                                    </Badge>
                                  </td>
                                  <td className="p-3 hidden lg:table-cell">
                                    <Badge className="text-[10px] bg-slate-700/50 text-slate-300 border-slate-600">
                                      {LIFECYCLE_LABELS[row.lifecycleStatus] ?? row.lifecycleStatus}
                                    </Badge>
                                  </td>
                                  <td className="p-3 text-right text-emerald-400 font-medium">{fmtC(row.revenue)}</td>
                                  <td className="p-3 text-right text-rose-400">{fmtC(row.expenditure)}</td>
                                  <td className="p-3 text-right text-blue-400 hidden md:table-cell">{fmtC(row.distributed)}</td>
                                  <td className="p-3 text-center text-slate-300 hidden lg:table-cell">{fmt(row.partnerCount)}</td>
                                  <td className="p-3 text-center">
                                    {row.openDisputes > 0 ? (
                                      <Badge className="text-[10px] bg-rose-500/20 text-rose-300 border-rose-500/30">{row.openDisputes}</Badge>
                                    ) : (
                                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
                {results && results.projectBreakdown.length === 0 && (
                  <div className="text-center py-16 text-slate-500">
                    <FolderOpen className="h-10 w-10 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm">No projects match the current filters</p>
                  </div>
                )}
              </TabsContent>

              {/* ── Operations tab ────────────────────────────────────────── */}
              <TabsContent value="operations" className="mt-4 space-y-4">
                <div className={`grid gap-3 ${compact ? "grid-cols-4" : "grid-cols-2 lg:grid-cols-4"}`}>
                  <KpiCard title="Production Batches" value={fmt(results?.operationalSummary.productionBatches ?? 0)} icon={Activity} color="green" compact={compact} />
                  <KpiCard title="Total Produced" value={fmtKg(results?.operationalSummary.totalProducedKg ?? 0)} icon={Package} color="blue" compact={compact} />
                  <KpiCard title="Stock Types" value={fmt(results?.operationalSummary.inventoryStockTypes ?? 0)} icon={Layers} color="violet" compact={compact} />
                  <KpiCard title="Inventory Value" value={fmtC(results?.operationalSummary.inventoryValue ?? 0)} icon={IndianRupee} color="amber" compact={compact} />
                </div>
                {!(results?.operationalSummary.productionBatches) && (
                  <div className="text-center py-12 text-slate-500">
                    <Activity className="h-10 w-10 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm">No operational data for this selection</p>
                  </div>
                )}
              </TabsContent>

              {/* ── Governance tab ────────────────────────────────────────── */}
              <TabsContent value="governance" className="mt-4 space-y-4">
                <div className={`grid gap-3 ${compact ? "grid-cols-4" : "grid-cols-2 lg:grid-cols-4"}`}>
                  <KpiCard title="Total Disputes" value={fmt(results?.governanceSummary.disputes.total ?? 0)} icon={Scale} color="slate" compact={compact} />
                  <KpiCard title="Open Disputes" value={fmt(results?.governanceSummary.disputes.open ?? 0)} icon={AlertTriangle}
                    color={(results?.governanceSummary.disputes.open ?? 0) > 0 ? "rose" : "green"} compact={compact} />
                  <KpiCard title="Critical Disputes" value={fmt(results?.governanceSummary.disputes.critical ?? 0)} icon={ShieldAlert}
                    color={(results?.governanceSummary.disputes.critical ?? 0) > 0 ? "rose" : "green"} compact={compact} />
                  <KpiCard title="Resolved" value={fmt(results?.governanceSummary.disputes.resolved ?? 0)} icon={CheckCircle} color="green" compact={compact} />
                </div>
                <div className={`grid gap-3 ${compact ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-3"}`}>
                  <KpiCard title="Open Alerts" value={fmt(results?.governanceSummary.alerts.open ?? 0)} icon={Bell ?? AlertTriangle}
                    color={(results?.governanceSummary.alerts.open ?? 0) > 0 ? "amber" : "green"} compact={compact} />
                  <KpiCard title="Critical Alerts" value={fmt(results?.governanceSummary.alerts.critical ?? 0)} icon={Zap}
                    color={(results?.governanceSummary.alerts.critical ?? 0) > 0 ? "rose" : "green"} compact={compact} />
                  <KpiCard title="Gov. Overrides" value={fmt(results?.governanceSummary.overrides ?? 0)} icon={Globe} color="violet" compact={compact} />
                </div>
              </TabsContent>

              {/* ── Partners tab ──────────────────────────────────────────── */}
              <TabsContent value="partners" className="mt-4 space-y-4">
                {(results?.partnerSummary.length ?? 0) > 0 ? (
                  <>
                    <Card className="bg-slate-900/80 border-slate-700/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-slate-200 font-medium">Partner Contributions vs Distributions</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={compact ? 160 : 220}>
                          <BarChart data={results!.partnerSummary.slice(0, 12)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="name" stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 9 }} />
                            <YAxis stroke="#475569" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                            <ReTooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: 12 }} formatter={(v: number) => fmtC(v)} />
                            <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                            <Bar dataKey="contributions" name="Contributions" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="distributions" name="Distributions" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                    <Card className="bg-slate-900/80 border-slate-700/50">
                      <CardContent className="p-0">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-800">
                              <th className="text-left p-3 text-slate-400 font-medium">Partner</th>
                              <th className="text-right p-3 text-slate-400 font-medium">Contributions</th>
                              <th className="text-right p-3 text-slate-400 font-medium">Distributions</th>
                              <th className="text-right p-3 text-slate-400 font-medium">Net</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results!.partnerSummary.map((row, i) => {
                              const net = row.distributions - row.contributions;
                              return (
                                <tr key={i} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                                  <td className="p-3 text-slate-200 font-medium">{row.name}</td>
                                  <td className="p-3 text-right text-violet-400">{fmtC(row.contributions)}</td>
                                  <td className="p-3 text-right text-cyan-400">{fmtC(row.distributions)}</td>
                                  <td className={`p-3 text-right font-medium ${net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtC(Math.abs(net))}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <div className="text-center py-16 text-slate-500">
                    <Users className="h-10 w-10 mx-auto mb-3 text-slate-600" />
                    <p className="text-sm">No partner data for this selection</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Empty state */}
            {!results && !isFetching && (
              <div className="text-center py-20 text-slate-500">
                <SlidersHorizontal className="h-12 w-12 mx-auto mb-4 text-slate-700" />
                <p className="text-base text-slate-400 mb-1">Set filters and apply to explore your data</p>
                <p className="text-sm">Use the panel on the left to filter by project, date, lifecycle and more</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Saved Views Dialog ──────────────────────────────────────────── */}
        <Dialog open={savedViewsOpen} onOpenChange={setSavedViewsOpen}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-violet-400" />
                Saved Analytics Views
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* My views */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">My Views</p>
                  <Button size="sm" variant="ghost" onClick={() => { setSavedViewsOpen(false); openSaveDialog(); }}
                    className="h-6 px-2 text-xs text-violet-400 hover:text-violet-300 gap-1">
                    <Plus className="h-3 w-3" /> Save Current
                  </Button>
                </div>
                {(savedViewsData?.views.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-500 italic py-3 text-center">No saved views yet. Apply filters and click "Save View" to create one.</p>
                ) : (
                  <div className="space-y-1.5">
                    {savedViewsData!.views.map(v => (
                      <div key={v.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/50 group hover:border-slate-600 transition-colors">
                        <div className={`h-8 w-8 rounded-md flex items-center justify-center text-xs font-bold shrink-0 border ${VIEW_COLORS[v.color ?? "violet"] ?? VIEW_COLORS.violet}`}>
                          {v.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{v.name}</p>
                          {v.description && <p className="text-xs text-slate-400 truncate">{v.description}</p>}
                          <p className="text-[10px] text-slate-500">{v.accessCount} uses · {new Date(v.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-amber-400" onClick={() => pinMutation.mutate(v.id)}>
                            {v.isPinned ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : <StarOff className="h-3.5 w-3.5" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-400" onClick={() => { setSavedViewsOpen(false); openSaveDialog(v); }}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" onClick={() => loadView(v)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-rose-400" onClick={() => deleteMutation.mutate(v.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Public views from others */}
              {(savedViewsData?.publicViews.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Shared by Team</p>
                  <div className="space-y-1.5">
                    {savedViewsData!.publicViews.map(v => (
                      <div key={v.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/40">
                        <div className={`h-8 w-8 rounded-md flex items-center justify-center text-xs font-bold shrink-0 border ${VIEW_COLORS[v.color ?? "blue"] ?? VIEW_COLORS.blue}`}>
                          {v.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-200 font-medium truncate">{v.name}</p>
                          <p className="text-[10px] text-slate-500">By {v.userName ?? "Unknown"} · {v.accessCount} uses</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => loadView(v)} className="h-7 text-xs text-violet-400 hover:text-violet-300">
                          Load
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Save / Edit View Dialog ─────────────────────────────────────── */}
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white text-sm">{editingView ? "Edit View" : "Save Analytics View"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">View Name *</label>
                <Input value={viewForm.name} onChange={e => setViewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Q4 Active Projects" className="h-8 text-sm bg-slate-800 border-slate-600 text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Description</label>
                <Input value={viewForm.description} onChange={e => setViewForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description" className="h-8 text-sm bg-slate-800 border-slate-600 text-white" />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block">Colour</label>
                <div className="flex gap-2">
                  {Object.keys(VIEW_COLORS).map(c => (
                    <button key={c} onClick={() => setViewForm(f => ({ ...f, color: c }))}
                      className={`h-6 w-6 rounded-full border-2 transition-all ${viewForm.color === c ? "border-white scale-110" : "border-transparent opacity-60 hover:opacity-100"} ${VIEW_COLORS[c]?.split(" ")[0] ?? ""}`} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isPublic" checked={viewForm.isPublic} onChange={e => setViewForm(f => ({ ...f, isPublic: e.target.checked }))} className="accent-violet-500" />
                <label htmlFor="isPublic" className="text-xs text-slate-300">Share with all users</label>
              </div>
              <div className="bg-slate-800/60 rounded-md p-2 text-xs text-slate-400">
                Saves current filters ({activeChips.length} active) + active tab
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(false)} className="border-slate-600 text-slate-300">Cancel</Button>
              <Button size="sm" onClick={handleSaveView} disabled={!viewForm.name.trim() || saveMutation.isPending}
                className="bg-violet-600 hover:bg-violet-700">
                {saveMutation.isPending ? "Saving…" : editingView ? "Update" : "Save View"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
