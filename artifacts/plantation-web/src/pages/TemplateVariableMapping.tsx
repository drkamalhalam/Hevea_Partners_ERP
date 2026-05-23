import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTemplate,
  useGetTemplateVariables,
  useParseTemplate,
  useActivateTemplate,
  useSupersedeTemplate,
  useGetTemplateAudit,
  getGetTemplateVariablesQueryKey,
  getGetTemplateAuditQueryKey,
  getGetTemplateQueryKey,
  getListTemplatesQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Power,
  History,
} from "lucide-react";
import { format } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-200 text-slate-800",
  active: "bg-emerald-200 text-emerald-900",
  superseded: "bg-amber-200 text-amber-900",
  archived: "bg-zinc-200 text-zinc-700",
};

const MAPPING_STYLES: Record<string, string> = {
  mapped: "bg-emerald-100 text-emerald-800",
  missing: "bg-amber-100 text-amber-800",
  invalid: "bg-red-100 text-red-800",
  unused: "bg-orange-100 text-orange-800",
};

const EVENT_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  parsed: "Parsed",
  mapping_updated: "Mapping Updated",
  metadata_updated: "Metadata Updated",
  activated: "Activated",
  superseded: "Superseded",
  archived: "Archived",
  restored: "Restored",
  downloaded: "Downloaded",
  generated: "Generated",
};

export default function TemplateVariableMapping() {
  const [, params] = useRoute("/document-templates/:id/variables");
  const id = params?.id;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { role } = useRole();
  const canManage = role === "admin" || role === "developer";

  const [tab, setTab] = useState<"variables" | "audit">("variables");

  const tplQuery = useGetTemplate(id ?? "", {
    query: { enabled: !!id, queryKey: getGetTemplateQueryKey(id ?? "") },
  });
  const varsQuery = useGetTemplateVariables(id ?? "", {
    query: {
      enabled: !!id,
      queryKey: getGetTemplateVariablesQueryKey(id ?? ""),
    },
  });
  const auditQuery = useGetTemplateAudit(id ?? "", {
    query: {
      enabled: !!id && tab === "audit",
      queryKey: getGetTemplateAuditQueryKey(id ?? ""),
    },
  });

  const parse = useParseTemplate();
  const activate = useActivateTemplate();
  const supersede = useSupersedeTemplate();

  function invalidateAll() {
    if (!id) return;
    qc.invalidateQueries({ queryKey: getGetTemplateQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetTemplateVariablesQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetTemplateAuditQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
  }

  async function handleParse() {
    if (!id) return;
    try {
      await parse.mutateAsync({ id });
      toast({ title: "Template parsed", description: "Mapping refreshed." });
      invalidateAll();
    } catch (err) {
      toast({
        title: "Parse failed",
        description: String(err),
        variant: "destructive",
      });
    }
  }

  async function handleActivate() {
    if (!id) return;
    try {
      await activate.mutateAsync({ id, data: {} });
      toast({
        title: "Template activated",
        description: "Any prior active template in this category was superseded.",
      });
      invalidateAll();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string; blockers?: string[] } } };
      const msg =
        e?.response?.data?.error ?? "Activation failed";
      const blockers = e?.response?.data?.blockers;
      toast({
        title: msg,
        description: blockers?.join(" · ") ?? String(err),
        variant: "destructive",
      });
    }
  }

  async function handleSupersede() {
    if (!id) return;
    if (!window.confirm("Mark this template as superseded? It will no longer be used for generation."))
      return;
    try {
      await supersede.mutateAsync({ id, data: {} });
      toast({ title: "Template superseded" });
      invalidateAll();
    } catch {
      toast({ title: "Supersede failed", variant: "destructive" });
    }
  }

  if (!id) {
    return <div className="p-6 text-sm text-muted-foreground">Invalid template id</div>;
  }

  const template = tplQuery.data;
  const mapping = varsQuery.data;
  const summary = mapping?.summary;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/document-templates">
            <Button variant="ghost" size="sm" className="h-8 -ml-2">
              <ArrowLeft className="h-4 w-4 mr-1" />
              All Templates
            </Button>
          </Link>
        </div>
        {tplQuery.isLoading ? (
          <Skeleton className="h-8 w-72" />
        ) : template ? (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{template.name}</h1>
                <Badge className={STATUS_STYLES[template.status] ?? ""}>
                  {template.status}
                </Badge>
                <Badge variant="outline" className="font-mono text-xs">
                  {template.category}
                </Badge>
                <Badge variant="outline" className="text-xs uppercase">
                  {template.fileFormat}
                </Badge>
                <span className="text-xs text-muted-foreground">v{template.version}</span>
              </div>
              {template.documentDescription && (
                <p className="text-sm text-muted-foreground mt-1">
                  {template.documentDescription}
                </p>
              )}
            </div>
            {canManage && (
              <div className="flex items-center gap-2 shrink-0">
                {template.fileFormat === "docx" && (
                  <Button variant="outline" size="sm" onClick={handleParse}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Re-parse
                  </Button>
                )}
                {template.status === "draft" && summary?.canActivate && (
                  <Button size="sm" onClick={handleActivate}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Activate
                  </Button>
                )}
                {template.status === "active" && (
                  <Button variant="outline" size="sm" onClick={handleSupersede}>
                    <Power className="h-3.5 w-3.5 mr-1.5" />
                    Supersede
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Template not found</p>
        )}
      </div>

      {/* Activation status banner */}
      {template && summary && (
        <div className="shrink-0 px-6 py-3 border-b bg-muted/30">
          {summary.canActivate ? (
            <Alert className="border-emerald-300 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <AlertTitle className="text-emerald-900">Ready to activate</AlertTitle>
              <AlertDescription className="text-emerald-800">
                All {summary.total} placeholder{summary.total !== 1 ? "s" : ""} are mapped to
                Variable Registry entries.
              </AlertDescription>
            </Alert>
          ) : summary.total === 0 ? (
            <Alert className="border-slate-300 bg-slate-50">
              <AlertTriangle className="h-4 w-4 text-slate-700" />
              <AlertTitle>Not parsed yet</AlertTitle>
              <AlertDescription className="text-muted-foreground">
                {template.fileFormat === "docx"
                  ? "Run Re-parse to scan this template for placeholders."
                  : "PDF templates do not support placeholder parsing."}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              <AlertTitle className="text-amber-900">
                Activation blocked
              </AlertTitle>
              <AlertDescription className="text-amber-800">
                <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                  {summary.blockers?.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "variables" | "audit")} className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-3 border-b">
            <TabsList>
              <TabsTrigger value="variables">Variables</TabsTrigger>
              <TabsTrigger value="audit">
                <History className="h-3.5 w-3.5 mr-1.5" />
                Audit Log
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="variables" className="flex-1 overflow-y-auto p-6 mt-0">
            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-5 gap-3 mb-4">
                <SummaryStat label="Total" value={summary.total} />
                <SummaryStat label="Mapped" value={summary.mapped} color="emerald" />
                <SummaryStat label="Missing" value={summary.missing} color="amber" />
                <SummaryStat label="Invalid" value={summary.invalid} color="red" />
                <SummaryStat label="Unused" value={summary.unused} color="orange" />
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detected Placeholders</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Placeholder</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Registry Label</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Field Path</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varsQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : (mapping?.items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          No placeholders detected yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      mapping!.items.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-xs">
                            {`{{${row.variableKey}}}`}
                          </TableCell>
                          <TableCell>
                            <Badge className={MAPPING_STYLES[row.status] ?? ""}>
                              {row.status === "mapped" && (
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                              )}
                              {row.status === "missing" && (
                                <AlertTriangle className="h-3 w-3 mr-1" />
                              )}
                              {row.status === "invalid" && (
                                <XCircle className="h-3 w-3 mr-1" />
                              )}
                              {row.status === "unused" && (
                                <AlertTriangle className="h-3 w-3 mr-1" />
                              )}
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.registryEntry?.label ?? (
                              <span className="text-orange-600 italic">
                                Not in registry
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.registryEntry?.sourceType ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {row.registryEntry?.sourceField ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {summary && summary.unused > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                <strong>Unused</strong> placeholders are present in the DOCX but have no Variable
                Registry entry. Either add them in the{" "}
                <Link href="/document-variables" className="text-primary underline">
                  Document Variable Registry
                </Link>
                , or remove them from the template.
              </p>
            )}
          </TabsContent>

          <TabsContent value="audit" className="flex-1 overflow-y-auto p-6 mt-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lifecycle Audit</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : (auditQuery.data ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                          No audit events yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      auditQuery.data!.map((ev) => (
                        <TableRow key={ev.id}>
                          <TableCell>
                            <Badge variant="outline">
                              {EVENT_LABELS[ev.eventType] ?? ev.eventType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(ev.createdAt), "dd MMM yyyy HH:mm")}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ev.performedByName ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {ev.reason
                              ? ev.reason
                              : ev.payload
                                ? JSON.stringify(ev.payload)
                                : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  color = "slate",
}: {
  label: string;
  value: number;
  color?: "slate" | "emerald" | "amber" | "red" | "orange";
}) {
  const colorMap: Record<string, string> = {
    slate: "text-slate-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-700",
    orange: "text-orange-700",
  };
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <p className="text-xs text-muted-foreground uppercase">{label}</p>
        <p className={`text-2xl font-bold ${colorMap[color]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
