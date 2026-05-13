/**
 * AgreementGenerationsPanel
 * Embedded in AgreementDetails — shows the immutable generation history for an
 * agreement with View (→ snapshot viewer), Compare, and Re-download actions.
 * Also embeds the AgreementComparePanel comparison tab.
 */

import { useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import {
  useListAgreementGenerations,
  getListAgreementGenerationsQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, Download, FileText, User, Clock, Eye, GitCompareArrows, Layers } from "lucide-react";
import AgreementComparePanel from "./AgreementComparePanel";

interface Props {
  agreementId: string;
}

type Tab = "history" | "compare";

export default function AgreementGenerationsPanel({ agreementId }: Props) {
  const { isAdmin, isDeveloper } = useRole();
  const [tab, setTab] = useState<Tab>("history");

  const { data: generations, isLoading } = useListAgreementGenerations(agreementId, {
    query: {
      enabled: !!agreementId,
      queryKey: getListAgreementGenerationsQueryKey(agreementId),
    },
  });

  const resolvedCount = (snap: Record<string, string>) =>
    Object.values(snap).filter((v) => v && !v.startsWith("[PENDING:")).length;

  async function handleRedownload(genId: string, generatedAt: string) {
    const response = await fetch(
      `/api/agreements/${agreementId}/generations/${genId}/download`,
    );
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agreement_${agreementId.slice(0, 8)}_${generatedAt.slice(0, 10)}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const LIFECYCLE_LABELS: Record<string, string> = {
    prematurity: "Prematurity",
    mature_production: "Mature Production",
    closed: "Closed",
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-serif flex items-center gap-2">
            <History className="w-5 h-5" /> Generation History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </CardContent>
      </Card>
    );
  }

  if (!generations || generations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-serif flex items-center gap-2">
            <History className="w-5 h-5" /> Generation History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            No documents have been generated for this agreement yet.
            {(isAdmin || isDeveloper) && (
              <>
                {" "}Use the{" "}
                <Link href="/generate-agreement" className="text-primary underline">
                  Generate Deed
                </Link>
                {" "}page to create the first one.
              </>
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {/* Header with tab switcher */}
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="font-serif flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Generation History
            <Badge variant="secondary">{generations.length}</Badge>
          </CardTitle>
          {generations.length >= 2 && (
            <div className="flex rounded-lg border overflow-hidden text-xs">
              <button
                className={`px-3 py-1.5 gap-1.5 flex items-center font-medium transition-colors ${tab === "history" ? "bg-primary text-primary-foreground" : "hover:bg-muted/40"}`}
                onClick={() => setTab("history")}
              >
                <Layers className="w-3.5 h-3.5" /> Archive
              </button>
              <button
                className={`px-3 py-1.5 gap-1.5 flex items-center font-medium transition-colors ${tab === "compare" ? "bg-primary text-primary-foreground" : "hover:bg-muted/40"}`}
                onClick={() => setTab("compare")}
              >
                <GitCompareArrows className="w-3.5 h-3.5" /> Compare
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-3">
        {tab === "compare" ? (
          <AgreementComparePanel agreementId={agreementId} />
        ) : (
          <>
            {generations.map((gen, idx) => {
              const snap = gen.variableSnapshot as Record<string, string>;
              const filled = resolvedCount(snap);
              const total = Object.keys(snap).length;
              const isLatest = idx === 0;

              return (
                <div
                  key={gen.id}
                  className={`rounded-xl border p-4 space-y-2.5 transition-colors ${isLatest ? "border-primary/30 bg-primary/5" : "bg-muted/20 hover:bg-muted/30"}`}
                >
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">{gen.templateName}</span>
                        {gen.templateVersion && (
                          <Badge variant="outline" className="text-xs">v{gen.templateVersion}</Badge>
                        )}
                        {isLatest && (
                          <Badge className="text-xs bg-primary/10 text-primary border-primary/20">Latest</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(gen.generatedAt), "dd MMM yyyy, HH:mm")}
                        </span>
                        {gen.generatedByName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {gen.generatedByName}
                          </span>
                        )}
                        <span className={filled === total ? "text-emerald-600" : "text-amber-600"}>
                          {filled}/{total} variables resolved
                        </span>
                      </div>
                      {/* Lifecycle + status chips */}
                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        {gen.lifecycleStatusSnapshot && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200">
                            {LIFECYCLE_LABELS[gen.lifecycleStatusSnapshot] ?? gen.lifecycleStatusSnapshot}
                          </span>
                        )}
                        {gen.agreementStatusSnapshot && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 capitalize">
                            {gen.agreementStatusSnapshot}
                          </span>
                        )}
                        {gen.notes && (
                          <span className="text-xs text-muted-foreground italic">"{gen.notes}"</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        asChild
                      >
                        <Link href={`/agreements/${agreementId}/generations/${gen.id}`}>
                          <Eye className="w-3.5 h-3.5" /> View
                        </Link>
                      </Button>
                      {gen.fileObjectPath && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs"
                          onClick={() => handleRedownload(gen.id, gen.generatedAt)}
                        >
                          <Download className="w-3.5 h-3.5" /> DOCX
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <p className="text-xs text-muted-foreground pt-1 border-t">
              All generated documents are permanent historical snapshots. Template edits do not affect existing records.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
