/**
 * GenerationViewer — immutable historical snapshot page
 * Route: /agreements/:id/generations/:genId
 *
 * Renders the complete, permanently-frozen state of a generated agreement document.
 * Nothing on this page is editable — it is a read-only historical record.
 */

import { useParams } from "wouter";
import { format } from "date-fns";
import {
  useGetAgreement,
  getGetAgreementQueryKey,
  useGetAgreementGeneration,
  getGetAgreementGenerationQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Printer,
  Download,
  Lock,
  FileText,
  User,
  Clock,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

// ─── Lifecycle badge colours ──────────────────────────────────────────────────

const LIFECYCLE_COLORS: Record<string, string> = {
  prematurity: "bg-sky-100 text-sky-800 border-sky-200",
  mature_production: "bg-emerald-100 text-emerald-800 border-emerald-200",
  closed: "bg-gray-100 text-gray-800 border-gray-200",
};
const LIFECYCLE_LABELS: Record<string, string> = {
  prematurity: "Prematurity",
  mature_production: "Mature Production",
  closed: "Closed",
};
const AGREEMENT_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-green-100 text-green-800",
  matured: "bg-blue-100 text-blue-800",
  terminated: "bg-red-100 text-red-800",
};

// ─── Document preview (same styled HTML as wizard Step 4) ────────────────────

function DocumentPreview({ snapshot }: { snapshot: Record<string, string> }) {
  const val = (name: string) =>
    snapshot[name] ?? `[PENDING: ${name}]`;

  const isPending = (name: string) => !snapshot[name];

  const hasOwnership = snapshot["OWNERSHIP_SHARE"] || snapshot["DEVELOPER_OWNERSHIP_SHARE"];

  return (
    <div
      id="generation-preview"
      className="rounded-xl border bg-white text-gray-900 p-8 space-y-6 text-sm leading-relaxed print:border-0 print:shadow-none print:p-0"
      style={{ fontFamily: "serif" }}
    >
      <div className="text-center space-y-1 pb-4 border-b border-gray-300">
        <h1 className="text-xl font-bold uppercase tracking-wide">
          Rubber Plantation Development Agreement
        </h1>
        <p className="text-xs text-gray-500 italic">
          Immutable historical record — generated on{" "}
          {/* generatedAt injected by parent */}
        </p>
      </div>

      <p>
        This Agreement was entered into on{" "}
        <strong>{val("DATE")}</strong> at{" "}
        <strong>{val("EXECUTION_PLACE")}</strong>.
      </p>

      <div className="space-y-2">
        <h2 className="font-bold text-base">PARTIES</h2>
        <div className="pl-4 space-y-1.5">
          <p>
            <strong>First Party (Project Developer):</strong>{" "}
            {val("DEVELOPER_NAME")}
            {snapshot["DEVELOPER_ADDRESS"] && `, ${val("DEVELOPER_ADDRESS")}`}
          </p>
          <p>
            <strong>Second Party (Landowner):</strong>{" "}
            {val("LANDOWNER_NAME")}, {val("LANDOWNER_ADDRESS")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="font-bold text-base">PROJECT DETAILS</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {[
              ["Project Name", "PROJECT_NAME"],
              ["Project Location", "PROJECT_LOCATION"],
              ["Land Area", "LAND_AREA"],
              ["Agreement Term", "TERM_YEARS"],
              ["Revenue Model", "REVENUE_MODEL"],
            ].map(([label, key]) => (
              <tr key={key} className="border-b border-gray-200">
                <td className="py-1.5 pr-4 font-medium text-gray-600 w-48">{label}</td>
                <td className={`py-1.5 ${isPending(key) ? "text-amber-600 italic" : ""}`}>
                  {val(key)}{key === "TERM_YEARS" && !isPending(key) ? " years" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h2 className="font-bold text-base">FINANCIAL TERMS</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {[
              ["Notional Land Value", "NOTIONAL_LAND_VALUE"],
              ["Amount in Words", "AMOUNT_IN_WORDS"],
              ["Value per Unit", "LAND_VALUE_PER_UNIT"],
              ["Yearly Escalation", "YEARLY_ESCALATION"],
            ].map(([label, key]) => (
              <tr key={key} className="border-b border-gray-200">
                <td className="py-1.5 pr-4 font-medium text-gray-600 w-48">{label}</td>
                <td className={`py-1.5 ${isPending(key) ? "text-amber-600 italic" : ""}`}>
                  {val(key)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasOwnership && (
        <div className="space-y-2">
          <h2 className="font-bold text-base">POST-MATURITY OWNERSHIP</h2>
          <table className="w-full border-collapse text-sm border border-gray-300">
            <thead>
              <tr className="bg-gray-50">
                <th className="py-2 px-3 text-left font-semibold border-b border-gray-300">Party</th>
                <th className="py-2 px-3 text-left font-semibold border-b border-gray-300">Share</th>
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

      <div className="pt-6 border-t border-gray-300 space-y-2">
        <h2 className="font-bold text-base">SIGNATURES</h2>
        <div className="grid grid-cols-2 gap-8 pt-4">
          {[
            { label: "First Party (Developer)", nameKey: "DEVELOPER_NAME" },
            { label: "Second Party (Landowner)", nameKey: "LANDOWNER_NAME" },
          ].map((p) => (
            <div key={p.label} className="space-y-8">
              <div className="border-b border-gray-400 h-12" />
              <div>
                <p className="font-medium text-xs">{p.label}</p>
                <p className="text-xs text-gray-600">{val(p.nameKey)}</p>
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

      <p className="text-xs text-gray-400 text-center border-t pt-3">
        This preview is reconstructed from the immutable variable snapshot.
        The generated DOCX (downloadable above) is the official document.
      </p>
    </div>
  );
}

// ─── Variable snapshot table ──────────────────────────────────────────────────

function SnapshotTable({ snapshot }: { snapshot: Record<string, string> }) {
  const entries = Object.entries(snapshot);
  const pending = entries.filter(([, v]) => !v || v.startsWith("[PENDING:"));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-serif flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Captured Variable Snapshot
          <Badge variant="secondary" className="ml-auto">{entries.length} variables</Badge>
        </CardTitle>
        {pending.length > 0 && (
          <p className="text-xs text-amber-600 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {pending.length} variable{pending.length !== 1 ? "s" : ""} were unresolved at generation time
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y text-sm max-h-96 overflow-y-auto">
          {entries.map(([name, value]) => {
            const isPending = !value || value.startsWith("[PENDING:");
            return (
              <div key={name} className="flex items-start gap-3 px-4 py-2.5">
                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${isPending ? "bg-amber-400" : "bg-emerald-500"}`} />
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono text-muted-foreground">{`{{${name}}}`}</code>
                  <p className={`text-xs mt-0.5 truncate ${isPending ? "text-amber-600 italic" : "text-foreground/80"}`}>
                    {value || "—"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main viewer ──────────────────────────────────────────────────────────────

export default function GenerationViewer() {
  const { id, genId } = useParams<{ id: string; genId: string }>();

  const { data: agreement, isLoading: agreementLoading } = useGetAgreement(id, {
    query: { queryKey: getGetAgreementQueryKey(id) },
  });
  const { data: generation, isLoading: genLoading } = useGetAgreementGeneration(id, genId, {
    query: {
      enabled: !!(id && genId),
      queryKey: getGetAgreementGenerationQueryKey(id, genId),
    },
  });

  const isLoading = agreementLoading || genLoading;
  const snapshot = (generation?.variableSnapshot ?? {}) as Record<string, string>;
  const filledCount = Object.values(snapshot).filter((v) => v && !v.startsWith("[PENDING:")).length;
  const totalCount = Object.keys(snapshot).length;
  const allFilled = filledCount === totalCount;

  async function handleDownload() {
    if (!generation?.fileObjectPath) return;
    const response = await fetch(`/api/agreements/${id}/generations/${genId}/download`);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agreement_${id.slice(0, 8)}_${generation.generatedAt.slice(0, 10)}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!generation) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Generation record not found.{" "}
        <Link href={`/agreements/${id}`} className="text-primary underline">Back to agreement</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/agreements">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Agreements
          </Button>
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link href={`/agreements/${id}`}>
          <Button variant="ghost" size="sm">
            {agreement?.projectName ?? "Agreement"}
          </Button>
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-muted-foreground">
          Snapshot #{generation.id.slice(0, 8)}
        </span>
      </div>

      {/* Immutability banner */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
        <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-amber-800">Immutable Historical Record</p>
          <p className="text-xs text-amber-700">
            This snapshot is permanently frozen. No edits are possible — it preserves the exact state
            of the agreement variables at the moment this document was generated.
          </p>
        </div>
      </div>

      {/* Generation metadata card */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="font-serif flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                {generation.templateName}
                {generation.templateVersion && (
                  <Badge variant="secondary">v{generation.templateVersion}</Badge>
                )}
              </CardTitle>
              {agreement && (
                <p className="text-sm text-muted-foreground">
                  {agreement.projectName} · {agreement.landOwnerName} ↔ {agreement.projectDeveloperName}
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap print:hidden">
              {generation.fileObjectPath && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
                  <Download className="w-4 h-4" /> Download DOCX
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> Print to PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3" /> Generated
              </dt>
              <dd className="font-medium text-xs">
                {format(new Date(generation.generatedAt), "dd MMM yyyy, HH:mm")}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <User className="w-3 h-3" /> By
              </dt>
              <dd className="font-medium text-xs">{generation.generatedByName ?? "Unknown"}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">Variables</dt>
              <dd>
                <span className={`text-xs font-semibold ${allFilled ? "text-emerald-600" : "text-amber-600"}`}>
                  {filledCount}/{totalCount} resolved
                </span>
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">Lifecycle at Generation</dt>
              <dd>
                {generation.lifecycleStatusSnapshot ? (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${LIFECYCLE_COLORS[generation.lifecycleStatusSnapshot] ?? "bg-gray-100 text-gray-700"}`}>
                    {LIFECYCLE_LABELS[generation.lifecycleStatusSnapshot] ?? generation.lifecycleStatusSnapshot}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </dd>
            </div>
            {generation.agreementStatusSnapshot && (
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground uppercase tracking-wider">Agreement Status</dt>
                <dd>
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${AGREEMENT_STATUS_COLORS[generation.agreementStatusSnapshot] ?? "bg-gray-100 text-gray-700"}`}>
                    {generation.agreementStatusSnapshot}
                  </span>
                </dd>
              </div>
            )}
            {generation.notes && (
              <div className="space-y-1 col-span-2">
                <dt className="text-xs text-muted-foreground uppercase tracking-wider">Notes</dt>
                <dd className="text-xs italic">"{generation.notes}"</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Variable snapshot table */}
      <SnapshotTable snapshot={snapshot} />

      {/* Document preview */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-xl font-bold">Document Preview</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-2">
            {allFilled ? (
              <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> All variables resolved</>
            ) : (
              <><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> {totalCount - filledCount} pending variables</>
            )}
          </div>
        </div>
        <DocumentPreview snapshot={snapshot} />
      </div>
    </div>
  );
}
