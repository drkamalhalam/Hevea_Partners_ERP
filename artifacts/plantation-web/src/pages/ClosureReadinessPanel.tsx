import { useGetProjectClosureReadiness, getGetProjectClosureReadinessQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Package,
  ArrowLeftRight,
  FileCheck,
  RotateCcw,
  Layers,
} from "lucide-react";
import type { ClosureReadiness } from "@workspace/api-client-react";

// ── Eligibility status display config ─────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; description: string; className: string; badgeClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  closure_ready: {
    label: "Closure Ready",
    description: "All stock balances are zero and no pending operations remain. Project is eligible for closure.",
    className: "border-emerald-200 bg-emerald-50/50",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
  },
  blocked_inventory: {
    label: "Blocked by Inventory",
    description: "Project cannot be closed. Remaining stock must be fully sold, transferred, or written off before closure.",
    className: "border-red-200 bg-red-50/50",
    badgeClass: "bg-red-100 text-red-800 border-red-200",
    icon: XCircle,
  },
  pending_operational: {
    label: "Pending Operational Clearance",
    description: "No stock remains but pending operational items (open batches, transfers, or dispatch memos) must be resolved.",
    className: "border-amber-200 bg-amber-50/40",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-200",
    icon: Clock,
  },
};

// ── Stock type label helper ────────────────────────────────────────────────

function stockLabel(type: string): string {
  switch (type) {
    case "latex": return "Latex";
    case "rubber_sheet": return "Rubber Sheet";
    case "rubber_scrap": return "Rubber Scrap";
    default: return type;
  }
}

// ── Section heading ────────────────────────────────────────────────────────

function SectionRow({ icon: Icon, label, value, ok }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-2 text-sm">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono text-muted-foreground">{value}</span>
        {ok
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          : <XCircle className="w-4 h-4 text-red-500" />
        }
      </div>
    </div>
  );
}

// ── Alert row ─────────────────────────────────────────────────────────────

function AlertRow({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <AlertTriangle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
      <span className="text-sm text-red-800">{message}</span>
    </div>
  );
}

// ── Main panel component ───────────────────────────────────────────────────

interface Props {
  projectId: string;
}

export default function ClosureReadinessPanel({ projectId }: Props) {
  const { data, isLoading, refetch, isFetching } = useGetProjectClosureReadiness(projectId, {
    query: { enabled: !!projectId, retry: false, queryKey: getGetProjectClosureReadinessQueryKey(projectId) },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <RotateCcw className="w-4 h-4 animate-spin" />
            Checking inventory clearance status…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const cfg = STATUS_CONFIG[data.eligibilityStatus] ?? STATUS_CONFIG.pending_operational;
  const StatusIcon = cfg.icon;

  const latexBalance = data.stockBalances.find((b: ClosureReadiness["stockBalances"][number]) => b.stockType === "latex");
  const sheetBalance = data.stockBalances.find((b: ClosureReadiness["stockBalances"][number]) => b.stockType === "rubber_sheet");
  const scrapBalance = data.stockBalances.find((b: ClosureReadiness["stockBalances"][number]) => b.stockType === "rubber_scrap");

  const latexKg = latexBalance?.netKg ?? 0;
  const sheetKg = sheetBalance?.netKg ?? 0;
  const scrapKg = scrapBalance?.netKg ?? 0;

  const openBatches = data.openBatches ?? [];
  const pendingTransfers = data.pendingTransfers ?? [];
  const activeMemos = data.activeMemos ?? [];

  return (
    <Card className={cfg.className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="font-serif text-base flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Closure Eligibility Check
          </CardTitle>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.badgeClass}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              {cfg.label}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RotateCcw className={`w-3 h-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{cfg.description}</p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Active blockers summary */}
        {data.blockers.length > 0 && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2.5 space-y-0.5">
            <p className="text-xs font-semibold text-red-700 mb-1.5 uppercase tracking-wide">
              Closure Blockers ({data.blockers.length})
            </p>
            {data.blockers.map((b: string, i: number) => (
              <AlertRow key={i} message={b} />
            ))}
          </div>
        )}

        {/* Stock balance verification */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Stock Balances (must all be zero)
          </p>
          <div className="rounded-md border bg-background/60 px-3">
            <SectionRow
              icon={Package}
              label="Latex"
              value={`${latexKg.toFixed(3)} kg`}
              ok={latexKg <= 0.001}
            />
            <SectionRow
              icon={Package}
              label="Rubber Sheet"
              value={`${sheetKg.toFixed(3)} kg`}
              ok={sheetKg <= 0.001}
            />
            <SectionRow
              icon={Package}
              label="Rubber Scrap"
              value={`${scrapKg.toFixed(3)} kg`}
              ok={scrapKg <= 0.001}
            />
            {data.stockBalances
              .filter((b: ClosureReadiness["stockBalances"][number]) => !["latex", "rubber_sheet", "rubber_scrap"].includes(b.stockType))
              .map((b: ClosureReadiness["stockBalances"][number]) => (
                <SectionRow
                  key={b.stockType}
                  icon={Package}
                  label={stockLabel(b.stockType)}
                  value={`${(b.netKg ?? 0).toFixed(3)} kg`}
                  ok={(b.netKg ?? 0) <= 0.001}
                />
              ))}
          </div>
        </div>

        {/* Open production batches */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Production Batches (must all be closed)
          </p>
          <div className="rounded-md border bg-background/60 px-3">
            <SectionRow
              icon={FileCheck}
              label="Open Batches"
              value={openBatches.length === 0 ? "None" : `${openBatches.length} open`}
              ok={openBatches.length === 0}
            />
            {openBatches.length > 0 && (
              <div className="pb-2 pt-1 space-y-1">
                {openBatches.map((b: { id: string; batchNumber: string; status: string }) => (
                  <div key={b.id} className="flex items-center gap-2 text-xs text-red-700 pl-6">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Batch {b.batchNumber} — Pending Batch Not Cleared
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pending stock transfers */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Stock Transfers (must all be resolved)
          </p>
          <div className="rounded-md border bg-background/60 px-3">
            <SectionRow
              icon={ArrowLeftRight}
              label="Pending Transfers"
              value={pendingTransfers.length === 0 ? "None" : `${pendingTransfers.length} pending`}
              ok={pendingTransfers.length === 0}
            />
            {pendingTransfers.length > 0 && (
              <div className="pb-2 pt-1 space-y-1">
                {pendingTransfers.map((t: { id: string; transferCode: string; quantityKg: string; transferStatus: string }) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs text-red-700 pl-6">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Transfer {t.transferCode} · {parseFloat(t.quantityKg).toFixed(1)} kg — Pending Stock Transfer Exists
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Active dispatch memos */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Sales Dispatch Memos (must all be completed)
          </p>
          <div className="rounded-md border bg-background/60 px-3">
            <SectionRow
              icon={FileCheck}
              label="Active Dispatch Memos"
              value={activeMemos.length === 0 ? "None" : `${activeMemos.length} active`}
              ok={activeMemos.length === 0}
            />
            {activeMemos.length > 0 && (
              <div className="pb-2 pt-1 space-y-1">
                {activeMemos.map((m: { id: string; memoCode: string; remainingKg: string; dispatchStatus: string }) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs text-red-700 pl-6">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Memo {m.memoCode} · {parseFloat(m.remainingKg).toFixed(1)} kg remaining — Pending Sales Dispatch Exists
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Eligibility summary footer */}
        <div className={`rounded-md px-3 py-2.5 text-sm font-medium flex items-center gap-2 ${
          data.isEligible
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
            : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {data.isEligible
            ? <><CheckCircle2 className="w-4 h-4 shrink-0" /> Eligible for Closure — all inventory cleared and no pending operations</>
            : <><XCircle className="w-4 h-4 shrink-0" /> Not eligible — resolve all blockers above before initiating closure</>
          }
        </div>

        <p className="text-xs text-muted-foreground">
          Last checked: {new Date(data.checkedAt).toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}
