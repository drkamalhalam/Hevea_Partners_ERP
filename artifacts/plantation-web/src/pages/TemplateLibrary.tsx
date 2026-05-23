import { useState, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import {
  useListTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useArchiveTemplate,
  useRestoreTemplate,
  getListTemplatesQueryKey,
} from "@workspace/api-client-react";
import type { AgreementTemplate } from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  FileText,
  Archive,
  RotateCcw,
  MoreVertical,
  Eye,
  Pencil,
  Search,
  X,
  CheckCircle2,
  AlertCircle,
  Download,
} from "lucide-react";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

type StatusFilter = "draft" | "active" | "superseded" | "archived";
type DocumentCategory =
  | "agreement"
  | "ownership_record"
  | "transfer_document"
  | "succession_document"
  | "inheritance_document"
  | "governance_document"
  | "notice"
  | "declaration"
  | "certificate"
  | "other";

const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  agreement: "Agreement",
  ownership_record: "Ownership Record",
  transfer_document: "Transfer Document",
  succession_document: "Succession Document",
  inheritance_document: "Inheritance Document",
  governance_document: "Governance Document",
  notice: "Notice",
  declaration: "Declaration",
  certificate: "Certificate",
  other: "Other",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  superseded: "bg-amber-100 text-amber-800 border-amber-300",
  archived: "bg-zinc-100 text-zinc-600 border-zinc-300",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileFormatBadge(fmt: string) {
  if (fmt === "pdf")
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 font-mono text-xs uppercase px-1.5">
        PDF
      </Badge>
    );
  return (
    <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 font-mono text-xs uppercase px-1.5">
      DOCX
    </Badge>
  );
}

// ── Upload Dialog ──────────────────────────────────────────────────────────

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function UploadDialog({ open, onClose, onSuccess }: UploadDialogProps) {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const createTemplate = useCreateTemplate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [documentDescription, setDocumentDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [version, setVersion] = useState("1.0");
  const [category, setCategory] = useState<DocumentCategory>("agreement");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ALLOWED_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
  ];

  function handleFileSelect(selected: File | null) {
    if (!selected) return;
    if (!ALLOWED_TYPES.includes(selected.type)) {
      toast({ title: "Unsupported format", description: "Only PDF and DOCX files are accepted.", variant: "destructive" });
      return;
    }
    setFile(selected);
    if (!name) setName(selected.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { toast({ title: "No file selected", variant: "destructive" }); return; }
    if (!name.trim()) { toast({ title: "Template name is required", variant: "destructive" }); return; }

    setUploading(true);
    try {
      // Step 1: request presigned upload URL
      const token = await getToken();
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlRes.json();

      // Step 2: upload directly to GCS
      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("File upload to storage failed");

      // Step 3: create template metadata record
      const fmt = file.type === "application/pdf" ? "pdf" : "docx";
      await createTemplate.mutateAsync({
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          documentDescription: documentDescription.trim() || undefined,
          notes: notes.trim() || undefined,
          version: version.trim() || "1.0",
          category,
          fileObjectPath: objectPath,
          fileFormat: fmt,
          mimeType: file.type,
          fileSizeBytes: file.size,
        },
      });

      toast({ title: "Template uploaded", description: `"${name}" has been added to the library.` });
      onSuccess();
      handleClose();
    } catch (err) {
      toast({ title: "Upload failed", description: String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    setName(""); setDescription(""); setDocumentDescription(""); setNotes("");
    setVersion("1.0"); setCategory("agreement"); setFile(null); setUploading(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Template</DialogTitle>
          <DialogDescription>
            Upload a master agreement template (PDF or DOCX). The document's exact wording,
            formatting, and legal structure will be preserved.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"
            } ${file ? "border-green-500 bg-green-50" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0] ?? null); }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.doc"
              onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium text-green-700">{file.name}</span>
                <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="ml-1 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">Drop file here or click to browse</p>
                <p className="text-xs text-muted-foreground">PDF or DOCX · Max 50 MB</p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="tpl-name">Template Name <span className="text-destructive">*</span></Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard Landowner Agreement v2025" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="tpl-category">Category <span className="text-destructive">*</span></Label>
              <Select value={category} onValueChange={(v) => setCategory(v as DocumentCategory)}>
                <SelectTrigger id="tpl-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-version">Version</Label>
              <Input id="tpl-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tpl-desc">Document Description</Label>
            <Textarea id="tpl-desc" value={documentDescription} onChange={(e) => setDocumentDescription(e.target.value)}
              placeholder="What this document is used for"
              rows={2} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="tpl-notes">Internal Notes</Label>
            <Textarea id="tpl-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Admin-only notes (clauses, use-case, legal references…)"
              rows={2} />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              This template will be stored as-is. Exact wording, formatting, and legal structure
              are preserved. Only designated placeholder variables will be substituted when
              generating individual agreements.
            </p>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" onClick={handleClose} disabled={uploading}>Cancel</Button>
            <Button type="submit" disabled={uploading || !file}>
              {uploading ? "Uploading…" : "Upload Template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Dialog ────────────────────────────────────────────────────────────

interface EditDialogProps {
  template: AgreementTemplate;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function EditDialog({ template, open, onClose, onSuccess }: EditDialogProps) {
  const { toast } = useToast();
  const updateTemplate = useUpdateTemplate();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [version, setVersion] = useState(template.version);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        data: { name: name.trim(), description: description.trim() || undefined, version: version.trim() },
      });
      toast({ title: "Template updated" });
      onSuccess();
      onClose();
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Template</DialogTitle>
          <DialogDescription>Update metadata only. The document file is not changed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>Template Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Version</Label>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Preview Panel ──────────────────────────────────────────────────────────

interface PreviewPanelProps {
  template: AgreementTemplate;
  onClose: () => void;
}

function PreviewPanel({ template, onClose }: PreviewPanelProps) {
  const previewUrl = `/api/storage${template.fileObjectPath}`;

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm truncate">{template.name}</h3>
          <p className="text-xs text-muted-foreground">v{template.version} · {template.fileFormat.toUpperCase()}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <Button variant="ghost" size="sm" asChild>
            <a href={previewUrl} download={`${template.name}.${template.fileFormat}`}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Preview body */}
      <div className="flex-1 overflow-hidden">
        {template.fileFormat === "pdf" ? (
          <iframe
            src={`${previewUrl}#toolbar=1&view=FitH`}
            className="w-full h-full border-0"
            title={`Preview: ${template.name}`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <div className="rounded-full bg-blue-100 p-4">
              <FileText className="h-10 w-10 text-blue-600" />
            </div>
            <div>
              <p className="font-medium">{template.name}</p>
              <p className="text-sm text-muted-foreground mt-1">
                DOCX files cannot be previewed in the browser.
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Download the file to open it in Microsoft Word or LibreOffice.
              </p>
            </div>
            <Button asChild>
              <a href={previewUrl} download={`${template.name}.docx`}>
                <Download className="h-4 w-4 mr-2" />
                Download DOCX
              </a>
            </Button>

            {/* Metadata card */}
            <div className="w-full max-w-xs rounded-lg border p-4 text-left space-y-2 mt-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-medium">{template.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Format</span>
                  <span className="font-medium uppercase">{template.fileFormat}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Size</span>
                  <span className="font-medium">{formatFileSize(template.fileSizeBytes)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Uploaded by</span>
                  <span className="font-medium">{template.uploadedByName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Upload date</span>
                  <span className="font-medium">{format(new Date(template.createdAt), "dd MMM yyyy")}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Template Row ───────────────────────────────────────────────────────────

interface TemplateRowProps {
  template: AgreementTemplate;
  isSelected: boolean;
  canManage: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

function TemplateRow({ template, isSelected, canManage, onSelect, onEdit, onArchive, onRestore }: TemplateRowProps) {
  const isArchived = template.status === "archived";
  const isDimmed = isArchived || template.status === "superseded";

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors border-b last:border-0 ${
        isSelected ? "bg-accent" : ""
      } ${isDimmed ? "opacity-60" : ""}`}
      onClick={onSelect}
    >
      {/* Icon */}
      <div className={`shrink-0 rounded p-1.5 ${template.fileFormat === "pdf" ? "bg-red-100" : "bg-blue-100"}`}>
        <FileText className={`h-4 w-4 ${template.fileFormat === "pdf" ? "text-red-600" : "text-blue-600"}`} />
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{template.name}</span>
          {fileFormatBadge(template.fileFormat)}
          <Badge variant="outline" className={`text-xs ${STATUS_BADGE[template.status] ?? ""}`}>
            {template.status}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-mono uppercase">
            {CATEGORY_LABELS[template.category as DocumentCategory] ?? template.category}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span>v{template.version}</span>
          {template.fileSizeBytes && <span>{formatFileSize(template.fileSizeBytes)}</span>}
          <span>{format(new Date(template.createdAt), "dd MMM yyyy")}</span>
          {template.uploadedByName && <span>by {template.uploadedByName}</span>}
        </div>
        {template.documentDescription && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{template.documentDescription}</p>
        )}
      </div>

      {/* Actions */}
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(); }}>
              <Eye className="h-4 w-4 mr-2" />Preview
            </DropdownMenuItem>
            {template.fileFormat === "docx" && (
              <DropdownMenuItem asChild>
                <Link href={`/document-templates/${template.id}/variables`} onClick={(e) => e.stopPropagation()}>
                  <Settings2 className="h-4 w-4 mr-2" />Variables &amp; Activation
                </Link>
              </DropdownMenuItem>
            )}
            {!isArchived && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Pencil className="h-4 w-4 mr-2" />Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {isArchived ? (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRestore(); }}
                className="text-green-700 focus:text-green-700">
                <RotateCcw className="h-4 w-4 mr-2" />Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchive(); }}
                className="text-destructive focus:text-destructive">
                <Archive className="h-4 w-4 mr-2" />Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function TemplateLibrary() {
  const { role } = useRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canManage = role === "admin" || role === "developer";

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState<DocumentCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AgreementTemplate | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AgreementTemplate | null>(null);

  const archiveTemplate = useArchiveTemplate();
  const restoreTemplate = useRestoreTemplate();

  const { data: templates, isLoading } = useListTemplates(
    {
      status: statusFilter,
      ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
    }
  );

  const filtered = (templates ?? []).filter((t) =>
    search.trim() === "" ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
    t.version.toLowerCase().includes(search.toLowerCase())
  );

  const selected = selectedId ? (templates ?? []).find((t) => t.id === selectedId) ?? null : null;

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
  }

  async function handleArchive(template: AgreementTemplate) {
    try {
      await archiveTemplate.mutateAsync({ id: template.id });
      toast({ title: "Template archived", description: `"${template.name}" moved to archive.` });
      if (selectedId === template.id) setSelectedId(null);
      invalidate();
    } catch {
      toast({ title: "Archive failed", variant: "destructive" });
    }
    setArchiveTarget(null);
  }

  async function handleRestore(template: AgreementTemplate) {
    try {
      await restoreTemplate.mutateAsync({ id: template.id });
      toast({ title: "Template restored", description: `"${template.name}" is now active.` });
      invalidate();
    } catch {
      toast({ title: "Restore failed", variant: "destructive" });
    }
  }

  const activeCnt = (templates ?? []).filter(t => t.status === "active").length;
  const archivedCnt = (templates ?? []).filter(t => t.status === "archived").length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-5 border-b bg-background">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Document Templates</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Central registry for all document categories — exact legal formatting is preserved
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload Template
            </Button>
          )}
        </div>
      </div>

      {/* Body — split view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — library list */}
        <div className={`flex flex-col ${selected ? "w-[420px] shrink-0" : "flex-1"} overflow-hidden border-r`}>
          {/* Toolbar */}
          <div className="shrink-0 px-4 py-3 border-b space-y-3">
            {/* Status Tabs */}
            <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v as StatusFilter); setSelectedId(null); }}>
              <TabsList className="h-8">
                <TabsTrigger value="draft" className="text-xs h-7 px-3">Draft</TabsTrigger>
                <TabsTrigger value="active" className="text-xs h-7 px-3">
                  Active
                  {statusFilter !== "active" && activeCnt > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{activeCnt}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="superseded" className="text-xs h-7 px-3">Superseded</TabsTrigger>
                <TabsTrigger value="archived" className="text-xs h-7 px-3">
                  Archived
                  {statusFilter !== "archived" && archivedCnt > 0 && (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{archivedCnt}</span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {/* Category filter */}
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v as DocumentCategory | "all"); setSelectedId(null); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {(Object.keys(CATEGORY_LABELS) as DocumentCategory[]).map((c) => (
                  <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-9 w-9 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {search ? "No templates match your search" : statusFilter === "archived" ? "No archived templates" : "No templates yet"}
                </p>
                {canManage && !search && statusFilter === "active" && (
                  <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
                    <Upload className="h-3.5 w-3.5 mr-1.5" />Upload first template
                  </Button>
                )}
              </div>
            ) : (
              filtered.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  isSelected={selectedId === t.id}
                  canManage={canManage}
                  onSelect={() => setSelectedId(selectedId === t.id ? null : t.id)}
                  onEdit={() => setEditTarget(t)}
                  onArchive={() => setArchiveTarget(t)}
                  onRestore={() => handleRestore(t)}
                />
              ))
            )}
          </div>

          {/* Footer stats */}
          {!isLoading && filtered.length > 0 && (
            <div className="shrink-0 px-4 py-2 border-t bg-muted/30">
              <p className="text-xs text-muted-foreground">
                {filtered.length} template{filtered.length !== 1 ? "s" : ""}
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}
        </div>

        {/* Right — preview panel */}
        {selected && (
          <div className="flex-1 overflow-hidden">
            <PreviewPanel template={selected} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={invalidate}
      />

      {editTarget && (
        <EditDialog
          template={editTarget}
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={invalidate}
        />
      )}

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this template?</AlertDialogTitle>
            <AlertDialogDescription>
              "{archiveTarget?.name}" will be moved to the archive and hidden from the active library.
              It can be restored at any time by an admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveTarget && handleArchive(archiveTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
