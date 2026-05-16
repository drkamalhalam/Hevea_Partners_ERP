import { useState, useMemo, useRef } from "react";
import { useAuthFetch } from "../lib/authFetch";
import {
  useListEvidence,
  useGetEvidenceStats,
  useGetEvidence,
  useCreateEvidence,
  useAddEvidenceVersion,
  useUpdateEvidenceStatus,
  useListProjects,
} from "@workspace/api-client-react";
import { useRole } from "../contexts/RoleContext";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Card, CardContent } from "../components/ui/card";
import {
  Archive,
  Download,
  Eye,
  FileText,
  History,
  Lock,
  Plus,
  Search,
  Shield,
  Upload,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle2,
  Copy,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvidenceRecord {
  id: string;
  projectId?: string | null;
  projectName?: string | null;
  documentType: string;
  title: string;
  description?: string | null;
  tags?: string[] | null;
  versionNumber: number;
  parentArchiveId?: string | null;
  isLatestVersion: boolean;
  fileObjectPath?: string | null;
  externalUrl?: string | null;
  originalFileName?: string | null;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  checksum?: string | null;
  relatedTable?: string | null;
  relatedRecordId?: string | null;
  documentDate?: string | null;
  issuingAuthority?: string | null;
  referenceNumber?: string | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  uploadedByRole?: string | null;
  archiveStatus: string;
  metadata?: Record<string, unknown> | null;
  accessCount?: number | null;
  archivedAt: string;
  createdAt: string;
}

interface AccessLogEntry {
  id: string;
  evidenceId: string;
  accessType: string;
  actorName?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  accessedAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: "agreement", label: "Agreement" },
  { value: "declaration_deed", label: "Declaration Deed" },
  { value: "death_certificate", label: "Death Certificate" },
  { value: "gd_entry", label: "GD Entry" },
  { value: "invoice", label: "Invoice" },
  { value: "payment_proof", label: "Payment Proof" },
  { value: "governance_document", label: "Governance Document" },
  { value: "supporting_evidence", label: "Supporting Evidence" },
  { value: "other", label: "Other" },
];

const DOC_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((t) => [t.value, t.label]),
);

const DOC_TYPE_COLORS: Record<string, string> = {
  agreement: "bg-blue-100 text-blue-800",
  declaration_deed: "bg-purple-100 text-purple-800",
  death_certificate: "bg-gray-100 text-gray-800",
  gd_entry: "bg-orange-100 text-orange-800",
  invoice: "bg-green-100 text-green-800",
  payment_proof: "bg-emerald-100 text-emerald-800",
  governance_document: "bg-indigo-100 text-indigo-800",
  supporting_evidence: "bg-yellow-100 text-yellow-800",
  other: "bg-gray-100 text-gray-600",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  superseded: "bg-gray-100 text-gray-500",
  archived: "bg-amber-100 text-amber-700",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function capitalize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

// ── Upload helper ─────────────────────────────────────────────────────────────

async function uploadFileToStorage(file: File): Promise<{ objectPath: string }> {
  const res = await fetch(`${BASE_URL}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  const { uploadURL, objectPath } = (await res.json()) as { uploadURL: string; objectPath: string };

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putRes.ok) throw new Error("Failed to upload file to storage");

  return { objectPath };
}

// ── Archive Form (used by both create and version dialogs) ────────────────────

function ArchiveForm({
  value,
  onChange,
  projects,
  showProject,
  defaultType,
}: {
  value: Record<string, unknown>;
  onChange: (key: string, v: unknown) => void;
  projects: { id: string; name: string }[];
  showProject?: boolean;
  defaultType?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { objectPath } = await uploadFileToStorage(file);
      onChange("fileObjectPath", objectPath);
      onChange("originalFileName", file.name);
      onChange("fileSizeBytes", file.size);
      onChange("mimeType", file.type || "application/octet-stream");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {showProject && (
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Project</Label>
          <Select value={(value.projectId as string) ?? "none"} onValueChange={(v) => onChange("projectId", v === "none" ? null : v)}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="Select project (optional)…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— No project (global) —</SelectItem>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Document Type *</Label>
          <Select value={(value.documentType as string) ?? defaultType ?? ""} onValueChange={(v) => onChange("documentType", v)}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Reference Number</Label>
          <Input
            value={(value.referenceNumber as string) ?? ""}
            onChange={(e) => onChange("referenceNumber", e.target.value)}
            placeholder="GD no., invoice no.…"
            className="text-sm"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-gray-500 mb-1 block">Title *</Label>
        <Input
          value={(value.title as string) ?? ""}
          onChange={(e) => onChange("title", e.target.value)}
          placeholder="Descriptive document title…"
        />
      </div>
      <div>
        <Label className="text-xs text-gray-500 mb-1 block">Description</Label>
        <Textarea
          value={(value.description as string) ?? ""}
          onChange={(e) => onChange("description", e.target.value)}
          rows={2}
          placeholder="Context, parties involved, period covered…"
          className="text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Document Date</Label>
          <Input
            type="date"
            value={(value.documentDate as string) ?? ""}
            onChange={(e) => onChange("documentDate", e.target.value ? `${e.target.value}T00:00:00Z` : null)}
            className="text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-gray-500 mb-1 block">Issuing Authority</Label>
          <Input
            value={(value.issuingAuthority as string) ?? ""}
            onChange={(e) => onChange("issuingAuthority", e.target.value)}
            placeholder="Court, registrar, authority…"
            className="text-sm"
          />
        </div>
      </div>
      <div className="border-t pt-3">
        <Label className="text-xs text-gray-500 mb-2 block font-medium">File Upload</Label>
        <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />
        {value.fileObjectPath ? (
          <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 truncate">{(value.originalFileName as string) ?? "File uploaded"}</span>
            <button
              className="text-green-600 underline"
              onClick={() => { onChange("fileObjectPath", null); onChange("originalFileName", null); }}
            >
              Remove
            </button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Uploading…" : "Select file to upload"}
          </Button>
        )}
        {uploadError && <p className="text-xs text-red-600 mt-1">{uploadError}</p>}
        <p className="text-xs text-gray-400 mt-1">
          Or enter an external URL below:
        </p>
        <Input
          value={(value.externalUrl as string) ?? ""}
          onChange={(e) => onChange("externalUrl", e.target.value || null)}
          placeholder="https://…"
          className="text-sm mt-1"
        />
      </div>
    </div>
  );
}

// ── Detail Dialog ──────────────────────────────────────────────────────────────

function EvidenceDetailDialog({
  evidenceId,
  open,
  onClose,
  onRefresh,
  projects,
}: {
  evidenceId: string | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  projects: { id: string; name: string }[];
}) {
  const { role } = useRole();
  const canWrite = role === "admin" || role === "developer";

  const [activeTab, setActiveTab] = useState<"info" | "versions" | "access">("info");
  const [addVersionOpen, setAddVersionOpen] = useState(false);
  const [versionForm, setVersionForm] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data, isLoading, refetch } = useGetEvidence(evidenceId ?? "");
  const addVersionMutation = useAddEvidenceVersion();
  const updateStatusMutation = useUpdateEvidenceStatus();

  const evidence = data?.evidence as EvidenceRecord | undefined;
  const versionHistory = (data?.versionHistory ?? []) as EvidenceRecord[];
  const accessLog = (data?.accessLog ?? []) as AccessLogEntry[];

  async function handleAddVersion() {
    if (!evidenceId || !versionForm.documentType || !versionForm.title) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = { ...versionForm };
      if (body.documentDate && typeof body.documentDate === "string" && !body.documentDate.includes("T")) {
        body.documentDate = `${body.documentDate}T00:00:00Z`;
      }
      await addVersionMutation.mutateAsync({ id: evidenceId, data: body as Parameters<typeof addVersionMutation.mutateAsync>[0]["data"] });
      setAddVersionOpen(false);
      setVersionForm({});
      void refetch();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add version");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusToggle() {
    if (!evidenceId || !evidence) return;
    const newStatus = evidence.archiveStatus === "active" ? "archived" : "active";
    setArchiving(true);
    try {
      await updateStatusMutation.mutateAsync({ id: evidenceId, data: { archiveStatus: newStatus } });
      void refetch();
      onRefresh();
    } finally {
      setArchiving(false);
    }
  }

  function handleCopyId() {
    if (evidenceId) {
      void navigator.clipboard.writeText(evidenceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  const downloadUrl = evidenceId
    ? `${BASE_URL}/api/evidence/${evidenceId}/download`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setActiveTab("info"); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {isLoading || !evidence ? (
          <div className="py-16 text-center text-gray-400">Loading evidence record…</div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg flex-shrink-0">
                  <Shield className="h-5 w-5 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-base font-semibold leading-tight truncate">
                    {evidence.title}
                  </DialogTitle>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <Badge className={`text-xs ${DOC_TYPE_COLORS[evidence.documentType] ?? "bg-gray-100 text-gray-600"}`}>
                      {DOC_TYPE_LABELS[evidence.documentType] ?? evidence.documentType}
                    </Badge>
                    <Badge className={`text-xs ${STATUS_COLORS[evidence.archiveStatus] ?? ""}`}>
                      {capitalize(evidence.archiveStatus)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      v{evidence.versionNumber}
                    </Badge>
                    {!evidence.isLatestVersion && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                        Older version
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </DialogHeader>

            {/* Tab bar */}
            <div className="flex border-b">
              {[
                { id: "info", label: "Details", icon: FileText },
                { id: "versions", label: `Versions (${versionHistory.length})`, icon: History },
                { id: "access", label: `Access Log (${accessLog.length})`, icon: Eye },
              ].map((tab) => (
                <button
                  key={tab.id}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                  onClick={() => setActiveTab(tab.id as "info" | "versions" | "access")}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Details tab */}
            {activeTab === "info" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm border rounded-lg p-3 bg-gray-50">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Project</p>
                    <p className="font-medium">{evidence.projectName ?? "— Global —"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Archived</p>
                    <p className="font-medium">{fmtDateTime(evidence.archivedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Archived By</p>
                    <p className="font-medium">
                      {evidence.uploadedByName ?? "—"}
                      {evidence.uploadedByRole && (
                        <span className="text-gray-400 text-xs ml-1">({evidence.uploadedByRole})</span>
                      )}
                    </p>
                  </div>
                  {evidence.referenceNumber && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Reference Number</p>
                      <p className="font-medium font-mono text-xs">{evidence.referenceNumber}</p>
                    </div>
                  )}
                  {evidence.documentDate && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Document Date</p>
                      <p className="font-medium">{fmtDate(evidence.documentDate)}</p>
                    </div>
                  )}
                  {evidence.issuingAuthority && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Issuing Authority</p>
                      <p className="font-medium">{evidence.issuingAuthority}</p>
                    </div>
                  )}
                  {evidence.relatedTable && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Linked Record</p>
                      <p className="font-mono text-xs text-gray-600">
                        {evidence.relatedTable}/{evidence.relatedRecordId?.slice(0, 8)}…
                      </p>
                    </div>
                  )}
                  {evidence.accessCount != null && (
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Total Access Events</p>
                      <p className="font-medium">{evidence.accessCount}</p>
                    </div>
                  )}
                </div>

                {evidence.description && (
                  <div className="text-sm border rounded-lg p-3 bg-white">
                    <p className="text-xs text-gray-400 mb-1">Description</p>
                    <p className="whitespace-pre-wrap text-gray-700">{evidence.description}</p>
                  </div>
                )}

                {/* File info */}
                {(evidence.fileObjectPath || evidence.externalUrl) && (
                  <div className="border rounded-lg p-3 bg-white space-y-2">
                    <p className="text-xs text-gray-400 font-medium">Stored File</p>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{evidence.originalFileName ?? "—"}</p>
                        <p className="text-xs text-gray-400">
                          {fmtFileSize(evidence.fileSizeBytes)}
                          {evidence.mimeType && ` · ${evidence.mimeType}`}
                        </p>
                        {evidence.checksum && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">
                            SHA-256: {evidence.checksum.slice(0, 24)}…
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        {evidence.externalUrl ? (
                          <Button variant="outline" size="sm" asChild>
                            <a href={evidence.externalUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-1" /> Open
                            </a>
                          </Button>
                        ) : downloadUrl ? (
                          <Button variant="outline" size="sm" asChild>
                            <a href={downloadUrl} download={evidence.originalFileName ?? undefined}>
                              <Download className="h-4 w-4 mr-1" /> Download
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {/* Archive ID */}
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded border text-xs font-mono text-gray-500">
                  <Lock className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                  <span className="flex-1 truncate">Archive ID: {evidence.id}</span>
                  <button onClick={handleCopyId} className="text-gray-400 hover:text-gray-600">
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Actions */}
                {canWrite && evidence.archiveStatus !== "superseded" && (
                  <div className="flex gap-2 pt-1">
                    {evidence.isLatestVersion && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setAddVersionOpen(true); setVersionForm({ documentType: evidence.documentType, title: evidence.title }); }}
                      >
                        <History className="h-4 w-4 mr-1.5" /> Add New Version
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={archiving}
                      onClick={handleStatusToggle}
                      className={evidence.archiveStatus === "archived" ? "text-green-600 border-green-300" : "text-amber-600 border-amber-300"}
                    >
                      <Archive className="h-4 w-4 mr-1.5" />
                      {archiving ? "Updating…" : evidence.archiveStatus === "archived" ? "Restore to Active" : "Mark Archived"}
                    </Button>
                  </div>
                )}

                {/* Add version form */}
                {addVersionOpen && (
                  <div className="border rounded-lg p-4 space-y-3 bg-indigo-50 border-indigo-200">
                    <h4 className="text-sm font-semibold text-indigo-800">Add New Version</h4>
                    <ArchiveForm
                      value={versionForm}
                      onChange={(k, v) => setVersionForm((f) => ({ ...f, [k]: v }))}
                      projects={projects}
                      showProject={false}
                    />
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => { setAddVersionOpen(false); setError(null); }}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={submitting || !versionForm.documentType || !versionForm.title}
                        onClick={handleAddVersion}
                      >
                        {submitting ? "Archiving…" : "Archive New Version"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Version history tab */}
            {activeTab === "versions" && (
              <div className="space-y-2">
                {versionHistory.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No version history</p>
                ) : (
                  versionHistory.map((v) => (
                    <div
                      key={v.id}
                      className={`border rounded-lg p-3 ${v.isLatestVersion ? "border-indigo-200 bg-indigo-50" : "bg-gray-50"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-700">v{v.versionNumber}</span>
                            {v.isLatestVersion && (
                              <Badge className="text-xs bg-indigo-600 text-white">Current</Badge>
                            )}
                            <Badge className={`text-xs ${STATUS_COLORS[v.archiveStatus] ?? ""}`}>
                              {capitalize(v.archiveStatus)}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium text-gray-800 mt-1">{v.title}</p>
                          {v.originalFileName && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {v.originalFileName} · {fmtFileSize(v.fileSizeBytes)}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">
                            Archived by {v.uploadedByName ?? "—"} on {fmtDateTime(v.archivedAt)}
                          </p>
                        </div>
                        {v.fileObjectPath && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={`${BASE_URL}/api/evidence/${v.id}/download`} download>
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Access log tab */}
            {activeTab === "access" && (
              <div className="space-y-1.5">
                {accessLog.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No access events recorded</p>
                ) : (
                  accessLog.map((a) => (
                    <div key={a.id} className="flex items-center gap-3 p-2 rounded border bg-gray-50 text-xs">
                      <Clock className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="font-medium text-gray-700">{capitalize(a.accessType)}</span>
                        <span className="text-gray-400 ml-2">
                          by {a.actorName ?? "unknown"}
                          {a.actorRole && ` (${a.actorRole})`}
                        </span>
                      </div>
                      <span className="text-gray-400 flex-shrink-0">{fmtDateTime(a.accessedAt)}</span>
                    </div>
                  ))
                )}
                <p className="text-xs text-gray-400 text-center pt-1">
                  Showing last {accessLog.length} access events
                </p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Create Evidence Dialog ────────────────────────────────────────────────────

function CreateEvidenceDialog({
  open,
  onClose,
  onCreated,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  projects: { id: string; name: string }[];
}) {
  const [form, setForm] = useState<Record<string, unknown>>({ documentType: "agreement" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateEvidence();

  async function handleCreate() {
    if (!form.documentType || !form.title) return;
    if (!form.fileObjectPath && !form.externalUrl) {
      setError("Please upload a file or provide an external URL");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = { ...form };
      if (body.documentDate && typeof body.documentDate === "string" && !body.documentDate.includes("T")) {
        body.documentDate = `${body.documentDate}T00:00:00Z`;
      }
      await createMutation.mutateAsync({ data: body as Parameters<typeof createMutation.mutateAsync>[0]["data"] });
      setForm({ documentType: "agreement" });
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive document");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-600" />
            Archive Legal Document
          </DialogTitle>
        </DialogHeader>
        <ArchiveForm
          value={form}
          onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))}
          projects={projects}
          showProject
        />
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={submitting || !form.documentType || !(form.title as string)?.trim()}
          >
            {submitting ? "Archiving…" : "Archive Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EvidenceArchive() {
  const authFetch = useAuthFetch();
  const { role } = useRole();
  const canWrite = role === "admin" || role === "developer";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [onlyLatest, setOnlyLatest] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const PAGE_SIZE = 25;

  // Debounce search
  const searchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function handleSearchChange(v: string) {
    setSearch(v);
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(0);
    }, 350);
  }

  const listParams = {
    projectId: filterProject !== "all" ? filterProject : undefined,
    documentType: filterType !== "all" ? filterType : undefined,
    archiveStatus: filterStatus !== "all" ? filterStatus : undefined,
    search: debouncedSearch || undefined,
    onlyLatest: onlyLatest ? "true" : "false",
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { data: listData, isLoading, refetch: refetchList } = useListEvidence(listParams);
  const { data: statsData, refetch: refetchStats } = useGetEvidenceStats({});
  const { data: projectsData } = useListProjects({});

  const evidenceList = useMemo(() => (listData?.evidence ?? []) as EvidenceRecord[], [listData]);
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const stats = statsData as {
    total?: number;
    latestVersionCount?: number;
    totalAccessEvents?: number;
    byType?: { documentType: string; count: number }[];
    byProject?: { projectId: string; projectName: string; count: number }[];
    byStatus?: { archiveStatus: string; count: number }[];
    recentlyArchived?: EvidenceRecord[];
  } | undefined;

  const projects = useMemo(() => {
    const raw = projectsData;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as { id: string; name: string }[];
    if (Array.isArray((raw as { projects?: unknown }).projects)) {
      return (raw as { projects: { id: string; name: string }[] }).projects;
    }
    return [];
  }, [projectsData]);

  function handleRefresh() {
    void refetchList();
    void refetchStats();
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
  }

  const activeCount = stats?.byStatus?.find((s) => s.archiveStatus === "active")?.count ?? stats?.latestVersionCount ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Shield className="h-6 w-6 text-indigo-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Legal Evidence Archive</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Immutable archive of all legal documents and evidentiary records
            </p>
          </div>
        </div>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Archive Document
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Records", value: stats?.total ?? 0, icon: FileText, color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Active Documents", value: activeCount, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
          { label: "Total Versions", value: stats?.total ?? 0, icon: History, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Access Events", value: stats?.totalAccessEvents ?? 0, icon: Eye, color: "text-blue-600", bg: "bg-blue-50" },
        ].map((c) => (
          <Card key={c.label} className={`${c.bg} border-0`}>
            <CardContent className="pt-4 pb-3 px-4 flex items-center gap-3">
              <c.icon className={`h-8 w-8 ${c.color} opacity-80`} />
              <div>
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Type breakdown */}
      {(stats?.byType ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(stats?.byType ?? []).map((bt) => (
            <button
              key={bt.documentType}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors hover:shadow-sm ${
                filterType === bt.documentType
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-indigo-200"
              }`}
              onClick={() => { setFilterType(filterType === bt.documentType ? "all" : bt.documentType); setPage(0); }}
            >
              {DOC_TYPE_LABELS[bt.documentType] ?? bt.documentType}
              <span className="ml-1.5 text-gray-400">{bt.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search + Filters */}
      <div className="flex flex-wrap gap-3 p-4 bg-gray-50 rounded-lg border">
        <div className="relative flex-1 min-w-48">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search title, reference number, authority…"
            className="pl-9 text-sm h-8 bg-white"
          />
        </div>

        <Select value={filterProject} onValueChange={(v) => { setFilterProject(v); setPage(0); }}>
          <SelectTrigger className="w-44 bg-white text-sm h-8">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
          <SelectTrigger className="w-36 bg-white text-sm h-8">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
          </SelectContent>
        </Select>

        <button
          className={`flex items-center gap-1.5 px-3 py-1 rounded border text-xs font-medium transition-colors ${
            onlyLatest ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-gray-200 text-gray-600"
          }`}
          onClick={() => { setOnlyLatest(!onlyLatest); setPage(0); }}
        >
          <History className="h-3.5 w-3.5" />
          Latest only
        </button>

        {(filterProject !== "all" || filterType !== "all" || filterStatus !== "all" || debouncedSearch) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setFilterProject("all"); setFilterType("all");
              setFilterStatus("all"); setSearch(""); setDebouncedSearch("");
              setPage(0);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Main table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="text-xs">Title</TableHead>
              <TableHead className="text-xs w-36">Type</TableHead>
              <TableHead className="text-xs w-28">Project</TableHead>
              <TableHead className="text-xs w-24">Reference</TableHead>
              <TableHead className="text-xs w-20">Version</TableHead>
              <TableHead className="text-xs w-24">Status</TableHead>
              <TableHead className="text-xs w-28">Archived</TableHead>
              <TableHead className="text-xs w-24">File</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                  Loading archive…
                </TableCell>
              </TableRow>
            ) : evidenceList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                  No evidence records found
                </TableCell>
              </TableRow>
            ) : (
              evidenceList.map((e) => (
                <TableRow
                  key={e.id}
                  className="cursor-pointer hover:bg-indigo-50 transition-colors"
                  onClick={() => openDetail(e.id)}
                >
                  <TableCell className="py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 line-clamp-1">{e.title}</p>
                      {!e.isLatestVersion && (
                        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 flex-shrink-0">
                          old
                        </Badge>
                      )}
                    </div>
                    {e.description && (
                      <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{e.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${DOC_TYPE_COLORS[e.documentType] ?? "bg-gray-100"}`}>
                      {DOC_TYPE_LABELS[e.documentType] ?? e.documentType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 truncate max-w-[7rem]">
                    {e.projectName ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 font-mono">
                    {e.referenceNumber ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 text-center">
                    v{e.versionNumber}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${STATUS_COLORS[e.archiveStatus] ?? "bg-gray-100"}`}>
                      {capitalize(e.archiveStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {fmtDate(e.archivedAt)}
                  </TableCell>
                  <TableCell>
                    {e.fileObjectPath ? (
                      <span title={e.originalFileName ?? undefined}>
                        <FileText className="h-4 w-4 text-indigo-400" />
                      </span>
                    ) : e.externalUrl ? (
                      <ExternalLink className="h-4 w-4 text-blue-400" />
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} records
            </p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Immutability notice */}
      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <Lock className="h-4 w-4 flex-shrink-0 text-amber-600" />
        <p>
          <span className="font-semibold">Permanent Archive:</span> All records in this archive are immutable. Documents are never deleted — older versions are marked as superseded but remain fully accessible and downloadable.
        </p>
      </div>

      {/* Dialogs */}
      <EvidenceDetailDialog
        evidenceId={selectedId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onRefresh={handleRefresh}
        projects={projects}
      />

      <CreateEvidenceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleRefresh}
        projects={projects}
      />
    </div>
  );
}
