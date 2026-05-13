/**
 * AgreementGenerationsPanel
 * Embedded in AgreementDetails — shows the immutable generation history for an
 * agreement.  Each row links to a re-download of the permanently stored DOCX.
 */

import { format } from "date-fns";
import {
  useListAgreementGenerations,
  getListAgreementGenerationsQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { History, Download, FileText, User, Clock } from "lucide-react";

interface Props {
  agreementId: string;
}

export default function AgreementGenerationsPanel({ agreementId }: Props) {
  const { isAdmin, isDeveloper } = useRole();
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
    const dateStr = generatedAt.slice(0, 10);
    a.href = url;
    a.download = `agreement_${agreementId.slice(0, 8)}_${dateStr}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="font-serif flex items-center gap-2"><History className="w-5 h-5" /> Generation History</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </CardContent>
      </Card>
    );
  }

  if (!generations || generations.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="font-serif flex items-center gap-2"><History className="w-5 h-5" /> Generation History</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">
            No documents have been generated for this agreement yet.
            {(isAdmin || isDeveloper) && " Use the Generate Deed page to create the first one."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-serif flex items-center gap-2">
          <History className="w-5 h-5 text-primary" />
          Generation History
          <Badge variant="secondary" className="ml-auto">{generations.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {generations.map((gen, idx) => {
          const snap = gen.variableSnapshot as Record<string, string>;
          const filled = resolvedCount(snap);
          const total = Object.keys(snap).length;
          const isLatest = idx === 0;
          return (
            <div
              key={gen.id}
              className={`rounded-lg border p-4 space-y-2 ${isLatest ? "border-primary/30 bg-primary/5" : "bg-muted/20"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm truncate">{gen.templateName}</span>
                    {gen.templateVersion && (
                      <Badge variant="outline" className="text-xs">v{gen.templateVersion}</Badge>
                    )}
                    {isLatest && <Badge className="text-xs bg-primary/10 text-primary border-primary/20">Latest</Badge>}
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
                    <span className={`${filled === total ? "text-emerald-600" : "text-amber-600"}`}>
                      {filled}/{total} variables filled
                    </span>
                  </div>
                  {gen.notes && (
                    <p className="text-xs text-muted-foreground italic">"{gen.notes}"</p>
                  )}
                </div>
                {gen.fileObjectPath && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => handleRedownload(gen.id, gen.generatedAt)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    DOCX
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground pt-1 border-t">
          All generated documents are permanent historical snapshots. Template edits do not affect existing records.
        </p>
      </CardContent>
    </Card>
  );
}
