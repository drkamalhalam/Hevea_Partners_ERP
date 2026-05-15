import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  HardDriveDownload,
  FileJson,
  Files,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  BarChart3,
  BookOpen,
  Loader2,
  Database,
  HardDrive,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

interface BackupRun {
  id: string;
  type: "data_export" | "document_manifest" | "integrity_check" | "storage_stats";
  status: "running" | "completed" | "failed";
  triggeredByName: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  totalRecords: number | null;
  fileSizeBytes: number | null;
  notes: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface IntegrityIssue {
  severity: "error" | "warning" | "info";
  check: string;
  detail: string;
}

interface IntegrityResult {
  tableCounts: Record<string, number>;
  issues: IntegrityIssue[];
  checksPerformed: number;
  issueCount: number;
  checkedAt: string;
  durationMs: number;
}

interface StorageStats {
  totalDocuments: number;
  activeDocuments: number;
  archivedDocuments: number;
  deletedDocuments: number;
  missingPathDocuments: number;
  totalFileSizeBytes: number;
  activeFileSizeBytes: number;
  byCategory: { category: string; count: number; totalBytes: number }[];
  byProject: { projectName: string; count: number; totalBytes: number }[];
  checkedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function runTypeLabel(type: BackupRun["type"]): string {
  switch (type) {
    case "data_export": return "Data Export";
    case "document_manifest": return "Doc Manifest";
    case "integrity_check": return "Integrity Check";
    case "storage_stats": return "Storage Stats";
  }
}

function runTypeIcon(type: BackupRun["type"]) {
  switch (type) {
    case "data_export": return <FileJson className="w-3.5 h-3.5" />;
    case "document_manifest": return <Files className="w-3.5 h-3.5" />;
    case "integrity_check": return <ShieldCheck className="w-3.5 h-3.5" />;
    case "storage_stats": return <BarChart3 className="w-3.5 h-3.5" />;
  }
}

function statusBadge(status: BackupRun["status"]) {
  switch (status) {
    case "completed":
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Completed</Badge>;
    case "running":
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Running</Badge>;
    case "failed":
      return <Badge className="bg-red-100 text-red-800 border-red-200">Failed</Badge>;
  }
}

function issueSeverityIcon(severity: IntegrityIssue["severity"]) {
  switch (severity) {
    case "error": return <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
    case "warning": return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
    case "info": return <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  }
}

// ── Main component ────────────────────────────────────────────────────────

export default function BackupExport() {
  const [tab, setTab] = useState("overview");

  // History
  const [history, setHistory] = useState<BackupRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Storage stats
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Integrity
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(false);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  // Export operations
  const [exportingData, setExportingData] = useState(false);
  const [exportingDocs, setExportingDocs] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ── Fetchers ───────────────────────────────────────────────────────────

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch("/api/backup/history");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { runs: BackupRun[] };
      setHistory(data.runs);
    } catch {
      // silently ignore; UI will show empty state
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await fetch("/api/backup/storage-stats");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as StorageStats;
      setStats(data);
    } catch {
      // silently ignore
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    fetchStats();
  }, [fetchHistory, fetchStats]);

  // ── Actions ────────────────────────────────────────────────────────────

  async function handleExportData() {
    setExportingData(true);
    setExportError(null);
    try {
      const r = await fetch("/api/backup/export/data", { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `hevea-erp-export-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await fetchHistory();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingData(false);
    }
  }

  async function handleExportDocuments() {
    setExportingDocs(true);
    setExportError(null);
    try {
      const r = await fetch("/api/backup/export/documents", { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `hevea-document-manifest-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await fetchHistory();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingDocs(false);
    }
  }

  async function handleVerify() {
    setIntegrityLoading(true);
    setIntegrityError(null);
    setIntegrity(null);
    try {
      const r = await fetch("/api/backup/verify");
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as IntegrityResult;
      setIntegrity(data);
      await fetchHistory();
    } catch (err) {
      setIntegrityError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIntegrityLoading(false);
    }
  }

  // ── Derived stats ──────────────────────────────────────────────────────

  const lastDataExport = history.find((r) => r.type === "data_export" && r.status === "completed");
  const lastDocManifest = history.find((r) => r.type === "document_manifest" && r.status === "completed");
  const lastIntegrityCheck = history.find((r) => r.type === "integrity_check" && r.status === "completed");

  const totalTableCount = integrity
    ? Object.keys(integrity.tableCounts).length
    : null;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-6xl">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <HardDriveDownload className="w-6 h-6 text-gray-700" />
              <h1 className="text-2xl font-bold text-gray-900">Backup & Export</h1>
            </div>
            <p className="text-sm text-gray-500">
              Export ERP data, document manifests, and run integrity checks. Admin only.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchHistory(); fetchStats(); }}
            disabled={historyLoading || statsLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${historyLoading || statsLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="data">Data Export</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="guide">Recovery Guide</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-6 mt-4">

            {/* Status cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
                    <Database className="w-4 h-4" /> Last Data Export
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lastDataExport ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900">
                        {fmtDate(lastDataExport.completedAt ?? lastDataExport.startedAt)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {lastDataExport.totalRecords?.toLocaleString()} records ·{" "}
                        {fmtBytes(lastDataExport.fileSizeBytes ?? 0)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">No export yet</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
                    <Files className="w-4 h-4" /> Last Doc Manifest
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lastDocManifest ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900">
                        {fmtDate(lastDocManifest.completedAt ?? lastDocManifest.startedAt)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {lastDocManifest.totalRecords?.toLocaleString()} documents ·{" "}
                        {fmtBytes(lastDocManifest.fileSizeBytes ?? 0)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">No manifest yet</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-gray-500 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Last Integrity Check
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lastIntegrityCheck ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900">
                        {fmtDate(lastIntegrityCheck.completedAt ?? lastIntegrityCheck.startedAt)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {(lastIntegrityCheck.metadata as { issueCount?: number } | null)?.issueCount === 0
                          ? "✓ No issues"
                          : `${(lastIntegrityCheck.metadata as { issueCount?: number } | null)?.issueCount ?? "?"} issue(s)`}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">Never run</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Storage stats */}
            {stats && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HardDrive className="w-4 h-4" /> Document Storage
                  </CardTitle>
                  <CardDescription className="text-xs">
                    As of {fmtDate(stats.checkedAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {[
                      { label: "Total", value: stats.totalDocuments.toLocaleString(), sub: fmtBytes(stats.totalFileSizeBytes) },
                      { label: "Active", value: stats.activeDocuments.toLocaleString(), sub: fmtBytes(stats.activeFileSizeBytes) },
                      { label: "Archived", value: stats.archivedDocuments.toLocaleString(), sub: "" },
                      { label: "Missing Path", value: stats.missingPathDocuments.toLocaleString(), sub: stats.missingPathDocuments > 0 ? "⚠ Action needed" : "✓ OK", highlight: stats.missingPathDocuments > 0 },
                    ].map((item) => (
                      <div key={item.label} className={`rounded-lg p-3 ${item.highlight ? "bg-red-50 border border-red-200" : "bg-gray-50"}`}>
                        <p className="text-xs text-gray-500">{item.label}</p>
                        <p className={`text-lg font-bold ${item.highlight ? "text-red-700" : "text-gray-900"}`}>{item.value}</p>
                        {item.sub && <p className="text-xs text-gray-400 mt-0.5">{item.sub}</p>}
                      </div>
                    ))}
                  </div>

                  {stats.byCategory.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-gray-500 mb-2">By Category</p>
                      <div className="flex flex-wrap gap-2">
                        {stats.byCategory.map((c) => (
                          <span key={c.category} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                            <span className="font-medium">{c.category}</span>
                            <span className="text-gray-400">·</span>
                            <span>{c.count}</span>
                            <span className="text-gray-400">·</span>
                            <span>{fmtBytes(c.totalBytes)}</span>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Integrity check panel */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4" /> Integrity Verification
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Runs 7 consistency checks across the database. Results are logged.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleVerify}
                    disabled={integrityLoading}
                  >
                    {integrityLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 mr-2" />
                    )}
                    {integrityLoading ? "Checking…" : "Run Check"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {integrityError && (
                  <Alert variant="destructive" className="mb-3">
                    <AlertDescription>{integrityError}</AlertDescription>
                  </Alert>
                )}
                {!integrity && !integrityLoading && !integrityError && (
                  <p className="text-sm text-gray-400 text-center py-4">
                    Click "Run Check" to verify database integrity.
                  </p>
                )}
                {integrity && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-500">{integrity.checksPerformed} checks performed</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">{totalTableCount} tables</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-500">{fmtDuration(integrity.durationMs)}</span>
                      <span className="text-gray-300">·</span>
                      {integrity.issueCount === 0 ? (
                        <span className="text-emerald-600 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" /> All clear
                        </span>
                      ) : (
                        <span className="text-red-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-4 h-4" /> {integrity.issueCount} issue(s)
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {integrity.issues.map((issue, i) => (
                        <div key={i} className={`flex items-start gap-2 p-2.5 rounded-md text-sm ${
                          issue.severity === "error" ? "bg-red-50 border border-red-100" :
                          issue.severity === "warning" ? "bg-amber-50 border border-amber-100" :
                          "bg-emerald-50 border border-emerald-100"
                        }`}>
                          {issueSeverityIcon(issue.severity)}
                          <div>
                            <span className="font-medium text-gray-700">{issue.check}: </span>
                            <span className="text-gray-600">{issue.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Run history table */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Export & Check History</CardTitle>
                <CardDescription className="text-xs">Last 50 backup operations</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {historyLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">
                    No exports or checks recorded yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Records</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Triggered By</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm">
                              {runTypeIcon(run.type)}
                              {runTypeLabel(run.type)}
                            </span>
                          </TableCell>
                          <TableCell>{statusBadge(run.status)}</TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {run.totalRecords != null ? run.totalRecords.toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {run.fileSizeBytes != null ? fmtBytes(run.fileSizeBytes) : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {fmtDuration(run.durationMs)}
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {run.triggeredByName ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm text-gray-400">
                            {fmtDate(run.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── DATA EXPORT TAB ──────────────────────────────────────── */}
          <TabsContent value="data" className="space-y-4 mt-4">
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                The data export captures <strong>every table</strong> in the PostgreSQL database as a single JSON file.
                The export is self-describing: it includes table counts, timestamps, and a restore guide.
                New tables added to the schema are automatically included.
              </AlertDescription>
            </Alert>

            {exportError && (
              <Alert variant="destructive">
                <AlertDescription>{exportError}</AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileJson className="w-4 h-4" /> Full ERP Data Export
                </CardTitle>
                <CardDescription>
                  Downloads a timestamped JSON file containing all ERP tables. Suitable for
                  archiving, migration, and partial or full restoration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                  <div>
                    <p className="font-medium text-gray-700 mb-1">What is included</p>
                    <ul className="space-y-0.5 text-xs list-disc list-inside text-gray-500">
                      <li>All 65+ database tables</li>
                      <li>Projects, Partners, Agreements</li>
                      <li>Financial records (LCA, Expenditure, Settlement)</li>
                      <li>Operations (Sales, Production, Inventory)</li>
                      <li>Governance (Nominees, Inheritance, Succession)</li>
                      <li>System tables (Users, Audit logs, Backup history)</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-gray-700 mb-1">What is NOT included</p>
                    <ul className="space-y-0.5 text-xs list-disc list-inside text-gray-500">
                      <li>Uploaded document files (use Document Manifest tab)</li>
                      <li>Clerk user account data (migrate via Clerk dashboard)</li>
                      <li>Application source code</li>
                    </ul>
                  </div>
                </div>

                {lastDataExport && (
                  <div className="text-xs text-gray-400 bg-gray-50 rounded px-3 py-2">
                    Last export: {fmtDate(lastDataExport.completedAt ?? lastDataExport.startedAt)}
                    {lastDataExport.totalRecords != null && ` · ${lastDataExport.totalRecords.toLocaleString()} records`}
                    {lastDataExport.fileSizeBytes != null && ` · ${fmtBytes(lastDataExport.fileSizeBytes)}`}
                    {lastDataExport.triggeredByName && ` · by ${lastDataExport.triggeredByName}`}
                  </div>
                )}

                <Button
                  onClick={handleExportData}
                  disabled={exportingData}
                  className="bg-gray-900 hover:bg-gray-800"
                >
                  {exportingData ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <HardDriveDownload className="w-4 h-4 mr-2" />
                  )}
                  {exportingData ? "Exporting… (this may take a minute)" : "Export All ERP Data"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Export File Format</CardTitle>
                <CardDescription>Structure of the downloaded JSON file</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-950 text-gray-300 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed">
{`{
  "meta": {
    "schemaVersion": "1.0",
    "application": "Hevea Partners ERP",
    "exportedAt": "2026-05-15T10:00:00Z",
    "exportedBy": "Admin Name",
    "tableCount": 65,
    "totalRecords": 12450,
    "durationMs": 3200,
    "restoreNote": "..."
  },
  "counts": {
    "projects": 12,
    "partners": 87,
    "agreements": 203,
    ...
  },
  "tables": {
    "projects": [ {...}, {...} ],
    "partners": [ {...}, {...} ],
    ...
  }
}`}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── DOCUMENTS TAB ────────────────────────────────────────── */}
          <TabsContent value="documents" className="space-y-4 mt-4">
            <Alert className="bg-amber-50 border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                The document manifest lists metadata and storage paths for all uploaded files.
                The actual files are stored in Google Cloud Storage — use <code className="bg-amber-100 px-1 rounded">gsutil</code> or
                <code className="bg-amber-100 px-1 rounded ml-1">rclone</code> to copy them when migrating.
                See the Recovery Guide tab for step-by-step instructions.
              </AlertDescription>
            </Alert>

            {exportError && (
              <Alert variant="destructive">
                <AlertDescription>{exportError}</AlertDescription>
              </Alert>
            )}

            {/* Storage overview */}
            {stats && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Storage Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Active files", value: stats.activeDocuments, size: stats.activeFileSizeBytes },
                      { label: "Archived", value: stats.archivedDocuments, size: null },
                      { label: "Total (incl. deleted)", value: stats.totalDocuments, size: stats.totalFileSizeBytes },
                      { label: "Missing path", value: stats.missingPathDocuments, size: null, warn: stats.missingPathDocuments > 0 },
                    ].map((s) => (
                      <div key={s.label} className={`rounded-lg p-3 ${s.warn ? "bg-red-50 border border-red-200" : "bg-gray-50"}`}>
                        <p className="text-xs text-gray-500">{s.label}</p>
                        <p className={`text-xl font-bold ${s.warn ? "text-red-700" : "text-gray-900"}`}>
                          {s.value.toLocaleString()}
                        </p>
                        {s.size != null && (
                          <p className="text-xs text-gray-400">{fmtBytes(s.size)}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {stats.byProject.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-2">Top Projects by Storage</p>
                      <div className="space-y-1.5">
                        {stats.byProject.slice(0, 8).map((p) => {
                          const pct = stats.totalFileSizeBytes > 0
                            ? Math.round((p.totalBytes / stats.totalFileSizeBytes) * 100)
                            : 0;
                          return (
                            <div key={p.projectName} className="flex items-center gap-3">
                              <p className="text-xs text-gray-600 w-40 truncate">{p.projectName}</p>
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <p className="text-xs text-gray-500 w-16 text-right">{fmtBytes(p.totalBytes)}</p>
                              <p className="text-xs text-gray-400 w-8 text-right">{p.count}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Files className="w-4 h-4" /> Document Manifest Export
                </CardTitle>
                <CardDescription>
                  Downloads a JSON file listing every document with its GCS storage path, category,
                  project, and metadata. Essential for file recovery and storage migration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {lastDocManifest && (
                  <div className="text-xs text-gray-400 bg-gray-50 rounded px-3 py-2">
                    Last manifest: {fmtDate(lastDocManifest.completedAt ?? lastDocManifest.startedAt)}
                    {lastDocManifest.totalRecords != null && ` · ${lastDocManifest.totalRecords.toLocaleString()} documents`}
                    {lastDocManifest.fileSizeBytes != null && ` · ${fmtBytes(lastDocManifest.fileSizeBytes)}`}
                  </div>
                )}
                <Button
                  onClick={handleExportDocuments}
                  disabled={exportingDocs}
                  variant="outline"
                >
                  {exportingDocs ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Files className="w-4 h-4 mr-2" />
                  )}
                  {exportingDocs ? "Generating manifest…" : "Export Document Manifest"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── RECOVERY GUIDE TAB ───────────────────────────────────── */}
          <TabsContent value="guide" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BookOpen className="w-4 h-4" /> Disaster Recovery Quick Reference
                </CardTitle>
                <CardDescription>
                  Full documentation is in <code className="bg-gray-100 px-1 rounded text-xs">DISASTER_RECOVERY.md</code> at the project root.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 text-sm text-gray-700">

                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">How to Export</h3>
                  <ol className="list-decimal list-inside space-y-1 text-gray-600">
                    <li>Go to the <strong>Data Export</strong> tab → click <em>Export All ERP Data</em>. Downloads a full JSON file.</li>
                    <li>Go to the <strong>Documents</strong> tab → click <em>Export Document Manifest</em>. Lists all uploaded files with their GCS paths.</li>
                    <li>Run the Integrity Check (Overview tab) to confirm there are no errors before relying on an export.</li>
                  </ol>
                </div>

                <Separator />

                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">How to Restore</h3>
                  <ol className="list-decimal list-inside space-y-1 text-gray-600">
                    <li>Provision a new PostgreSQL 14+ database.</li>
                    <li>Copy environment variables from <code className="bg-gray-100 px-0.5 rounded">.env.example</code>.</li>
                    <li>Run <code className="bg-gray-100 px-1 rounded text-xs">pnpm --filter @workspace/db run push</code> to create the schema.</li>
                    <li>Import the JSON export using the restore script in <code className="bg-gray-100 px-0.5 rounded">DISASTER_RECOVERY.md §4</code>.</li>
                    <li>Copy document files to the new storage bucket using <code className="bg-gray-100 px-1 rounded text-xs">gsutil</code> or <code className="bg-gray-100 px-1 rounded text-xs">rclone</code>.</li>
                    <li>Run the integrity check on the restored environment to confirm.</li>
                  </ol>
                </div>

                <Separator />

                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">How to Migrate to a New Provider</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: "Database", desc: "Standard PostgreSQL — runs on AWS RDS, Supabase, Railway, Neon, or any self-hosted instance." },
                      { label: "Storage", desc: "Override REPLIT_SIDECAR_ENDPOINT to point at a compatible GCS sidecar or adapt objectStorage.ts." },
                      { label: "Auth", desc: "Clerk supports standalone external tenants — replace CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY." },
                    ].map((item) => (
                      <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                        <p className="font-medium text-gray-800 text-xs mb-1">{item.label}</p>
                        <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    See the full migration checklist in <code className="bg-gray-100 px-0.5 rounded">DISASTER_RECOVERY.md §6</code>.
                  </p>
                </div>

                <Separator />

                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">After Server Failure</h3>
                  <ul className="list-disc list-inside space-y-1 text-gray-600 text-sm">
                    <li>The application is stateless — all state is in PostgreSQL and GCS. Redeploy and point at the existing database and storage bucket.</li>
                    <li>Contact Replit support for managed PostgreSQL snapshot restoration.</li>
                    <li>For partial table loss, extract only the affected table from the JSON export and use <code className="bg-gray-100 px-0.5 rounded">INSERT … ON CONFLICT DO NOTHING</code>.</li>
                  </ul>
                </div>

                <Separator />

                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Recommended Schedule</h3>
                  <div className="space-y-1.5">
                    {[
                      { freq: "Daily", action: "ERP data export (via UI or cURL)" },
                      { freq: "Weekly", action: "Document manifest export" },
                      { freq: "Weekly", action: "Integrity check — alert on any errors" },
                      { freq: "Before major changes", action: "Export + integrity check" },
                    ].map((s) => (
                      <div key={s.freq} className="flex gap-3 text-sm">
                        <span className="w-36 font-medium text-gray-700 flex-shrink-0">{s.freq}</span>
                        <span className="text-gray-500">{s.action}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
