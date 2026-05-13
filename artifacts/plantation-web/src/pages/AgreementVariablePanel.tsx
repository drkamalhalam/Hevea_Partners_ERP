import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgreementVariables,
  useResolveAgreementVariables,
  useUpdateAgreementVariables,
  getListAgreementVariablesQueryKey,
} from "@workspace/api-client-react";
import type { AgreementVariable } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Zap,
  Pencil,
  Check,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Database,
  Users,
  FileText,
  HelpCircle,
} from "lucide-react";
import { useRole } from "@/contexts/RoleContext";

// ─── Source badge ─────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<
  string,
  { label: string; color: string; Icon: React.ElementType }
> = {
  project: { label: "Project", color: "bg-sky-100 text-sky-800 border-sky-200", Icon: Database },
  partner: { label: "Partner", color: "bg-violet-100 text-violet-800 border-violet-200", Icon: Users },
  agreement: { label: "Agreement", color: "bg-emerald-100 text-emerald-800 border-emerald-200", Icon: FileText },
  ownership: { label: "Ownership", color: "bg-amber-100 text-amber-800 border-amber-200", Icon: Database },
  manual: { label: "Manual", color: "bg-orange-100 text-orange-800 border-orange-200", Icon: Pencil },
};

function SourceBadge({ source }: { source: string }) {
  const cfg = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.manual;
  const { Icon } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Group label map ──────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  project: "Project",
  parties: "Parties",
  financial: "Financial",
  dates: "Dates & Place",
  other: "Other",
};

const GROUP_ORDER = ["project", "parties", "dates", "financial", "other"];

// ─── Inline edit cell ─────────────────────────────────────────────────────────

function EditableValueCell({
  variable,
  canEdit,
  onSave,
}: {
  variable: AgreementVariable;
  canEdit: boolean;
  onSave: (name: string, value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(variable.overrideValue ?? "");

  const hasOverride = variable.overrideValue !== null && variable.overrideValue !== undefined;
  const effective = variable.effectiveValue;

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Input
          className="h-7 text-sm py-0 px-2"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={variable.example}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSave(variable.name, draft || null); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-emerald-600"
          onClick={() => { onSave(variable.name, draft || null); setEditing(false); }}
        >
          <Check className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-red-500"
          onClick={() => setEditing(false)}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0 group">
      {effective ? (
        <span
          className={`text-sm truncate font-medium ${
            hasOverride ? "text-amber-700" : "text-gray-900"
          }`}
        >
          {effective}
          {hasOverride && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-1 text-xs text-amber-500 cursor-help">(override)</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    Auto-resolved: {variable.resolvedValue ?? "—"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground italic">
          e.g. {variable.example}
        </span>
      )}
      {canEdit && (
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
          onClick={() => {
            setDraft(variable.overrideValue ?? variable.resolvedValue ?? "");
            setEditing(true);
          }}
        >
          <Pencil className="w-3 h-3" />
        </Button>
      )}
      {hasOverride && canEdit && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-amber-500"
                onClick={() => onSave(variable.name, null)}
              >
                <X className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Clear override, use auto-resolved value</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface AgreementVariablePanelProps {
  agreementId: string;
}

export default function AgreementVariablePanel({ agreementId }: AgreementVariablePanelProps) {
  const { role } = useRole();
  const canEdit = role === "admin" || role === "developer";
  const queryClient = useQueryClient();

  const { data, isLoading } = useListAgreementVariables(agreementId, {
    query: {
      enabled: !!agreementId,
      queryKey: getListAgreementVariablesQueryKey(agreementId),
    },
  });

  const { mutate: resolve, isPending: isResolving } = useResolveAgreementVariables({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListAgreementVariablesQueryKey(agreementId),
        });
      },
    },
  });

  const { mutate: saveOverrides, isPending: isSaving } = useUpdateAgreementVariables({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListAgreementVariablesQueryKey(agreementId),
        });
      },
    },
  });

  function handleSave(name: string, value: string | null) {
    saveOverrides({
      id: agreementId,
      data: { overrides: [{ name, value }] },
    });
  }

  function handleResolve() {
    resolve({ id: agreementId });
  }

  if (isLoading) {
    return (
      <Card className="border border-gray-200 shadow-none">
        <CardHeader className="pb-3 px-5 pt-4">
          <Skeleton className="h-5 w-48 rounded" />
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { variables, resolvedCount, pendingCount, totalCount } = data;

  // Group variables by group
  const grouped: Record<string, AgreementVariable[]> = {};
  for (const v of variables) {
    const g = v.group ?? "other";
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(v);
  }

  const completionPct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  return (
    <Card className="border border-gray-200 shadow-none">
      <CardHeader className="pb-3 px-5 pt-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="font-serif text-base flex items-center gap-2">
              Document Variables
              <Badge variant="outline" className="text-xs font-normal">
                {resolvedCount}/{totalCount} resolved
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placeholder values that will be substituted into the agreement template
            </p>
          </div>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-8"
              onClick={handleResolve}
              disabled={isResolving}
            >
              {isResolving ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-amber-500" />
              )}
              Auto-Resolve from Data
            </Button>
          )}
        </div>

        {/* Completion bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              {pendingCount > 0 ? (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertCircle className="w-3 h-3" />
                  {pendingCount} variable{pendingCount !== 1 ? "s" : ""} still pending
                </span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="w-3 h-3" />
                  All variables resolved
                </span>
              )}
            </span>
            <span>{completionPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                completionPct === 100 ? "bg-emerald-500" : "bg-amber-400"
              }`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 space-y-5">
        {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
          <div key={group}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {GROUP_LABELS[group] ?? group}
            </p>
            <div className="rounded-lg border border-gray-100 overflow-hidden divide-y divide-gray-100">
              {grouped[group].map((variable) => (
                <div
                  key={variable.name}
                  className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-gray-50/50 transition-colors"
                >
                  {/* Status dot */}
                  <div className="flex-shrink-0">
                    {variable.effectiveValue ? (
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-amber-300" />
                    )}
                  </div>

                  {/* Label + placeholder token */}
                  <div className="flex-shrink-0 w-44 min-w-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-default">
                            <p className="text-sm font-medium text-gray-900 truncate leading-tight">
                              {variable.label}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono truncate">
                              {`{{${variable.name}}}`}
                            </p>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs max-w-[220px]">{variable.description}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* Source badge */}
                  <div className="flex-shrink-0 hidden sm:block">
                    <SourceBadge source={variable.dataSource} />
                  </div>

                  {/* Value — editable */}
                  <div className="flex-1 min-w-0">
                    <EditableValueCell
                      variable={variable}
                      canEdit={canEdit && !isSaving}
                      onSave={handleSave}
                    />
                  </div>

                  {/* Info icon for non-resolved manual */}
                  {variable.dataSource === "manual" && !variable.effectiveValue && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">This field must be entered manually</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {!canEdit && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            Only admins and developers can edit variable values.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
