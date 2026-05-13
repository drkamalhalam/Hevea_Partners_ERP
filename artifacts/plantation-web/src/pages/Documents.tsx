import { useState, useMemo, useRef } from "react";
import {
  useListDocuments,
  useCreateDocument,
  useArchiveDocument,
  useRestoreDocument,
  useListDocumentAccessLog,
  useListProjects,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  FileText,
  FilePlus,
  Search,
  Download,
  Archive,
  RotateCcw,
  ShieldCheck,
  FolderOpen,
  FileArchive,
  Gavel,
  Wrench,
  X,
  Clock,
  User,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";

// ── Category config ───────────────────────────────────────────────────────────

type DocCategory = "agreement" | "template" | "supporting" | "governance" | "operational";

interface CategoryMeta {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  border: string;
  description: string;
}

const CATEGORY_META: Record<DocCategory, CategoryMeta> = {
  agreement: {
    label: "Agreement",
    icon: Gavel,
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    description: "Signed deeds, amendments, and partnership agreements",
  },
  template: {
    label: "Template",
    icon: FileText,
    color: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
    description: "Reusable agreement and governance document templates",
  },
  supporting: {
    label: "Supporting",
    icon: FolderOpen,
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    description: "Land records, survey maps, KYC, and boundary documents",
  },
  governance: {
    label: "Governance",
    icon: ShieldCheck,
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    description: "Board resolutions, regulatory filings, and compliance docs",
  },
  operational: {
    label: "Operational",
    icon: Wrench,
    color: "text-gray-700",
    bg: "bg-gray-50",
    border: "border-gray-200",
    description: "Tapping logs, operational reports, and maintenance records",
  },
};

// ── Upload form schema ────────────────────────────────────────────────────────

const uploadFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.enum(["agreement", "template", "supporting", "governance", "operational"]),
  projectId: z.string().optional(),
  notes: z.string().optional(),
});

type UploadFormValues = z.infer<typeof uploadFormSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mimeType: string): string {
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("word") || mimeType.includes("docx")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("sheet")) return "📊";
  if (mimeType.includes("image")) return "🖼️";
  if (mimeType.includes("zip") || mimeType.includes("archive")) return "🗜️";
  return "📎";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function actionStyle(action: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    upload: { label: "Uploaded", color: "text-emerald-700" },
    view: { label: "Viewed", color: "text-blue-600" },
    download: { label: "Downloaded", color: "text-violet-700" },
    archive: { label: "Archived", color: "text-amber-700" },
    restore: { label: "Restored", color: "text-green-700" },
    delete: { label: "Deleted", color: "text-red-700" },
    metadata_update: { label: "Updated", color: "text-gray-600" },
  };
  return map[action] ?? { label: action, color: "text-gray-600" };
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  count,
  icon: Icon,
  active,
  color,
  bg,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  color: string;
  bg: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border p-4 transition-all hover:shadow-md focus:outline-none w-full",
        active
          ? "ring-2 ring-primary border-primary/30 shadow-md"
          : "border-border bg-card hover:border-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            {label}
          </p>
          <p className={cn("text-3xl font-bold tabular-nums", active ? "text-primary" : color)}>
            {count}
          </p>
        </div>
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            active ? "bg-primary/10 text-primary" : `${bg} ${color}`
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </button>
  );
}

// ── Category badge ────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string }) {
  const meta = CATEGORY_META[category as DocCategory];
  if (!meta) return <span className="text-xs text-muted-foreground">{category}</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
        meta.bg,
        meta.color,
        meta.border
      )}
    >
      <meta.icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

// ── Access info bar ───────────────────────────────────────────────────────────

function AccessInfo({ role }: { role: string }) {
  const messages: Record<string, string> = {
    admin: "Full access — all documents across all projects and categories",
    developer: "Full access — all documents across all projects and categories",
    landowner: "Project-scoped — documents linked to your assigned projects",
    investor: "Project-scoped — documents linked to your assigned projects",
    employee: "Restricted — operational and supporting documents for your projects only",
    operational_staff: "Restricted — operational and supporting documents for your projects only",
  };
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/60 border text-xs text-muted-foreground">
      <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary/70" />
      <span>{messages[role] ?? "Access controlled by your role"}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Documents() {
  const { data: documents, isLoading } = useListDocuments({} as Parameters<typeof useListDocuments>[0]);
  const { data: archivedDocs } = useListDocuments({ status: "archived" } as Parameters<typeof useListDocuments>[0]);
  const { data: projects } = useListProjects();
  const { data: accessLog } = useListDocumentAccessLog({ limit: 200 } as Parameters<typeof useListDocumentAccessLog>[0]);
  const createDocument = useCreateDocument();
  const archiveDocument = useArchiveDocument();
  const restoreDocument = useRestoreDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { role } = useRole();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [projectFilter, setProjectFilter] = useState<string>("__all__");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: { title: "", category: "supporting", projectId: "__none__" },
  });

  // ── Analytics ──────────────────────────────────────────────────────────────

  const allDocs = documents ?? [];
  const analytics = useMemo(() => {
    const counts: Record<string, number> = {
      agreement: 0, template: 0, supporting: 0, governance: 0, operational: 0,
    };
    allDocs.forEach((d) => { counts[d.category] = (counts[d.category] ?? 0) + 1; });
    return { total: allDocs.length, ...counts };
  }, [allDocs]);

  // ── Filtered list ──────────────────────────────────────────────────────────

  const activeSource = showArchived ? (archivedDocs ?? []) : allDocs;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeSource.filter((d) => {
      if (categoryFilter !== "__all__" && d.category !== categoryFilter) return false;
      if (projectFilter !== "__all__" && d.projectId !== projectFilter) return false;
      if (q) {
        const hay = [d.title, d.description, d.originalFileName, d.uploadedByName, d.projectName]
          .join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeSource, search, categoryFilter, projectFilter]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    allDocs.forEach((d) => {
      if (d.projectId && d.projectName) map.set(d.projectId, d.projectName);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allDocs]);

  const hasFilters = search !== "" || categoryFilter !== "__all__" || projectFilter !== "__all__";

  // ── Upload flow (two-step: presign → PUT → register) ──────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !form.getValues("title")) {
      form.setValue("title", file.name.replace(/\.[^.]+$/, ""));
    }
  }

  async function onUploadSubmit(values: UploadFormValues) {
    if (!selectedFile) {
      toast({ title: "Select a file to upload", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const urlResp = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedFile.name,
          size: selectedFile.size,
          contentType: selectedFile.type,
        }),
      });
      if (!urlResp.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlResp.json();

      const putResp = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });
      if (!putResp.ok) throw new Error("File upload to storage failed");

      createDocument.mutate(
        {
          data: {
            title: values.title,
            description: values.description,
            category: values.category,
            projectId:
              values.projectId && values.projectId !== "__none__"
                ? values.projectId
                : undefined,
            notes: values.notes,
            fileObjectPath: objectPath,
            mimeType: selectedFile.type || "application/octet-stream",
            fileSizeBytes: selectedFile.size,
            originalFileName: selectedFile.name,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
            toast({ title: "Document uploaded successfully" });
            setUploadOpen(false);
            setSelectedFile(null);
            form.reset();
            setUploading(false);
          },
          onError: () => {
            toast({ title: "Failed to register document", variant: "destructive" });
            setUploading(false);
          },
        }
      );
    } catch (err) {
      setUploading(false);
      toast({ title: String(err), variant: "destructive" });
    }
  }

  function handleArchive(docId: string, title: string) {
    archiveDocument.mutate(
      { id: docId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          toast({ title: `"${title}" archived` });
        },
        onError: () => toast({ title: "Archive failed", variant: "destructive" }),
      }
    );
  }

  function handleRestore(docId: string, title: string) {
    restoreDocument.mutate(
      { id: docId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          toast({ title: `"${title}" restored` });
        },
        onError: () => toast({ title: "Restore failed", variant: "destructive" }),
      }
    );
  }

  function handleDownload(docId: string, filename: string) {
    const a = document.createElement("a");
    a.href = `/api/documents/${docId}/download`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Document Repository</h1>
          <p className="text-muted-foreground mt-1">
            Secure storage for legal, operational, and partner documents
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(role === "admin" || role === "developer") && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setShowAuditLog((v) => !v)}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {showAuditLog ? "Hide Log" : "Audit Log"}
              </Button>
              <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <FilePlus className="w-4 h-4" />
                    Upload Document
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="font-serif">Upload Document</DialogTitle>
                    <DialogDescription>
                      Files are stored securely in private object storage. Access is controlled by role and project.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onUploadSubmit)} className="space-y-4">
                      {/* File picker */}
                      <div
                        className={cn(
                          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:bg-muted/40",
                          selectedFile ? "border-primary/50 bg-primary/5" : "border-border"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          onChange={handleFileChange}
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
                        />
                        {selectedFile ? (
                          <div className="text-sm">
                            <p className="font-medium text-foreground">{selectedFile.name}</p>
                            <p className="text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            <p className="font-medium">Click to select a file</p>
                            <p className="text-xs mt-1">PDF, Word, Excel, Images, ZIP — max 50 MB</p>
                          </div>
                        )}
                      </div>

                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Document Title</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Land Deed – Ambassa Block A" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="category"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Category</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {Object.entries(CATEGORY_META).map(([k, v]) => (
                                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="projectId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Project (optional)</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value ?? "__none__"}
                              >
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Global" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">Global / No project</SelectItem>
                                  {projects?.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Brief description of this document…"
                                rows={2}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="flex justify-end gap-2 pt-1 border-t">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => { setUploadOpen(false); setSelectedFile(null); form.reset(); }}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={uploading || !selectedFile}>
                          {uploading ? "Uploading…" : "Upload & Save"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* Access info */}
      <AccessInfo role={role} />

      {/* KPI row */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="All Documents"
            count={analytics.total}
            icon={FileText}
            active={categoryFilter === "__all__"}
            color="text-foreground"
            bg="bg-muted"
            onClick={() => setCategoryFilter("__all__")}
          />
          {(Object.entries(CATEGORY_META) as [DocCategory, CategoryMeta][]).map(([k, v]) => (
            <KpiCard
              key={k}
              label={v.label}
              count={(analytics as Record<string, number>)[k] ?? 0}
              icon={v.icon}
              active={categoryFilter === k}
              color={v.color}
              bg={v.bg}
              onClick={() => setCategoryFilter(k)}
            />
          ))}
        </div>
      )}

      {/* Search + filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by title, file name, or project…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            {categoryFilter === "__all__" && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {Object.entries(CATEGORY_META).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {projectOptions.length > 0 && (
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All projects</SelectItem>
                  {projectOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("__all__");
                  setProjectFilter("__all__");
                }}
                className="gap-1.5 text-muted-foreground shrink-0"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </Button>
            )}
          </div>

          {categoryFilter !== "__all__" && CATEGORY_META[categoryFilter as DocCategory] && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Showing:</span>
              <CategoryBadge category={categoryFilter} />
              <span className="text-xs text-muted-foreground">—</span>
              <span className="text-xs text-muted-foreground">
                {CATEGORY_META[categoryFilter as DocCategory].description}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="px-6 py-4 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                {showArchived ? "Archived Documents" : "Document Library"}
              </CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {filtered.length} document{filtered.length !== 1 ? "s" : ""}
                </span>
                {(role === "admin" || role === "developer") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowArchived((v) => !v)}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <FileArchive className="w-3.5 h-3.5" />
                    {showArchived
                      ? "Show active"
                      : `Archived (${archivedDocs?.length ?? 0})`}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {filtered.length === 0 ? (
            <CardContent className="py-16 text-center">
              <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="font-medium text-muted-foreground">
                {hasFilters
                  ? "No documents match your filters."
                  : showArchived
                  ? "No archived documents."
                  : "No documents yet."}
              </p>
              {hasFilters && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setCategoryFilter("__all__");
                    setProjectFilter("__all__");
                  }}
                  className="mt-1"
                >
                  Clear filters
                </Button>
              )}
              {!hasFilters && !showArchived && (role === "admin" || role === "developer") && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  className="mt-3 gap-2"
                >
                  <FilePlus className="w-4 h-4" /> Upload first document
                </Button>
              )}
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-6 py-3 font-medium">Document</th>
                    <th className="text-left px-4 py-3 font-medium">Category</th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                      Project
                    </th>
                    <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">
                      Size
                    </th>
                    <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">
                      Uploaded by
                    </th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                      Date
                    </th>
                    <th className="text-right px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((doc) => (
                    <tr
                      key={doc.id}
                      className="hover:bg-muted/30 transition-colors group"
                    >
                      <td className="px-6 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <span className="text-lg leading-none mt-0.5 shrink-0">
                            {mimeIcon(doc.mimeType)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate max-w-[220px]">
                              {doc.title}
                            </p>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-[220px] mt-0.5">
                                {doc.description}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono truncate max-w-[220px]">
                              {doc.originalFileName}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <CategoryBadge category={doc.category} />
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell text-xs text-muted-foreground">
                        {doc.projectName ?? (
                          <span className="italic text-muted-foreground/50">Global</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 hidden lg:table-cell text-right text-muted-foreground tabular-nums text-xs">
                        {formatBytes(doc.fileSizeBytes)}
                      </td>
                      <td className="px-4 py-3.5 hidden xl:table-cell">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="w-3 h-3 shrink-0" />
                          {doc.uploadedByName ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 h-8"
                            onClick={() => handleDownload(doc.id, doc.originalFileName)}
                            title="Download"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Download</span>
                          </Button>
                          {(role === "admin" || role === "developer") && !showArchived && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-muted-foreground hover:text-amber-700"
                              onClick={() => handleArchive(doc.id, doc.title)}
                              title="Archive"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {role === "admin" && showArchived && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-emerald-700"
                              onClick={() => handleRestore(doc.id, doc.title)}
                              title="Restore"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Audit log panel (admin/developer only) */}
      {showAuditLog && (role === "admin" || role === "developer") && (
        <Card className="border-slate-200">
          <CardHeader className="px-6 py-4 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary/70" />
                Document Access Audit Log
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAuditLog(false)}
                className="text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Immutable record of every upload, view, download, and modification. Last 200 events.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {!accessLog || accessLog.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                No access events recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/20 text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-6 py-2.5 font-medium">Document</th>
                      <th className="text-left px-4 py-2.5 font-medium">Action</th>
                      <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">
                        User
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">
                        Role
                      </th>
                      <th className="text-right px-6 py-2.5 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {accessLog.map((entry) => {
                      const act = actionStyle(entry.action);
                      return (
                        <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-6 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground truncate max-w-[160px]">
                                {entry.documentTitle}
                              </span>
                              <span
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0",
                                  CATEGORY_META[entry.documentCategory as DocCategory]?.bg ??
                                    "bg-gray-100",
                                  CATEGORY_META[entry.documentCategory as DocCategory]?.color ??
                                    "text-gray-700"
                                )}
                              >
                                {CATEGORY_META[entry.documentCategory as DocCategory]?.label ??
                                  entry.documentCategory}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={cn("font-semibold", act.color)}>{act.label}</span>
                          </td>
                          <td className="px-4 py-2.5 hidden md:table-cell text-muted-foreground">
                            {entry.userDisplayName ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 hidden lg:table-cell text-muted-foreground capitalize">
                            {entry.userRole?.replace("_", " ") ?? "—"}
                          </td>
                          <td className="px-6 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(entry.createdAt).toLocaleString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
