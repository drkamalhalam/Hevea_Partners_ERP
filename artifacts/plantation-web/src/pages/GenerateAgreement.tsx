/**
 * GenerateAgreement — 5-step agreement generation wizard
 *
 * Step 1: Select Agreement
 * Step 2: Select Template
 * Step 3: Review & Complete Variables
 * Step 4: Document Preview  (styled HTML + Print to PDF)
 * Step 5: Confirm & Save    (creates immutable snapshot + downloads DOCX)
 */

import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListAgreements,
  getListAgreementsQueryKey,
  useListTemplates,
  getListTemplatesQueryKey,
  useListAgreementVariables,
  getListAgreementVariablesQueryKey,
  useResolveAgreementVariables,
  useCreateAgreementGeneration,
  getListAgreementGenerationsQueryKey,
  type Agreement,
  type AgreementTemplate,
  type AgreementVariable,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSignature,
  FileText,
  Printer,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: "Agreement" },
  { n: 2, label: "Template" },
  { n: 3, label: "Variables" },
  { n: 4, label: "Preview" },
  { n: 5, label: "Save" },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
                s.n < current
                  ? "bg-primary border-primary text-primary-foreground"
                  : s.n === current
                  ? "border-primary text-primary bg-primary/10"
                  : "border-muted-foreground/30 text-muted-foreground/50"
              }`}
            >
              {s.n < current ? <Check className="w-4 h-4" /> : s.n}
            </div>
            <span
              className={`text-xs hidden sm:block ${
                s.n === current ? "text-primary font-medium" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-0.5 w-8 sm:w-16 mx-1 mt-[-12px] transition-colors ${s.n < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Select Agreement ─────────────────────────────────────────────────

function StepSelectAgreement({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { data: agreements, isLoading } = useListAgreements({
    query: { queryKey: getListAgreementsQueryKey() },
  });

  if (isLoading) return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
  );

  if (!agreements?.length) return (
    <div className="text-center py-12 text-muted-foreground">
      No agreements found. <Link href="/agreements" className="text-primary underline">Create one first.</Link>
    </div>
  );

  const grouped = agreements.reduce<Record<string, Agreement[]>>((acc, a) => {
    (acc[a.projectName] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Select the agreement you want to generate a document for.</p>
      {Object.entries(grouped).map(([project, items]) => (
        <div key={project} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{project}</h3>
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                selected === a.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileSignature className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">
                      {a.landOwnerName} ↔ {a.projectDeveloperName}
                    </span>
                    {selected === a.id && <Check className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground pl-6">
                    <span>{a.landArea} {a.landAreaUnit}</span>
                    <span>·</span>
                    <span>{a.termYears} years</span>
                    <span>·</span>
                    <span>{a.executionDate}</span>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`capitalize shrink-0 ${a.status === "active" ? "border-green-300 text-green-700" : ""}`}
                >
                  {a.status}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Step 2: Select Template ──────────────────────────────────────────────────

function StepSelectTemplate({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { data: templates, isLoading } = useListTemplates(
    { status: "active" },
    { query: { queryKey: getListTemplatesQueryKey({ status: "active" }) } },
  );

  const docxTemplates = (templates ?? []).filter((t) => t.fileFormat === "docx");

  if (isLoading) return (
    <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
  );

  if (!docxTemplates.length) return (
    <div className="text-center py-12 text-muted-foreground">
      No active DOCX templates found.{" "}
      <Link href="/templates" className="text-primary underline">Upload a DOCX template</Link> first.
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Select the agreement template to use. Only DOCX templates support variable substitution.</p>
      {docxTemplates.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
            selected === t.id
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 bg-card"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-sm">{t.name}</span>
                {t.version && <Badge variant="secondary" className="text-xs">v{t.version}</Badge>}
                {selected === t.id && <Check className="w-4 h-4 text-primary" />}
              </div>
              {t.description && (
                <p className="text-xs text-muted-foreground pl-6">{t.description}</p>
              )}
            </div>
            <Badge variant="outline" className="text-xs shrink-0">DOCX</Badge>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Step 3: Variable Review ──────────────────────────────────────────────────

function StepVariableReview({
  agreementId,
  onComplete,
}: {
  agreementId: string;
  onComplete: (pending: number) => void;
}) {
  const queryClient = useQueryClient();
  const { data: varsData, isLoading } = useListAgreementVariables(agreementId, {
    query: { queryKey: getListAgreementVariablesQueryKey(agreementId) },
  });
  const resolve = useResolveAgreementVariables();
  const [resolving, setResolving] = useState(false);

  const pending = varsData?.pendingCount ?? 0;
  const total = varsData?.totalCount ?? 0;
  const resolved = varsData?.resolvedCount ?? 0;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;

  async function handleResolve() {
    setResolving(true);
    await resolve.mutateAsync({ id: agreementId });
    await queryClient.invalidateQueries({ queryKey: getListAgreementVariablesQueryKey(agreementId) });
    setResolving(false);
  }

  if (isLoading) return (
    <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 rounded" />)}</div>
  );

  const groups = (varsData?.variables ?? []).reduce<Record<string, AgreementVariable[]>>((acc, v) => {
    const g = v.group ?? "other";
    (acc[g] ??= []).push(v);
    return acc;
  }, {});

  const GROUP_LABELS: Record<string, string> = {
    project: "Project", parties: "Parties", dates: "Dates & Place", financial: "Financial", other: "Other",
  };

  return (
    <div className="space-y-4">
      {/* Progress + resolve */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5 flex-1 mr-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground font-medium">Variable Completion</span>
              <span className={pending === 0 ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                {resolved}/{total} ({pct}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pending === 0 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleResolve} disabled={resolving} className="shrink-0 gap-1.5">
            {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Auto-Resolve
          </Button>
        </div>
        {pending > 0 ? (
          <p className="text-xs text-amber-700 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {pending} variable{pending !== 1 ? "s" : ""} unresolved — they will appear as{" "}
            <code className="font-mono bg-amber-100 px-1 rounded">[PENDING: NAME]</code> in the document.
            You can still proceed.
          </p>
        ) : (
          <p className="text-xs text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            All variables resolved — document is ready.
          </p>
        )}
      </div>

      {/* Variable table by group */}
      {Object.entries(groups).map(([group, vars]) => (
        <div key={group} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABELS[group] ?? group}</h4>
          <div className="rounded-lg border overflow-hidden divide-y">
            {vars.map((v) => (
              <div key={v.name} className="flex items-start gap-3 px-3 py-2.5 bg-card text-sm">
                <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${v.effectiveValue ? "bg-emerald-500" : "bg-amber-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-xs">{v.label}</span>
                    <code className="text-xs text-muted-foreground font-mono">{`{{${v.name}}}`}</code>
                  </div>
                  {v.effectiveValue ? (
                    <p className="text-xs mt-0.5 text-foreground/80 truncate">{v.effectiveValue}</p>
                  ) : (
                    <p className="text-xs mt-0.5 text-amber-600 italic">Not resolved</p>
                  )}
                </div>
                {v.overrideValue && (
                  <Badge variant="outline" className="text-xs shrink-0 border-blue-200 text-blue-700">Override</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        To edit variable values, go to the{" "}
        <Link href={`/agreements/${agreementId}`} className="text-primary underline">agreement details page</Link>.
      </p>

      <Button onClick={() => onComplete(pending)} className="w-full gap-2">
        Variables Look Correct <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

// ─── Step 4: Document Preview ─────────────────────────────────────────────────

function StepPreview({
  agreement,
  template,
  variables,
}: {
  agreement: Agreement;
  template: AgreementTemplate;
  variables: AgreementVariable[];
}) {
  const val = (name: string) =>
    variables.find((v) => v.name === name)?.effectiveValue ?? `[PENDING: ${name}]`;

  const hasOwnership =
    agreement.ownershipShareLandowner != null ||
    agreement.ownershipShareDeveloper != null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Preview of filled agreement based on current variable values.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 print:hidden"
          onClick={() => window.print()}
        >
          <Printer className="w-4 h-4" /> Print to PDF
        </Button>
      </div>

      {/* Legal document preview — printable */}
      <div
        id="agreement-preview"
        className="rounded-xl border bg-white text-gray-900 p-8 space-y-6 text-sm leading-relaxed print:border-0 print:shadow-none print:p-0"
        style={{ fontFamily: "serif" }}
      >
        {/* Header */}
        <div className="text-center space-y-1 pb-4 border-b border-gray-300">
          <h1 className="text-xl font-bold uppercase tracking-wide">
            Rubber Plantation Development Agreement
          </h1>
          <p className="text-xs text-gray-500">Template: {template.name}{template.version ? ` (v${template.version})` : ""}</p>
        </div>

        {/* Preamble */}
        <p>
          This Agreement is entered into on{" "}
          <strong>{val("DATE")}</strong> at{" "}
          <strong>{val("EXECUTION_PLACE")}</strong>.
        </p>

        {/* Parties */}
        <div className="space-y-2">
          <h2 className="font-bold text-base">PARTIES</h2>
          <div className="pl-4 space-y-2">
            <p>
              <strong>First Party (Project Developer):</strong>{" "}
              {val("DEVELOPER_NAME")}
              {variables.find((v) => v.name === "DEVELOPER_ADDRESS")?.effectiveValue && (
                <>, {val("DEVELOPER_ADDRESS")}</>
              )}
            </p>
            <p>
              <strong>Second Party (Landowner):</strong>{" "}
              {val("LANDOWNER_NAME")}, {val("LANDOWNER_ADDRESS")}
            </p>
          </div>
        </div>

        {/* Project */}
        <div className="space-y-2">
          <h2 className="font-bold text-base">PROJECT DETAILS</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {[
                ["Project Name", val("PROJECT_NAME")],
                ["Project Location", val("PROJECT_LOCATION")],
                ["Land Area", val("LAND_AREA")],
                ["Agreement Term", `${val("TERM_YEARS")} Years`],
                ["Revenue Model", val("REVENUE_MODEL")],
              ].map(([label, value]) => (
                <tr key={label} className="border-b border-gray-200">
                  <td className="py-1.5 pr-4 font-medium text-gray-600 w-48">{label}</td>
                  <td className="py-1.5">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial */}
        <div className="space-y-2">
          <h2 className="font-bold text-base">FINANCIAL TERMS</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {[
                ["Notional Land Value", val("NOTIONAL_LAND_VALUE")],
                ["Amount in Words", val("AMOUNT_IN_WORDS")],
                ["Value per Unit", val("LAND_VALUE_PER_UNIT")],
                ["Yearly Escalation", val("YEARLY_ESCALATION")],
              ].map(([label, value]) => (
                <tr key={label} className="border-b border-gray-200">
                  <td className="py-1.5 pr-4 font-medium text-gray-600 w-48">{label}</td>
                  <td className="py-1.5">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Ownership */}
        {hasOwnership && (
          <div className="space-y-2">
            <h2 className="font-bold text-base">POST-MATURITY OWNERSHIP</h2>
            <table className="w-full border-collapse text-sm border border-gray-300">
              <thead>
                <tr className="bg-gray-50">
                  <th className="py-2 px-3 text-left font-semibold border-b border-gray-300">Party</th>
                  <th className="py-2 px-3 text-left font-semibold border-b border-gray-300">Ownership Share</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-2 px-3">{val("LANDOWNER_NAME")}</td>
                  <td className="py-2 px-3 font-medium">{val("OWNERSHIP_SHARE")}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3">{val("DEVELOPER_NAME")}</td>
                  <td className="py-2 px-3 font-medium">{val("DEVELOPER_OWNERSHIP_SHARE")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Signature block */}
        <div className="pt-6 border-t border-gray-300 space-y-2">
          <h2 className="font-bold text-base">SIGNATURES</h2>
          <div className="grid grid-cols-2 gap-8 pt-4">
            {[
              { label: "First Party (Developer)", name: val("DEVELOPER_NAME") },
              { label: "Second Party (Landowner)", name: val("LANDOWNER_NAME") },
            ].map((party) => (
              <div key={party.label} className="space-y-8">
                <div className="border-b border-gray-400 h-12" />
                <div>
                  <p className="font-medium text-xs">{party.label}</p>
                  <p className="text-xs text-gray-600">{party.name}</p>
                  <p className="text-xs text-gray-500 mt-1">Date: _______________</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <p className="text-xs font-semibold">WITNESSES:</p>
            <div className="grid grid-cols-2 gap-8 pt-4">
              {[1, 2].map((n) => (
                <div key={n} className="space-y-8">
                  <div className="border-b border-gray-400 h-12" />
                  <div>
                    <p className="text-xs text-gray-600">Witness {n}: _______________</p>
                    <p className="text-xs text-gray-500">Address: _______________</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-400 text-center border-t pt-3">
          This is a preview only. The generated DOCX document (using the actual uploaded template) is the legally binding version.
        </p>
      </div>
    </div>
  );
}

// ─── Step 5: Confirm & Save ───────────────────────────────────────────────────

function StepConfirm({
  agreementId,
  templateId,
  pendingVarCount,
  onSuccess,
}: {
  agreementId: string;
  templateId: string;
  pendingVarCount: number;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const createGeneration = useCreateAgreementGeneration();
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedGenId, setSavedGenId] = useState<string | null>(null);

  async function handleSaveAndDownload() {
    setError(null);
    try {
      const gen = await createGeneration.mutateAsync({
        id: agreementId,
        data: { templateId, notes: notes.trim() || undefined },
      });
      await queryClient.invalidateQueries({ queryKey: getListAgreementGenerationsQueryKey(agreementId) });
      setSavedGenId(gen.id);
      // Trigger DOCX download
      const response = await fetch(`/api/agreements/${agreementId}/generations/${gen.id}/download`);
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `agreement_${agreementId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate document.");
    }
  }

  if (savedGenId) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <div>
          <h3 className="text-xl font-serif font-bold">Document Generated</h3>
          <p className="text-muted-foreground text-sm mt-1">
            The document has been saved as a permanent historical snapshot and downloaded to your device.
          </p>
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="outline" asChild>
            <Link href={`/agreements/${agreementId}`}>View Agreement</Link>
          </Button>
          <Button asChild>
            <Link href="/generate-agreement">Generate Another</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {pendingVarCount > 0 && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            {pendingVarCount} variable{pendingVarCount !== 1 ? "s" : ""} unresolved — they will appear as{" "}
            <code className="font-mono text-xs bg-amber-100 px-1 rounded">[PENDING: NAME]</code> in the document.
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border p-4 space-y-3 bg-muted/20">
        <h3 className="font-semibold text-sm">What will happen:</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "A filled DOCX document will be generated from the selected template",
            "All current variable values will be captured in an immutable snapshot",
            "The DOCX file will be permanently stored in secure object storage",
            "The document will be downloaded to your device immediately",
            "Future template edits will not affect this historical record",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Notes (optional)</label>
        <Textarea
          placeholder="e.g. Final version after review on 13 May 2026…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleSaveAndDownload}
        disabled={createGeneration.isPending}
        className="w-full gap-2"
        size="lg"
      >
        {createGeneration.isPending ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Download className="w-5 h-5" />
        )}
        {createGeneration.isPending ? "Generating…" : "Save Snapshot & Download DOCX"}
      </Button>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export default function GenerateAgreement() {
  const { isAdmin, isDeveloper } = useRole();
  const [step, setStep] = useState(1);
  const [agreementId, setAgreementId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [pendingVarCount, setPendingVarCount] = useState(0);
  const [savedGenId, setSavedGenId] = useState<string | null>(null);

  const { data: agreements } = useListAgreements({
    query: { queryKey: getListAgreementsQueryKey() },
  });
  const { data: templates } = useListTemplates(
    { status: "active" },
    { query: { queryKey: getListTemplatesQueryKey({ status: "active" }) } },
  );
  const { data: varsData } = useListAgreementVariables(agreementId, {
    query: {
      enabled: !!agreementId && step >= 3,
      queryKey: getListAgreementVariablesQueryKey(agreementId),
    },
  });

  const selectedAgreement = useMemo(
    () => agreements?.find((a) => a.id === agreementId),
    [agreements, agreementId],
  );
  const selectedTemplate = useMemo(
    () => templates?.find((t) => t.id === templateId),
    [templates, templateId],
  );
  const variables = varsData?.variables ?? [];

  if (!isAdmin && !isDeveloper) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        You do not have permission to generate agreement documents.
      </div>
    );
  }

  function canProceed() {
    if (step === 1) return !!agreementId;
    if (step === 2) return !!templateId;
    if (step === 3) return true;
    if (step === 4) return true;
    return false;
  }

  const STEP_TITLES = [
    "Select Agreement",
    "Select Template",
    "Review Variables",
    "Document Preview",
    "Confirm & Save",
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/agreements">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Agreements
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-serif font-bold">Generate Deed</h1>
        <p className="text-muted-foreground mt-1">
          Create a filled legal agreement document from a template.
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Step card */}
      <Card>
        <CardHeader className="pb-4 border-b">
          <CardTitle className="font-serif text-lg">
            Step {step}: {STEP_TITLES[step - 1]}
          </CardTitle>
          {/* Breadcrumb summary */}
          {step >= 2 && selectedAgreement && (
            <p className="text-xs text-muted-foreground">
              Agreement: <span className="font-medium">{selectedAgreement.landOwnerName} ↔ {selectedAgreement.projectDeveloperName}</span>
              {step >= 3 && selectedTemplate && (
                <> · Template: <span className="font-medium">{selectedTemplate.name}</span></>
              )}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-5">
          {step === 1 && (
            <StepSelectAgreement selected={agreementId} onSelect={setAgreementId} />
          )}
          {step === 2 && (
            <StepSelectTemplate selected={templateId} onSelect={setTemplateId} />
          )}
          {step === 3 && agreementId && (
            <StepVariableReview
              agreementId={agreementId}
              onComplete={(pending) => {
                setPendingVarCount(pending);
                setStep(4);
              }}
            />
          )}
          {step === 4 && selectedAgreement && selectedTemplate && (
            <StepPreview
              agreement={selectedAgreement}
              template={selectedTemplate}
              variables={variables}
            />
          )}
          {step === 5 && (
            <StepConfirm
              agreementId={agreementId}
              templateId={templateId}
              pendingVarCount={pendingVarCount}
              onSuccess={() => setSavedGenId("done")}
            />
          )}
        </CardContent>
      </Card>

      {/* Navigation (not on step 3 which has its own CTA, or step 5) */}
      {step !== 3 && step !== 5 && (
        <div className="flex gap-3 justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3 | 4 | 5)}
            disabled={step === 1}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          {step < 5 && step !== 4 && (
            <Button
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4 | 5)}
              disabled={!canProceed()}
              className="gap-2"
            >
              Next <ArrowRight className="w-4 h-4" />
            </Button>
          )}
          {step === 4 && (
            <Button onClick={() => setStep(5)} className="gap-2">
              Confirm & Save <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}
      {step === 3 && (
        <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to Template
        </Button>
      )}
    </div>
  );
}
