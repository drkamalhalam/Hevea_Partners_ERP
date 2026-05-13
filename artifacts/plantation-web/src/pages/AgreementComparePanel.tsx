/**
 * AgreementComparePanel
 *
 * Side-by-side comparison of two generation snapshots for the same agreement.
 * Pure client-side diff — loads the generation list (already cached) and
 * computes differences locally.  No extra API call needed.
 */

import { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  useListAgreementGenerations,
  getListAgreementGenerationsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GitCompareArrows, CheckCircle2, AlertCircle, Minus } from "lucide-react";

interface Props {
  agreementId: string;
}

type DiffStatus = "changed" | "added" | "removed" | "same";

interface DiffRow {
  key: string;
  valueA: string | null;
  valueB: string | null;
  status: DiffStatus;
}

function buildDiff(
  a: Record<string, string>,
  b: Record<string, string>,
): DiffRow[] {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(allKeys)
    .sort()
    .map((key) => {
      const va = a[key] ?? null;
      const vb = b[key] ?? null;
      let status: DiffStatus = "same";
      if (va === null && vb !== null) status = "added";
      else if (va !== null && vb === null) status = "removed";
      else if (va !== vb) status = "changed";
      return { key, valueA: va, valueB: vb, status };
    });
}

const STATUS_COLORS: Record<DiffStatus, string> = {
  changed: "bg-amber-50 border-l-4 border-l-amber-400",
  added: "bg-emerald-50 border-l-4 border-l-emerald-400",
  removed: "bg-red-50 border-l-4 border-l-red-300",
  same: "",
};

const STATUS_BADGES: Record<DiffStatus, React.ReactNode> = {
  changed: <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200">Changed</Badge>,
  added: <Badge className="text-xs bg-emerald-100 text-emerald-800 border-emerald-200">Added</Badge>,
  removed: <Badge className="text-xs bg-red-100 text-red-800 border-red-200">Removed</Badge>,
  same: null,
};

export default function AgreementComparePanel({ agreementId }: Props) {
  const { data: generations, isLoading } = useListAgreementGenerations(agreementId, {
    query: { queryKey: getListAgreementGenerationsQueryKey(agreementId) },
  });

  const [genAId, setGenAId] = useState<string>("");
  const [genBId, setGenBId] = useState<string>("");
  const [showSame, setShowSame] = useState(false);

  const genA = generations?.find((g) => g.id === genAId);
  const genB = generations?.find((g) => g.id === genBId);

  const diffRows = useMemo(() => {
    if (!genA || !genB) return [];
    return buildDiff(
      genA.variableSnapshot as Record<string, string>,
      genB.variableSnapshot as Record<string, string>,
    );
  }, [genA, genB]);

  const changedCount = diffRows.filter((r) => r.status !== "same").length;
  const filteredRows = showSame ? diffRows : diffRows.filter((r) => r.status !== "same");

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!generations || generations.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-serif flex items-center gap-2 text-base">
            <GitCompareArrows className="w-4 h-4" /> Compare Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            At least two generation records are needed to compare.
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatLabel = (gen: typeof generations[0]) =>
    `${format(new Date(gen.generatedAt), "dd MMM yyyy HH:mm")} — ${gen.templateName}${gen.templateVersion ? ` v${gen.templateVersion}` : ""}${gen.generatedByName ? ` (${gen.generatedByName})` : ""}`;

  return (
    <Card>
      <CardHeader className="pb-3 border-b">
        <CardTitle className="font-serif flex items-center gap-2 text-base">
          <GitCompareArrows className="w-4 h-4 text-primary" />
          Compare Snapshots
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Selection row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Version A (Base)</label>
            <Select value={genAId} onValueChange={setGenAId}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Select a generation…" />
              </SelectTrigger>
              <SelectContent>
                {generations.map((g) => (
                  <SelectItem key={g.id} value={g.id} disabled={g.id === genBId} className="text-xs">
                    {formatLabel(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Version B (Compare)</label>
            <Select value={genBId} onValueChange={setGenBId}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Select a generation…" />
              </SelectTrigger>
              <SelectContent>
                {generations.map((g) => (
                  <SelectItem key={g.id} value={g.id} disabled={g.id === genAId} className="text-xs">
                    {formatLabel(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Context snapshots — lifecycle + status */}
        {genA && genB && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            {["A", "B"].map((label, idx) => {
              const gen = idx === 0 ? genA : genB;
              return (
                <div key={label} className={`rounded-lg border p-3 space-y-1 ${idx === 0 ? "border-blue-200 bg-blue-50/50" : "border-violet-200 bg-violet-50/50"}`}>
                  <p className={`font-semibold ${idx === 0 ? "text-blue-700" : "text-violet-700"}`}>Version {label}</p>
                  <p className="text-muted-foreground">{format(new Date(gen.generatedAt), "dd MMM yyyy, HH:mm")}</p>
                  {gen.lifecycleStatusSnapshot && (
                    <p>Lifecycle: <span className="font-medium capitalize">{gen.lifecycleStatusSnapshot.replace("_", " ")}</span></p>
                  )}
                  {gen.agreementStatusSnapshot && (
                    <p>Status: <span className="font-medium capitalize">{gen.agreementStatusSnapshot}</span></p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Diff results */}
        {genA && genB && diffRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                {changedCount === 0 ? (
                  <span className="text-xs text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Snapshots are identical
                  </span>
                ) : (
                  <span className="text-xs text-amber-700 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {changedCount} variable{changedCount !== 1 ? "s" : ""} differ
                  </span>
                )}
              </div>
              {changedCount < diffRows.length && (
                <button
                  className="text-xs text-primary underline"
                  onClick={() => setShowSame(!showSame)}
                >
                  {showSame ? "Hide unchanged" : `Show all ${diffRows.length}`}
                </button>
              )}
            </div>

            <div className="rounded-lg border overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1fr_1fr_1fr] text-xs font-semibold bg-muted/50 px-3 py-2 border-b">
                <span>Variable</span>
                <span className="text-blue-700">Version A</span>
                <span className="text-violet-700">Version B</span>
              </div>
              {/* Rows */}
              <div className="divide-y max-h-80 overflow-y-auto">
                {filteredRows.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
                    <Minus className="w-3.5 h-3.5" /> No differences — all variables are identical
                  </div>
                ) : (
                  filteredRows.map((row) => (
                    <div
                      key={row.key}
                      className={`grid grid-cols-[1fr_1fr_1fr] px-3 py-2.5 text-xs ${STATUS_COLORS[row.status]}`}
                    >
                      <div className="space-y-1">
                        <code className="font-mono text-muted-foreground">{`{{${row.key}}}`}</code>
                        {STATUS_BADGES[row.status]}
                      </div>
                      <div className={`pr-2 truncate ${row.status === "removed" ? "line-through text-muted-foreground" : ""}`}>
                        {row.valueA ?? <span className="text-muted-foreground italic">not set</span>}
                      </div>
                      <div className={`pr-2 truncate ${row.status === "added" ? "text-emerald-700 font-medium" : row.status === "changed" ? "text-amber-800 font-medium" : ""}`}>
                        {row.valueB ?? <span className="text-muted-foreground italic">not set</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {(!genAId || !genBId) && (
          <p className="text-xs text-muted-foreground text-center py-3">
            Select two generations above to compare their variable snapshots.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
