/**
 * AgreementAuditLog
 *
 * Immutable audit trail for a single agreement — shows every generation event
 * (and any variable override changes) in chronological order.
 * Embedded in AgreementDetails.
 */

import { format } from "date-fns";
import { useState } from "react";
import {
  useListAgreementAuditLog,
  getListAgreementAuditLogQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  FileText,
  Edit,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  RefreshCw,
} from "lucide-react";

interface Props {
  agreementId: string;
}

const OPERATION_CONFIG = {
  INSERT: {
    icon: <Plus className="w-3.5 h-3.5" />,
    color: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dotColor: "bg-emerald-500",
  },
  UPDATE: {
    icon: <Edit className="w-3.5 h-3.5" />,
    color: "bg-blue-100 text-blue-800 border-blue-200",
    dotColor: "bg-blue-500",
  },
  DELETE: {
    icon: <Trash2 className="w-3.5 h-3.5" />,
    color: "bg-red-100 text-red-800 border-red-200",
    dotColor: "bg-red-500",
  },
};

const TABLE_ICONS: Record<string, React.ReactNode> = {
  agreement_generations: <FileText className="w-3.5 h-3.5 text-muted-foreground" />,
  agreement_variable_values: <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />,
};

export default function AgreementAuditLog({ agreementId }: Props) {
  const { data: entries, isLoading, refetch } = useListAgreementAuditLog(agreementId, {
    query: {
      enabled: !!agreementId,
      queryKey: getListAgreementAuditLogQueryKey(agreementId),
    },
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-serif flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="font-serif flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Audit Trail
            {entries && entries.length > 0 && (
              <Badge variant="secondary" className="ml-1">{entries.length}</Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Immutable record of all document generation events for this agreement.
          Entries cannot be edited or deleted.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        {!entries || entries.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            No audit events recorded yet. Events will appear here after generating a document.
          </div>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical timeline line */}
            <div className="absolute left-4 top-3 bottom-3 w-0.5 bg-border" />
            <div className="space-y-1">
              {entries.map((entry) => {
                const opConfig = OPERATION_CONFIG[entry.operation as keyof typeof OPERATION_CONFIG] ??
                  OPERATION_CONFIG.INSERT;
                const isExpanded = expandedId === entry.id;

                return (
                  <div key={entry.id} className="relative pl-9">
                    {/* Timeline dot */}
                    <div className={`absolute left-2.5 top-3.5 w-3 h-3 rounded-full border-2 border-background ${opConfig.dotColor}`} />

                    <div className={`rounded-lg border transition-colors ${isExpanded ? "border-primary/30 bg-primary/5" : "border-transparent hover:border-border hover:bg-muted/20"}`}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2.5"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {TABLE_ICONS[entry.tableName] ?? null}
                              <span className="text-sm font-medium truncate">{entry.summary}</span>
                              <Badge
                                variant="outline"
                                className={`text-xs ml-auto shrink-0 ${opConfig.color}`}
                              >
                                {opConfig.icon}
                                <span className="ml-1">{entry.operation}</span>
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {format(new Date(entry.createdAt), "dd MMM yyyy, HH:mm:ss")}
                              </span>
                              {entry.performedByName && (
                                <span className="flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  {entry.performedByName}
                                </span>
                              )}
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-2 border-t border-primary/10 pt-2">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-muted-foreground">Record ID</p>
                              <code className="font-mono text-xs">{entry.recordId}</code>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Table</p>
                              <code className="font-mono text-xs">{entry.tableName}</code>
                            </div>
                          </div>
                          {entry.newData && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                View captured data
                              </summary>
                              <pre className="mt-1.5 rounded bg-muted/60 p-2 text-xs overflow-x-auto max-h-48 leading-relaxed">
                                {JSON.stringify(entry.newData, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
