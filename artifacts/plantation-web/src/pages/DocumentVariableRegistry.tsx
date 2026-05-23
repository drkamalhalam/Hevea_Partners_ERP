import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDocumentVariables,
  useCreateDocumentVariable,
  useUpdateDocumentVariable,
  useDeleteDocumentVariable,
  getListDocumentVariablesQueryKey,
} from "@workspace/api-client-react";
import type { DocumentVariableRegistryEntry } from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Power, Search } from "lucide-react";

type SourceType =
  | "project_field"
  | "person_field"
  | "schedule_a_field"
  | "agreement_field"
  | "calculated"
  | "system_generated";

const SOURCE_LABELS: Record<SourceType, string> = {
  project_field: "Project Field",
  person_field: "Person Field",
  schedule_a_field: "Schedule A Field",
  agreement_field: "Agreement Field",
  calculated: "Calculated",
  system_generated: "System Generated",
};

const SOURCE_COLORS: Record<SourceType, string> = {
  project_field: "bg-blue-100 text-blue-800",
  person_field: "bg-purple-100 text-purple-800",
  schedule_a_field: "bg-emerald-100 text-emerald-800",
  agreement_field: "bg-amber-100 text-amber-800",
  calculated: "bg-pink-100 text-pink-800",
  system_generated: "bg-slate-100 text-slate-800",
};

interface FormState {
  variableKey: string;
  label: string;
  description: string;
  sourceType: SourceType;
  sourceField: string;
  dataType: string;
  isRequired: boolean;
  exampleValue: string;
  groupName: string;
}

const emptyForm: FormState = {
  variableKey: "",
  label: "",
  description: "",
  sourceType: "project_field",
  sourceField: "",
  dataType: "string",
  isRequired: false,
  exampleValue: "",
  groupName: "",
};

export default function DocumentVariableRegistry() {
  const { role } = useRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = role === "admin" || role === "developer";

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceType | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const { data: variables, isLoading } = useListDocumentVariables();
  const create = useCreateDocumentVariable();
  const update = useUpdateDocumentVariable();
  const del = useDeleteDocumentVariable();

  const filtered = (variables ?? []).filter((v) => {
    if (sourceFilter !== "all" && v.sourceType !== sourceFilter) return false;
    if (search.trim() === "") return true;
    const q = search.toLowerCase();
    return (
      v.variableKey.toLowerCase().includes(q) ||
      v.label.toLowerCase().includes(q) ||
      (v.description ?? "").toLowerCase().includes(q)
    );
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListDocumentVariablesQueryKey() });
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(v: DocumentVariableRegistryEntry) {
    setEditingId(v.id);
    setForm({
      variableKey: v.variableKey,
      label: v.label,
      description: v.description ?? "",
      sourceType: v.sourceType as SourceType,
      sourceField: v.sourceField ?? "",
      dataType: v.dataType,
      isRequired: v.isRequired,
      exampleValue: v.exampleValue ?? "",
      groupName: v.groupName ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingId) {
        await update.mutateAsync({
          id: editingId,
          data: {
            label: form.label,
            description: form.description || undefined,
            sourceType: form.sourceType,
            sourceField: form.sourceField || undefined,
            dataType: form.dataType || "string",
            isRequired: form.isRequired,
            exampleValue: form.exampleValue || undefined,
            groupName: form.groupName || undefined,
          },
        });
        toast({ title: "Variable updated" });
      } else {
        await create.mutateAsync({
          data: {
            variableKey: form.variableKey.trim(),
            label: form.label.trim(),
            description: form.description.trim() || undefined,
            sourceType: form.sourceType,
            sourceField: form.sourceField.trim() || undefined,
            dataType: form.dataType || "string",
            isRequired: form.isRequired,
            exampleValue: form.exampleValue.trim() || undefined,
            groupName: form.groupName.trim() || undefined,
          },
        });
        toast({ title: "Variable created" });
      }
      setDialogOpen(false);
      invalidate();
    } catch (err) {
      toast({
        title: editingId ? "Update failed" : "Create failed",
        description: String(err),
        variant: "destructive",
      });
    }
  }

  async function handleDeactivate(v: DocumentVariableRegistryEntry) {
    if (
      !window.confirm(
        `Deactivate variable {{${v.variableKey}}}? Templates using it will become unmapped.`,
      )
    )
      return;
    try {
      await del.mutateAsync({ id: v.id });
      toast({ title: "Variable deactivated" });
      invalidate();
    } catch {
      toast({ title: "Deactivate failed", variant: "destructive" });
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 px-6 py-5 border-b">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Document Variable Registry</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Central definition of every <code className="text-xs">{"{{TOKEN}}"}</code> that
              document templates can use. All template activations validate against this registry.
            </p>
          </div>
          {canManage && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Variable
            </Button>
          )}
        </div>
      </div>

      <div className="shrink-0 px-6 py-3 border-b flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search variables…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as SourceType | "all")}
        >
          <SelectTrigger className="w-[200px] h-9 text-sm">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {(Object.keys(SOURCE_LABELS) as SourceType[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variable Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Field Path</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Example</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                {canManage && <TableHead className="w-[100px] text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={canManage ? 8 : 7}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 8 : 7}
                    className="text-center py-10 text-muted-foreground"
                  >
                    No variables match the current filters
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((v) => (
                  <TableRow key={v.id} className={!v.isActive ? "opacity-50" : ""}>
                    <TableCell className="font-mono text-xs">
                      {`{{${v.variableKey}}}`}
                    </TableCell>
                    <TableCell className="text-sm">{v.label}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${
                          SOURCE_COLORS[v.sourceType as SourceType] ?? ""
                        } font-normal`}
                      >
                        {SOURCE_LABELS[v.sourceType as SourceType] ?? v.sourceType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {v.sourceField ?? "—"}
                    </TableCell>
                    <TableCell>
                      {v.isRequired ? (
                        <Badge variant="default" className="text-xs">
                          Required
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Optional</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {v.exampleValue ?? "—"}
                    </TableCell>
                    <TableCell>
                      {v.isActive ? (
                        <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(v)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {v.isActive && role === "admin" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleDeactivate(v)}
                            title="Deactivate"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Variable" : "New Variable"}
            </DialogTitle>
            <DialogDescription>
              Define a placeholder that document templates can reference as{" "}
              <code className="text-xs">{"{{VARIABLE_KEY}}"}</code>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>
                Variable Key <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.variableKey}
                onChange={(e) =>
                  setForm({ ...form, variableKey: e.target.value.toUpperCase() })
                }
                placeholder="PROJECT_NAME"
                pattern="^[A-Z][A-Z0-9_]*$"
                disabled={!!editingId}
                required
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                UPPERCASE_WITH_UNDERSCORES. Cannot be changed once created.
              </p>
            </div>
            <div className="space-y-1">
              <Label>
                Label <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Project Name"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>
                  Source Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.sourceType}
                  onValueChange={(v) => setForm({ ...form, sourceType: v as SourceType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SOURCE_LABELS) as SourceType[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {SOURCE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Data Type</Label>
                <Select
                  value={form.dataType}
                  onValueChange={(v) => setForm({ ...form, dataType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">String</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="currency">Currency</SelectItem>
                    <SelectItem value="boolean">Boolean</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Source Field Path</Label>
              <Input
                value={form.sourceField}
                onChange={(e) => setForm({ ...form, sourceField: e.target.value })}
                placeholder="name  or  landOwner.address"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Dot-path on the source record where the value lives.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Example Value</Label>
              <Input
                value={form.exampleValue}
                onChange={(e) => setForm({ ...form, exampleValue: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Group</Label>
                <Input
                  value={form.groupName}
                  onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                  placeholder="project, parties, financial…"
                />
              </div>
              <div className="space-y-1">
                <Label>Required</Label>
                <div className="flex items-center h-10">
                  <input
                    type="checkbox"
                    checked={form.isRequired}
                    onChange={(e) =>
                      setForm({ ...form, isRequired: e.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Block activation when missing
                  </span>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>
                {editingId ? "Save Changes" : "Create Variable"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
