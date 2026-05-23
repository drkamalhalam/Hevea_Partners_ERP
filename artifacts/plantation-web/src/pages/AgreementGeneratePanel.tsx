/**
 * AgreementGeneratePanel
 *
 * Lets admin / developer users select a DOCX template and generate a filled
 * legal document for a given agreement.  All {{VARIABLE}} tokens in the
 * template are replaced with the agreement's effective variable values.
 *
 * Generation uses a raw fetch (not a generated hook) because the endpoint
 * returns binary DOCX content that is streamed directly to a browser download.
 */

import { useState } from "react";
import {
  useListTemplates,
  getListTemplatesQueryKey,
  useListAgreementVariables,
  getListAgreementVariablesQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

interface Props {
  agreementId: string;
}

export default function AgreementGeneratePanel({ agreementId }: Props) {
  const { isAdmin, isDeveloper } = useRole();
  const canGenerate = isAdmin || isDeveloper;

  const { data: templates } = useListTemplates(
    { status: "active", category: "agreement" },
    {
      query: {
        enabled: canGenerate,
        queryKey: getListTemplatesQueryKey({
          status: "active",
          category: "agreement",
        }),
      },
    },
  );

  const { data: variablesData } = useListAgreementVariables(agreementId, {
    query: {
      enabled: canGenerate && !!agreementId,
      queryKey: getListAgreementVariablesQueryKey(agreementId),
    },
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFilename, setLastFilename] = useState<string | null>(null);

  if (!canGenerate) return null;

  const docxTemplates = (templates ?? []).filter((t) => t.fileFormat === "docx");

  const pendingCount = variablesData?.pendingCount ?? 0;
  const totalCount = variablesData?.totalCount ?? 0;
  const resolvedCount = variablesData?.resolvedCount ?? 0;

  const completionPct =
    totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  const selectedTemplate = docxTemplates.find(
    (t) => t.id === selectedTemplateId,
  );

  async function handleGenerate() {
    if (!selectedTemplateId) return;
    setIsGenerating(true);
    setError(null);
    setLastFilename(null);

    try {
      const response = await fetch(
        `/api/agreements/${agreementId}/generate-document`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: selectedTemplateId }),
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          (payload as { error?: string }).error ??
            `Server error ${response.status}`,
        );
      }

      // Extract filename from Content-Disposition header if present.
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `agreement_${agreementId.slice(0, 8)}.docx`;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setLastFilename(filename);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-serif flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Generate Legal Document
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Variable completion status */}
        <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground font-medium">
              Variable Completion
            </span>
            <span
              className={
                pendingCount === 0
                  ? "text-emerald-600 font-semibold"
                  : "text-amber-600 font-semibold"
              }
            >
              {resolvedCount} / {totalCount} ({completionPct}%)
            </span>
          </div>
          <div className="h-2 rounded-full bg-border overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                pendingCount === 0 ? "bg-emerald-500" : "bg-amber-500"
              }`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
          {pendingCount > 0 && (
            <p className="text-xs text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {pendingCount} variable{pendingCount !== 1 ? "s" : ""} without a
              value — they will appear as{" "}
              <code className="font-mono text-xs bg-amber-100 px-1 rounded">
                [PENDING: NAME]
              </code>{" "}
              in the output.
            </p>
          )}
          {pendingCount === 0 && totalCount > 0 && (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              All variables resolved — document is ready to generate.
            </p>
          )}
        </div>

        {/* Template selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Template</label>
          {docxTemplates.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Info className="w-4 h-4 shrink-0" />
              No active DOCX templates found. Upload a DOCX template in the
              Template Library first.
            </div>
          ) : (
            <Select
              value={selectedTemplateId}
              onValueChange={setSelectedTemplateId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a template…" />
              </SelectTrigger>
              <SelectContent>
                {docxTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="font-medium">{t.name}</span>
                    {t.version && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        v{t.version}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedTemplate?.description && (
            <p className="text-xs text-muted-foreground pl-1">
              {selectedTemplate.description}
            </p>
          )}
        </div>

        {/* Error state */}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Success state */}
        {lastFilename && !error && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
            <CheckCircle2 className="w-4 h-4" />
            <AlertDescription>
              Downloaded{" "}
              <span className="font-mono text-xs">{lastFilename}</span>
            </AlertDescription>
          </Alert>
        )}

        {/* Generate button */}
        <Button
          onClick={handleGenerate}
          disabled={!selectedTemplateId || isGenerating}
          className="w-full gap-2"
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {isGenerating ? "Generating…" : "Generate & Download DOCX"}
        </Button>

        {/* Legal note */}
        <p className="text-xs text-muted-foreground border-t pt-3">
          The generated document preserves all original formatting, legal
          numbering, tables, signature blocks, and witness sections from the
          template. Only the{" "}
          <code className="font-mono">{"{{VARIABLE}}"}</code> placeholders are
          substituted.
        </p>
      </CardContent>
    </Card>
  );
}
