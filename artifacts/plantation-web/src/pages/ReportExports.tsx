/**
 * ReportExports.tsx
 *
 * Full-featured report export dashboard:
 *  - Export form (report type, format, project, date range)
 *  - Generation queue with real-time status
 *  - Download history with re-download
 *  - Queue statistics (admin/developer)
 */

import { useState, useEffect, useCallback } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  FileDown, Download, RefreshCw, Trash2, Clock, CheckCircle2,
  XCircle, Loader2, BarChart3, FileSpreadsheet, FileText,
  ChevronRight, Calendar, Building2, Filter, AlertCircle,
  TrendingUp, Package, Scale, Truck, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// ── API base ──────────────────────────────────────────────────────────────────
const API = "/api/report-exports";

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Project {
  id: string;
  name: string;
  projectCode: string | null;
  commercialModel: string;
  activationStatus: string;
}

interface ExportJob {
  id: string;
  reportType: string;
  exportFormat: string;
  projectName: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  status: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  errorMessage: string | null;
  userName: string | null;
  userRole: string | null;
  createdAt: string;
}

interface Stats {
  queued: number;
  generating: number;
  completed: number;
  failed: number;
  expired: number;
  last_24h: number;
  last_7d: number;
  total_downloads: number;
  total_bytes: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { value: "financial",    label: "Financial Report",             icon: TrendingUp,    roles: ["admin","developer","landowner","investor","employee"] },
  { value: "project",      label: "Project Summary Report",       icon: Building2,     roles: ["admin","developer","landowner","investor","employee"] },
  { value: "ownership",    label: "Ownership & Equity Report",    icon: Scale,         roles: ["admin","developer","landowner","investor"] },
  { value: "distribution", label: "Distribution & Settlement",    icon: Truck,         roles: ["admin","developer","landowner","investor"] },
  { value: "inventory",    label: "Inventory & Production",       icon: Package,       roles: ["admin","developer","employee","operational_staff"] },
  { value: "governance",   label: "Governance & Compliance",      icon: ShieldCheck,   roles: ["admin","developer"] },
] as const;

const FORMAT_OPTIONS = [
  { value: "pdf",   label: "PDF Document",        icon: FileText },
  { value: "excel", label: "Excel Spreadsheet",   icon: FileSpreadsheet },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

function isExpired(job: ExportJob): boolean {
  if (!job.expiresAt) return false;
  return new Date(job.expiresAt) < new Date();
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  queued:     { label: "Queued",     color: "bg-slate-700 text-slate-200",    icon: Clock },
  generating: { label: "Generating", color: "bg-amber-900/60 text-amber-300", icon: Loader2 },
  completed:  { label: "Completed",  color: "bg-emerald-900/60 text-emerald-300", icon: CheckCircle2 },
  failed:     { label: "Failed",     color: "bg-red-900/60 text-red-300",     icon: XCircle },
  expired:    { label: "Expired",    color: "bg-slate-700 text-slate-400",    icon: Clock },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.queued;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      <Icon className={`w-3 h-3 ${status === "generating" ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}

function JobCard({
  job, onDownload, onDelete, isDownloading,
}: {
  job: ExportJob;
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  isDownloading: boolean;
}) {
  const expired = isExpired(job);
  const canDownload = job.status === "completed" && !expired;
  const reportLabel = REPORT_TYPES.find(r => r.value === job.reportType)?.label ?? job.reportType;
  const Icon = REPORT_TYPES.find(r => r.value === job.reportType)?.icon ?? BarChart3;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 flex items-start gap-4 hover:border-slate-600 transition-colors">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-violet-900/30 border border-violet-700/30 flex items-center justify-center">
        {job.exportFormat === "pdf"
          ? <FileText className="w-5 h-5 text-red-400" />
          : <FileSpreadsheet className="w-5 h-5 text-emerald-400" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{reportLabel}</span>
            <StatusBadge status={expired ? "expired" : job.status} />
            <span className="text-xs text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded uppercase font-mono">
              {job.exportFormat}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {canDownload && (
              <Button
                size="sm" variant="ghost"
                className="h-7 px-2 text-violet-400 hover:text-violet-300 hover:bg-violet-900/30"
                onClick={() => onDownload(job.id)}
                disabled={isDownloading}
              >
                {isDownloading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Download className="w-3.5 h-3.5" />}
                <span className="ml-1 text-xs">Download</span>
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-7 px-2 text-slate-500 hover:text-red-400 hover:bg-red-900/20"
              onClick={() => onDelete(job.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Building2 className="w-3 h-3" /> {job.projectName ?? "—"}
          </span>
          {(job.dateStart || job.dateEnd) && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {[job.dateStart, job.dateEnd].filter(Boolean).map(fmtDateShort).join(" → ")}
            </span>
          )}
          {job.fileSizeBytes && (
            <span className="text-xs text-slate-500">{fmtBytes(job.fileSizeBytes)}</span>
          )}
          {job.downloadCount > 0 && (
            <span className="text-xs text-slate-500">{job.downloadCount} download{job.downloadCount !== 1 ? "s" : ""}</span>
          )}
        </div>

        {job.errorMessage && (
          <p className="mt-1.5 text-xs text-red-400 bg-red-900/20 rounded px-2 py-1 border border-red-900/30">
            {job.errorMessage}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-3">
          <span className="text-xs text-slate-600">
            Requested {fmtDate(job.createdAt)}
          </span>
          {job.generatedAt && (
            <span className="text-xs text-slate-600">
              · Generated {fmtDate(job.generatedAt)}
            </span>
          )}
          {job.expiresAt && !expired && (
            <span className="text-xs text-slate-600">
              · Expires {fmtDateShort(job.expiresAt)}
            </span>
          )}
          {job.userName && (
            <span className="text-xs text-slate-600">· By {job.userName}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReportExports() {
  const { role } = useRole();
  const { toast } = useToast();

  // ── State ─────────────────────────────────────────────────────────────────
  const [projects, setProjects]           = useState<Project[]>([]);
  const [jobs, setJobs]                   = useState<ExportJob[]>([]);
  const [stats, setStats]                 = useState<Stats | null>(null);
  const [byType, setByType]               = useState<{ report_type: string; count: number; downloads: number }[]>([]);
  const [byFormat, setByFormat]           = useState<{ export_format: string; count: number }[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingJobs, setLoadingJobs]     = useState(true);
  const [generating, setGenerating]       = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState("generate");
  const [filterStatus, setFilterStatus]   = useState("all");
  const [filterType, setFilterType]       = useState("all");

  // ── Form state ────────────────────────────────────────────────────────────
  const [reportType, setReportType] = useState<string>("");
  const [exportFormat, setExportFormat] = useState<string>("pdf");
  const [projectId, setProjectId]   = useState<string>("");
  const [dateStart, setDateStart]   = useState<string>("");
  const [dateEnd, setDateEnd]       = useState<string>("");

  const isAdmin = role === "admin" || role === "developer";

  // ── Allowed report types for role ─────────────────────────────────────────
  const allowedReportTypes = REPORT_TYPES.filter(r => r.roles.includes(role as never));

  // ── Data fetching ─────────────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const data = await apiFetch(`${API}/projects`);
      setProjects(data.projects ?? []);
    } catch (err) {
      toast({ title: "Failed to load projects", description: String(err), variant: "destructive" });
    } finally {
      setLoadingProjects(false);
    }
  }, [toast]);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const data = await apiFetch(API);
      setJobs(data.jobs ?? []);
    } catch (err) {
      toast({ title: "Failed to load export history", description: String(err), variant: "destructive" });
    } finally {
      setLoadingJobs(false);
    }
  }, [toast]);

  const loadStats = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await apiFetch(`${API}/stats`);
      setStats(data.stats ?? null);
      setByType(data.byType ?? []);
      setByFormat(data.byFormat ?? []);
    } catch { /* non-critical */ }
  }, [isAdmin]);

  useEffect(() => {
    loadProjects();
    loadJobs();
    loadStats();
  }, [loadProjects, loadJobs, loadStats]);

  // ── Generate export ───────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!reportType) { toast({ title: "Please select a report type", variant: "destructive" }); return; }
    if (!exportFormat) { toast({ title: "Please select a format", variant: "destructive" }); return; }
    if (!projectId) { toast({ title: "Please select a project", variant: "destructive" }); return; }

    setGenerating(true);
    try {
      const data = await apiFetch(API, {
        method: "POST",
        body: JSON.stringify({
          reportType,
          exportFormat,
          projectId,
          dateStart: dateStart || null,
          dateEnd: dateEnd || null,
        }),
      });

      const job: ExportJob = data.job;
      toast({
        title: job.status === "completed" ? "Report generated!" : "Generation failed",
        description: job.status === "completed"
          ? `${job.fileName} (${fmtBytes(job.fileSizeBytes)}) is ready to download.`
          : job.errorMessage ?? "An error occurred",
        variant: job.status === "completed" ? "default" : "destructive",
      });

      await loadJobs();
      await loadStats();

      if (job.status === "completed") {
        setActiveTab("history");
      }
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = async (jobId: string) => {
    setDownloadingId(jobId);
    try {
      const response = await fetch(`${API}/${jobId}/download`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "report.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: filename });
      await loadJobs();
    } catch (err) {
      toast({ title: "Download failed", description: String(err), variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (jobId: string) => {
    try {
      await apiFetch(`${API}/${jobId}`, { method: "DELETE" });
      setJobs(prev => prev.filter(j => j.id !== jobId));
      await loadStats();
      toast({ title: "Export removed" });
    } catch (err) {
      toast({ title: "Delete failed", description: String(err), variant: "destructive" });
    }
  };

  // ── Filtered jobs ─────────────────────────────────────────────────────────
  const filteredJobs = jobs.filter(j => {
    if (filterStatus !== "all") {
      const effectiveStatus = isExpired(j) ? "expired" : j.status;
      if (effectiveStatus !== filterStatus) return false;
    }
    if (filterType !== "all" && j.reportType !== filterType) return false;
    return true;
  });

  // ── Stats computed ─────────────────────────────────────────────────────────
  const completedJobs = jobs.filter(j => j.status === "completed" && !isExpired(j));
  const failedJobs    = jobs.filter(j => j.status === "failed");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
            <FileDown className="w-4 h-4" />
            <span>System</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-white">Report Exports</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Report Exports</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Generate and download PDF or Excel reports with project-wise and date-range filtering
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-slate-700 text-slate-300 hover:bg-slate-800"
          onClick={() => { loadJobs(); loadStats(); }}
        >
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Completed",   value: completedJobs.length, color: "text-emerald-400", icon: CheckCircle2 },
          { label: "Failed",      value: failedJobs.length,    color: "text-red-400",     icon: XCircle },
          { label: "Total Exports", value: jobs.length,         color: "text-violet-400",  icon: FileDown },
          { label: "Downloads",   value: jobs.reduce((s,j) => s + (j.downloadCount ?? 0), 0), color: "text-blue-400", icon: Download },
        ].map(s => (
          <div key={s.label} className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3 flex items-center gap-3">
            <s.icon className={`w-5 h-5 ${s.color}`} />
            <div>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-400">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Admin stats panel */}
      {isAdmin && stats && (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-violet-400" /> Queue Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
            {[
              { k: "queued",     label: "Queued",     color: "text-slate-300" },
              { k: "generating", label: "Generating", color: "text-amber-400" },
              { k: "completed",  label: "Completed",  color: "text-emerald-400" },
              { k: "failed",     label: "Failed",     color: "text-red-400" },
              { k: "expired",    label: "Expired",    color: "text-slate-500" },
            ].map(item => (
              <div key={item.k} className="text-center">
                <p className={`text-2xl font-bold ${item.color}`}>
                  {(stats as unknown as Record<string, number>)[item.k] ?? 0}
                </p>
                <p className="text-xs text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {/* By type */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-2">By Report Type</p>
              <div className="space-y-1.5">
                {byType.map(bt => (
                  <div key={bt.report_type} className="flex items-center gap-2">
                    <span className="text-xs text-slate-300 capitalize w-32">{bt.report_type}</span>
                    <div className="flex-1 bg-slate-700/40 rounded h-1.5">
                      <div
                        className="bg-violet-500 h-1.5 rounded"
                        style={{ width: `${Math.min(100, (Number(bt.count) / Math.max(...byType.map(x => Number(x.count)), 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-6 text-right">{bt.count}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* By format */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-2">By Format</p>
              <div className="space-y-1.5">
                {byFormat.map(bf => (
                  <div key={bf.export_format} className="flex items-center gap-3">
                    {bf.export_format === "pdf"
                      ? <FileText className="w-4 h-4 text-red-400" />
                      : <FileSpreadsheet className="w-4 h-4 text-emerald-400" />}
                    <span className="text-xs text-slate-300 uppercase font-mono w-10">{bf.export_format}</span>
                    <div className="flex-1 bg-slate-700/40 rounded h-1.5">
                      <div
                        className={`h-1.5 rounded ${bf.export_format === "pdf" ? "bg-red-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, (Number(bf.count) / Math.max(...byFormat.map(x => Number(x.count)), 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-6 text-right">{bf.count}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 flex gap-6">
                <div>
                  <p className="text-lg font-bold text-blue-400">{stats.total_downloads}</p>
                  <p className="text-xs text-slate-500">Total Downloads</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-violet-400">{fmtBytes(stats.total_bytes)}</p>
                  <p className="text-xs text-slate-500">Total Storage Used</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-amber-400">{stats.last_24h}</p>
                  <p className="text-xs text-slate-500">Last 24h</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="generate" className="data-[state=active]:bg-violet-700 data-[state=active]:text-white">
            <FileDown className="w-4 h-4 mr-2" /> New Export
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-violet-700 data-[state=active]:text-white">
            <Clock className="w-4 h-4 mr-2" /> History
            {jobs.length > 0 && (
              <span className="ml-2 bg-slate-600 text-slate-200 text-xs px-1.5 rounded-full">
                {jobs.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Generate Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="generate" className="mt-4">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Left: Form */}
            <Card className="bg-slate-800/60 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <FileDown className="w-4 h-4 text-violet-400" /> Configure Export
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Report Type */}
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Report Type *</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {allowedReportTypes.map(rt => {
                      const Icon = rt.icon;
                      const active = reportType === rt.value;
                      return (
                        <button
                          key={rt.value}
                          onClick={() => setReportType(rt.value)}
                          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all ${
                            active
                              ? "border-violet-500 bg-violet-900/30 text-violet-200"
                              : "border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500 hover:bg-slate-700/40"
                          }`}
                        >
                          <Icon className={`w-4 h-4 ${active ? "text-violet-400" : "text-slate-400"}`} />
                          <span className="text-sm font-medium">{rt.label}</span>
                          {active && <CheckCircle2 className="w-4 h-4 text-violet-400 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Format */}
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Export Format *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMAT_OPTIONS.map(fmt => {
                      const Icon = fmt.icon;
                      const active = exportFormat === fmt.value;
                      return (
                        <button
                          key={fmt.value}
                          onClick={() => setExportFormat(fmt.value)}
                          className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-left transition-all ${
                            active
                              ? "border-violet-500 bg-violet-900/30 text-violet-200"
                              : "border-slate-700 bg-slate-800/40 text-slate-300 hover:border-slate-500"
                          }`}
                        >
                          <Icon className={`w-4 h-4 ${active ? (fmt.value === "pdf" ? "text-red-400" : "text-emerald-400") : "text-slate-400"}`} />
                          <span className="text-sm font-medium">{fmt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Project */}
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm">Project *</Label>
                  <Select value={projectId} onValueChange={setProjectId} disabled={loadingProjects}>
                    <SelectTrigger className="bg-slate-900 border-slate-600 text-slate-200 h-10">
                      <SelectValue placeholder={loadingProjects ? "Loading projects…" : "Select a project"} />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id} className="text-slate-200 focus:bg-slate-700">
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            {p.projectCode && (
                              <span className="text-xs text-slate-400 font-mono">[{p.projectCode}]</span>
                            )}
                            <span className={`text-xs px-1.5 rounded ${
                              p.activationStatus === "active" ? "bg-emerald-900/50 text-emerald-400" : "bg-slate-700 text-slate-400"
                            }`}>{p.activationStatus}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date range */}
                <div className="space-y-2">
                  <Label className="text-slate-300 text-sm flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" /> Date Range
                    <span className="text-slate-500 text-xs font-normal">(optional)</span>
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-slate-500 text-xs mb-1 block">From</Label>
                      <Input
                        type="date"
                        value={dateStart}
                        onChange={e => setDateStart(e.target.value)}
                        className="bg-slate-900 border-slate-600 text-slate-200 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-slate-500 text-xs mb-1 block">To</Label>
                      <Input
                        type="date"
                        value={dateEnd}
                        onChange={e => setDateEnd(e.target.value)}
                        className="bg-slate-900 border-slate-600 text-slate-200 h-9 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  className="w-full bg-violet-700 hover:bg-violet-600 text-white font-semibold h-11"
                  onClick={handleGenerate}
                  disabled={generating || !reportType || !exportFormat || !projectId}
                >
                  {generating ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating report…</>
                  ) : (
                    <><FileDown className="w-4 h-4 mr-2" /> Generate & Download</>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Right: Info + role summary */}
            <div className="space-y-4">
              <Card className="bg-slate-800/60 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white text-sm flex items-center gap-2">
                    <Filter className="w-4 h-4 text-violet-400" /> Report Contents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {reportType ? (
                    <div className="space-y-2">
                      {reportType === "financial" && (
                        <ul className="text-sm text-slate-300 space-y-1">
                          {["Partner contributions (verified)","Expenditures (approved)","Sales transactions","Distribution records","LCA ledger history"].map(i => (
                            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />{i}</li>
                          ))}
                        </ul>
                      )}
                      {reportType === "project" && (
                        <ul className="text-sm text-slate-300 space-y-1">
                          {["Project metadata & lifecycle","Partner ownership structure","Agreement register","Project timeline events"].map(i => (
                            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />{i}</li>
                          ))}
                        </ul>
                      )}
                      {reportType === "ownership" && (
                        <ul className="text-sm text-slate-300 space-y-1">
                          {["Current ownership percentages","Ownership transfer history","Inheritance claims & claimants","Write-once ownership audit trail"].map(i => (
                            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />{i}</li>
                          ))}
                        </ul>
                      )}
                      {reportType === "distribution" && (
                        <ul className="text-sm text-slate-300 space-y-1">
                          {["Distribution records with deduction breakdown","Settlement records","50% revenue sessions","Per-partner net payable summary"].map(i => (
                            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />{i}</li>
                          ))}
                        </ul>
                      )}
                      {reportType === "inventory" && (
                        <ul className="text-sm text-slate-300 space-y-1">
                          {["Current stock balances & values","Inventory movements (in/out)","Production batch log","Active reservations"].map(i => (
                            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />{i}</li>
                          ))}
                        </ul>
                      )}
                      {reportType === "governance" && (
                        <ul className="text-sm text-slate-300 space-y-1">
                          {["Disputes & resolution log","Governance overrides (immutable audit)","Operational alerts","Nominee status","Inheritance claims","Legal evidence archive"].map(i => (
                            <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />{i}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Select a report type to see what data will be included.</p>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-800/60 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400" /> Notes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-slate-400">
                  <p>• Reports are generated immediately and available for <strong className="text-slate-300">7 days</strong>.</p>
                  <p>• PDF reports are landscape A4 with data tables, summary KPIs, and page numbers.</p>
                  <p>• Excel reports include a cover sheet, summary tab, and one worksheet per data section with frozen headers and auto-filters.</p>
                  <p>• Date range applies to time-series data (contributions, expenditures, sales, etc.). Project and ownership reports always show full history.</p>
                  <p>• Governance reports use write-once data — audit integrity is preserved.</p>
                  <p>• Your role: <strong className="text-violet-300 capitalize">{role}</strong> — {allowedReportTypes.length} report type{allowedReportTypes.length !== 1 ? "s" : ""} available.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── History Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-400">Filter:</span>
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-300 h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-slate-200 text-xs">All statuses</SelectItem>
                  <SelectItem value="completed" className="text-slate-200 text-xs">Completed</SelectItem>
                  <SelectItem value="failed" className="text-slate-200 text-xs">Failed</SelectItem>
                  <SelectItem value="expired" className="text-slate-200 text-xs">Expired</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-300 h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-slate-200 text-xs">All report types</SelectItem>
                  {REPORT_TYPES.map(rt => (
                    <SelectItem key={rt.value} value={rt.value} className="text-slate-200 text-xs capitalize">
                      {rt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-slate-500 ml-auto">
                {filteredJobs.length} of {jobs.length} export{jobs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Job list */}
            {loadingJobs ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 text-violet-400 animate-spin mr-3" />
                <span className="text-slate-400">Loading export history…</span>
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileDown className="w-12 h-12 text-slate-700 mb-4" />
                <p className="text-slate-400 font-medium">No exports found</p>
                <p className="text-slate-600 text-sm mt-1">
                  {jobs.length === 0
                    ? "You haven't generated any reports yet."
                    : "No exports match the current filters."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 border-slate-700 text-slate-300 hover:bg-slate-800"
                  onClick={() => setActiveTab("generate")}
                >
                  Generate your first report
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredJobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    isDownloading={downloadingId === job.id}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
