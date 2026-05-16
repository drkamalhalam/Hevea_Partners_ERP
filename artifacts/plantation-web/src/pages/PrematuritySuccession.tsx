/**
 * PrematuritySuccession.tsx
 *
 * Prematurity Death Succession Workflow
 *
 * When a partner dies before the project reaches maturity, their claimants
 * continue the participation position independently. This page manages:
 *
 * Tab 1 – Dashboard        : KPIs + governance flags + pending actions
 * Tab 2 – Participation    : Activate/manage each claimant's participation
 * Tab 3 – OTP Queue        : Pending contribution OTP verifications (developer)
 * Tab 4 – Accumulation     : Disputed accumulation ledger + release/forfeit
 *
 * Design rule: projectOperationsBlocked is ALWAYS false. This workflow
 * never freezes project operations — it only tracks inheritance continuation.
 */

import { useState } from "react";
import {
  useGetPrematuritySuccessionDashboard,
  useListClaimantParticipations,
  useCreateClaimantParticipation,
  useUpdateClaimantParticipation,
  useDeleteClaimantParticipation,
  useListClaimantContributions,
  useCreateClaimantContribution,
  useRequestContributionOtp,
  useVerifyContributionOtp,
  useUpdateClaimantContribution,
  useListDisputedAccumulation,
  useCreateDisputedAccumulationEntry,
  useUpdateDisputedAccumulationEntry,
  useReleaseAccumulationEntry,
  useForfeitAccumulationEntry,
  useListInheritanceClaims,
  useListPartners,
  useListProjects,
} from "@workspace/api-client-react";
import type {
  ClaimantParticipationRecord,
  ClaimantContribution,
  DisputedAccumulationEntry,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  Sprout,
  Users,
  Banknote,
  Scale,
  Plus,
  RefreshCw,
  ShieldCheck,
  Ban,
  CircleDot,
  Info,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListClaimantParticipationsQueryKey,
  getListClaimantContributionsQueryKey,
  getListDisputedAccumulationQueryKey,
  getGetPrematuritySuccessionDashboardQueryKey,
} from "@workspace/api-client-react";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | string | undefined | null): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type ParticipationStatus = "active" | "suspended" | "disputed" | "resolved" | "withdrawn";

const PARTICIPATION_STATUS_COLORS: Record<ParticipationStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  disputed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  suspended: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  resolved: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  withdrawn: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const CONTRIBUTION_STATUS_COLORS: Record<string, string> = {
  pending_otp: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  otp_sent: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
};

const ACCUMULATION_STATUS_COLORS: Record<string, string> = {
  accumulating: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  released: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  forfeited: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

function ParticipationBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${PARTICIPATION_STATUS_COLORS[status as ParticipationStatus] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ContributionStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CONTRIBUTION_STATUS_COLORS[status] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function AccumulationBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${ACCUMULATION_STATUS_COLORS[status] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}
    >
      {status}
    </span>
  );
}

// ── Non-freeze Notice ──────────────────────────────────────────────────────

function NonFreezeNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
      <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
      <p className="text-xs text-emerald-300/80 leading-relaxed">
        <strong className="text-emerald-400">Project operations continue normally.</strong>{" "}
        This workflow tracks claimant succession and never blocks or freezes project
        activities. Disputed amounts are held in a separate accumulation ledger until
        claimants resolve their dispute — the project itself is unaffected.
      </p>
    </div>
  );
}

// ── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent?: string;
  sub?: string;
}) {
  return (
    <Card className="bg-gray-800/60 border-gray-700/50">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`rounded-lg p-2.5 ${accent ?? "bg-sky-500/15"}`}>
          <Icon className={`h-5 w-5 ${accent ? "text-white" : "text-sky-400"}`} />
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">{label}</p>
          <p className="text-xl font-semibold text-gray-100">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 1 — DASHBOARD
// ══════════════════════════════════════════════════════════════════════════

function DashboardTab({
  projectId,
  canAdmin,
}: {
  projectId: string | null;
  canAdmin: boolean;
}) {
  const { data, isLoading, refetch } = useGetPrematuritySuccessionDashboard(
    projectId ? { projectId } : {},
  );

  const summary = data?.summary;
  const flags = data?.governanceFlags;

  return (
    <div className="space-y-6">
      <NonFreezeNotice />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Active Participations"
          value={summary?.activeParticipations ?? "—"}
          icon={Users}
          accent="bg-emerald-500/15"
        />
        <KpiCard
          label="Disputed"
          value={summary?.disputedParticipations ?? "—"}
          icon={Scale}
          accent={
            (summary?.disputedParticipations ?? 0) > 0
              ? "bg-amber-500/20"
              : "bg-gray-700"
          }
        />
        <KpiCard
          label="Pending OTP"
          value={summary?.pendingOtpCount ?? "—"}
          icon={KeyRound}
          accent={
            (summary?.pendingOtpCount ?? 0) > 0
              ? "bg-yellow-500/20"
              : "bg-gray-700"
          }
        />
        <KpiCard
          label="Accumulated (Disputed)"
          value={fmt(summary?.totalAccumulatedAmount)}
          icon={Banknote}
          accent={
            (summary?.totalAccumulatedAmount ?? 0) > 0
              ? "bg-orange-500/20"
              : "bg-gray-700"
          }
        />
      </div>

      {/* Governance flags */}
      {flags && (flags.hasDisputedClaimants || flags.hasPendingOtp || flags.hasAccumulatedFunds) && (
        <div className="space-y-2">
          {flags.hasDisputedClaimants && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-300">
                <strong>Disputed claimants</strong> — some claimant shares are under dispute. Accumulation ledger is active.
              </span>
            </div>
          )}
          {flags.hasPendingOtp && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <KeyRound className="h-4 w-4 text-yellow-400 shrink-0" />
              <span className="text-sm text-yellow-300">
                <strong>OTP pending</strong> — claimant contributions are awaiting developer verification.
              </span>
            </div>
          )}
          {flags.hasAccumulatedFunds && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <Banknote className="h-4 w-4 text-orange-400 shrink-0" />
              <span className="text-sm text-orange-300">
                <strong>Funds accumulated</strong> — {fmt(summary?.totalAccumulatedAmount)} is held in the dispute accumulation ledger pending resolution.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Pending OTP quick-view */}
      {(data?.pendingOtpContributions?.length ?? 0) > 0 && (
        <Card className="bg-gray-800/60 border-yellow-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-yellow-400 flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Contributions Awaiting OTP Verification
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700">
                  <TableHead className="text-gray-400 text-xs">Claimant</TableHead>
                  <TableHead className="text-gray-400 text-xs">Project</TableHead>
                  <TableHead className="text-gray-400 text-xs">Period</TableHead>
                  <TableHead className="text-gray-400 text-xs text-right">Amount</TableHead>
                  <TableHead className="text-gray-400 text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.pendingOtpContributions.map((c) => (
                  <TableRow key={c.id} className="border-gray-700/50">
                    <TableCell className="text-sm text-gray-200">
                      {(c as any).claimantName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {(c as any).projectName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-300">{c.periodLabel}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-gray-200">
                      {fmt(c.amount)}
                    </TableCell>
                    <TableCell>
                      <ContributionStatusBadge status={c.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 2 — PARTICIPATION TRACKER
// ══════════════════════════════════════════════════════════════════════════

function ParticipationTab({
  projectId,
  canAdmin,
}: {
  projectId: string | null;
  canAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [editRecord, setEditRecord] = useState<ClaimantParticipationRecord | null>(null);

  const { data: participationsData, isLoading } = useListClaimantParticipations(
    { ...(projectId ? { projectId } : {}), ...(statusFilter !== "__all__" ? { status: statusFilter } : {}) },
  );
  const { data: claimsData } = useListInheritanceClaims({});
  const { data: projectsData } = useListProjects();
  const { data: partnersData } = useListPartners(projectId ? { projectId } : undefined);

  const createMut = useCreateClaimantParticipation();
  const updateMut = useUpdateClaimantParticipation();
  const deleteMut = useDeleteClaimantParticipation();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListClaimantParticipationsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPrematuritySuccessionDashboardQueryKey() });
  };

  // Add dialog state
  const [addForm, setAddForm] = useState({
    claimId: "",
    claimantId: "",
    projectId: projectId ?? "",
    partnerId: "",
    inheritedSharePct: "",
    isContributing: false,
    notes: "",
  });

  const claims = (claimsData as any)?.claims ?? [];
  const projects = (projectsData as any)?.projects ?? [];
  const partners = (partnersData as any)?.partners ?? [];
  const participations: ClaimantParticipationRecord[] = (participationsData as any)?.participations ?? [];

  const handleAdd = async () => {
    if (!addForm.claimId || !addForm.claimantId || !addForm.projectId || !addForm.partnerId) return;
    await createMut.mutateAsync({
      data: {
        claimId: addForm.claimId,
        claimantId: addForm.claimantId,
        projectId: addForm.projectId,
        partnerId: addForm.partnerId,
        inheritedSharePct: addForm.inheritedSharePct ? parseFloat(addForm.inheritedSharePct) : undefined,
        isContributing: addForm.isContributing,
        notes: addForm.notes || undefined,
      },
    });
    invalidate();
    setAddOpen(false);
    setAddForm({ claimId: "", claimantId: "", projectId: projectId ?? "", partnerId: "", inheritedSharePct: "", isContributing: false, notes: "" });
  };

  const handleStatusChange = async (rec: ClaimantParticipationRecord, status: string) => {
    await updateMut.mutateAsync({ id: rec.id, data: { participationStatus: status as any } });
    invalidate();
  };

  const handleToggleContributing = async (rec: ClaimantParticipationRecord) => {
    await updateMut.mutateAsync({ id: rec.id, data: { isContributing: !rec.isContributing } });
    invalidate();
  };

  const handleDelete = async (rec: ClaimantParticipationRecord) => {
    if (!confirm(`Deactivate participation for claimant ${(rec as any).claimantName ?? rec.claimantId}?`)) return;
    await deleteMut.mutateAsync({ id: rec.id });
    invalidate();
  };

  // Find claimants for selected claim
  const selectedClaim = claims.find((c: any) => c.id === addForm.claimId);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 bg-gray-800 border-gray-600 text-gray-200 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent className="bg-gray-800 border-gray-700">
              <SelectItem value="__all__">All</SelectItem>
              {["active", "disputed", "suspended", "resolved", "withdrawn"].map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canAdmin && (
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Activate Claimant
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : participations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <Users className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No participation records yet.</p>
          {canAdmin && (
            <p className="text-xs mt-1 text-gray-600">
              Activate claimants from existing death-type inheritance claims.
            </p>
          )}
        </div>
      ) : (
        <Card className="bg-gray-800/60 border-gray-700/50">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700">
                  <TableHead className="text-gray-400 text-xs">Claimant</TableHead>
                  <TableHead className="text-gray-400 text-xs">Project</TableHead>
                  <TableHead className="text-gray-400 text-xs">Partner</TableHead>
                  <TableHead className="text-gray-400 text-xs">Share %</TableHead>
                  <TableHead className="text-gray-400 text-xs">Contributing</TableHead>
                  <TableHead className="text-gray-400 text-xs">Status</TableHead>
                  <TableHead className="text-gray-400 text-xs">Since</TableHead>
                  {canAdmin && <TableHead className="text-gray-400 text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {participations.map((rec) => (
                  <TableRow key={rec.id} className="border-gray-700/50">
                    <TableCell className="text-sm text-gray-200 font-medium">
                      {(rec as any).claimantName ?? rec.claimantId.slice(0, 8)}
                      {(rec as any).relationship && (
                        <span className="text-gray-500 text-xs ml-1">({(rec as any).relationship})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {(rec as any).projectName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {(rec as any).partnerName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-gray-300">
                      {rec.inheritedSharePct ? `${parseFloat(rec.inheritedSharePct).toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell>
                      {rec.isContributing ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Yes
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">No</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ParticipationBadge status={rec.participationStatus} />
                    </TableCell>
                    <TableCell className="text-xs text-gray-500">{fmtDate(rec.createdAt)}</TableCell>
                    {canAdmin && (
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-sky-400 hover:text-sky-300"
                            onClick={() => handleToggleContributing(rec)}
                          >
                            {rec.isContributing ? "Pause" : "Activate"}
                          </Button>
                          {rec.participationStatus === "active" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                              onClick={() => handleStatusChange(rec, "disputed")}
                            >
                              Dispute
                            </Button>
                          )}
                          {rec.participationStatus === "disputed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                              onClick={() => handleStatusChange(rec, "resolved")}
                            >
                              Resolve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                            onClick={() => handleDelete(rec)}
                          >
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add Participation Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-gray-100 text-base">Activate Claimant Participation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <Info className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-300/80">
                Only death-type inheritance claims are eligible for prematurity succession. The claimant will continue the deceased partner's participation position independently.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-gray-300 text-xs">Death Claim</Label>
                <Select value={addForm.claimId} onValueChange={(v) => setAddForm((f) => ({ ...f, claimId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Select inheritance claim…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {claims.filter((c: any) => c.claimType === "death").map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.id.slice(0, 8)} — {c.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-gray-300 text-xs">Project</Label>
                <Select value={addForm.projectId} onValueChange={(v) => setAddForm((f) => ({ ...f, projectId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Select project…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Deceased Partner</Label>
                <Select value={addForm.partnerId} onValueChange={(v) => setAddForm((f) => ({ ...f, partnerId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {partners.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Claimant ID</Label>
                <Input
                  value={addForm.claimantId}
                  onChange={(e) => setAddForm((f) => ({ ...f, claimantId: e.target.value }))}
                  placeholder="Claimant UUID"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Inherited Share %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={addForm.inheritedSharePct}
                  onChange={(e) => setAddForm((f) => ({ ...f, inheritedSharePct: e.target.value }))}
                  placeholder="e.g. 50"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
              <div className="flex items-center gap-2 pt-4">
                <input
                  type="checkbox"
                  id="isContrib"
                  checked={addForm.isContributing}
                  onChange={(e) => setAddForm((f) => ({ ...f, isContributing: e.target.checked }))}
                  className="w-4 h-4 accent-sky-500"
                />
                <Label htmlFor="isContrib" className="text-gray-300 text-xs cursor-pointer">
                  Activate contributions now
                </Label>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-gray-300 text-xs">Notes</Label>
                <Textarea
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm resize-none"
                  rows={2}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} className="text-gray-400">
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMut.isPending || !addForm.claimId || !addForm.claimantId || !addForm.projectId || !addForm.partnerId}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {createMut.isPending ? "Activating…" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 3 — OTP QUEUE (Contribution verification)
// ══════════════════════════════════════════════════════════════════════════

function OtpQueueTab({
  projectId,
  canAdmin,
}: {
  projectId: string | null;
  canAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [otpDialogContrib, setOtpDialogContrib] = useState<ClaimantContribution | null>(null);
  const [verifyDialogContrib, setVerifyDialogContrib] = useState<ClaimantContribution | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("__all__");

  const { data: participationsData } = useListClaimantParticipations(
    projectId ? { projectId } : {},
  );
  const participations: ClaimantParticipationRecord[] = (participationsData as any)?.participations ?? [];

  const { data: contribData, isLoading } = useListClaimantContributions({
    ...(projectId ? { projectId } : {}),
    ...(statusFilter !== "__all__" ? { status: statusFilter } : {}),
  });

  const createMut = useCreateClaimantContribution();
  const requestOtpMut = useRequestContributionOtp();
  const verifyOtpMut = useVerifyContributionOtp();
  const updateMut = useUpdateClaimantContribution();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListClaimantContributionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPrematuritySuccessionDashboardQueryKey() });
  };

  const [addForm, setAddForm] = useState({
    participationRecordId: "",
    claimantId: "",
    projectId: projectId ?? "",
    claimId: "",
    periodLabel: "",
    amount: "",
    contributionType: "cash",
    description: "",
  });

  const contributions: ClaimantContribution[] = (contribData as any)?.contributions ?? [];

  const handleAdd = async () => {
    if (!addForm.participationRecordId || !addForm.periodLabel || !addForm.amount) return;
    const rec = participations.find((p) => p.id === addForm.participationRecordId);
    await createMut.mutateAsync({
      data: {
        participationRecordId: addForm.participationRecordId,
        claimantId: rec?.claimantId ?? addForm.claimantId,
        projectId: rec?.projectId ?? addForm.projectId,
        claimId: rec?.claimId ?? addForm.claimId,
        periodLabel: addForm.periodLabel,
        amount: parseFloat(addForm.amount),
        contributionType: addForm.contributionType as any,
        description: addForm.description || undefined,
      },
    });
    invalidate();
    setAddOpen(false);
  };

  const handleRequestOtp = async (contrib: ClaimantContribution) => {
    const res = await requestOtpMut.mutateAsync({ id: contrib.id });
    setGeneratedOtp((res as any).otp ?? null);
    setOtpDialogContrib({ ...(res as any).contribution });
    invalidate();
  };

  const handleVerifyOtp = async () => {
    if (!verifyDialogContrib || !otpInput.trim()) return;
    await verifyOtpMut.mutateAsync({ id: verifyDialogContrib.id, data: { otpCode: otpInput.trim() } });
    setVerifyDialogContrib(null);
    setOtpInput("");
    invalidate();
  };

  const handleReject = async (contrib: ClaimantContribution) => {
    const reason = prompt("Rejection reason:");
    if (reason === null) return;
    await updateMut.mutateAsync({ id: contrib.id, data: { status: "rejected", rejectionReason: reason } });
    invalidate();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-gray-800 border-gray-600 text-gray-200 text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="__all__">All</SelectItem>
            {["pending_otp", "otp_sent", "confirmed", "rejected"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canAdmin && (
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Record Contribution
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : contributions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <KeyRound className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No contributions recorded yet.</p>
        </div>
      ) : (
        <Card className="bg-gray-800/60 border-gray-700/50">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700">
                  <TableHead className="text-gray-400 text-xs">Claimant</TableHead>
                  <TableHead className="text-gray-400 text-xs">Project</TableHead>
                  <TableHead className="text-gray-400 text-xs">Period</TableHead>
                  <TableHead className="text-gray-400 text-xs">Type</TableHead>
                  <TableHead className="text-gray-400 text-xs text-right">Amount</TableHead>
                  <TableHead className="text-gray-400 text-xs">Status</TableHead>
                  <TableHead className="text-gray-400 text-xs">Submitted</TableHead>
                  {canAdmin && <TableHead className="text-gray-400 text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((c) => (
                  <TableRow key={c.id} className="border-gray-700/50">
                    <TableCell className="text-sm text-gray-200">
                      {(c as any).claimantName ?? c.claimantId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {(c as any).projectName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-300">{c.periodLabel}</TableCell>
                    <TableCell className="text-xs text-gray-400 capitalize">{c.contributionType}</TableCell>
                    <TableCell className="text-sm text-right font-mono text-gray-200">
                      {fmt(c.amount)}
                    </TableCell>
                    <TableCell><ContributionStatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-xs text-gray-500">{fmtDate(c.createdAt)}</TableCell>
                    {canAdmin && (
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {c.status === "pending_otp" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-sky-400 hover:text-sky-300"
                              onClick={() => handleRequestOtp(c)}
                              disabled={requestOtpMut.isPending}
                            >
                              <KeyRound className="h-3 w-3 mr-1" /> Gen OTP
                            </Button>
                          )}
                          {c.status === "otp_sent" && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                                onClick={() => { setVerifyDialogContrib(c); setOtpInput(""); }}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Verify
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                                onClick={() => handleRequestOtp(c)}
                                disabled={requestOtpMut.isPending}
                              >
                                <RefreshCw className="h-3 w-3 mr-1" /> Resend
                              </Button>
                            </>
                          )}
                          {["pending_otp", "otp_sent"].includes(c.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                              onClick={() => handleReject(c)}
                            >
                              Reject
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* OTP Generated dialog */}
      <Dialog open={!!otpDialogContrib && !verifyDialogContrib} onOpenChange={() => { setOtpDialogContrib(null); setGeneratedOtp(null); }}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-gray-100 text-base flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-yellow-400" /> OTP Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-400">
              Share this 6-digit OTP with the claimant out-of-band (phone, in-person). Once they confirm, return here to verify.
            </p>
            {generatedOtp && (
              <div className="flex items-center justify-center">
                <span className="text-3xl font-mono font-bold tracking-widest text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-6 py-3">
                  {generatedOtp}
                </span>
              </div>
            )}
            <p className="text-xs text-gray-500 text-center">
              For: {(otpDialogContrib as any)?.claimantName ?? "claimant"} · {otpDialogContrib?.periodLabel} · {fmt(otpDialogContrib?.amount)}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => { setOtpDialogContrib(null); setGeneratedOtp(null); }} className="bg-sky-600 hover:bg-sky-700 text-white w-full">
              Done — I've shared the OTP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verify OTP dialog */}
      <Dialog open={!!verifyDialogContrib} onOpenChange={() => { setVerifyDialogContrib(null); setOtpInput(""); }}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-gray-100 text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Verify OTP
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-400">
              Enter the 6-digit OTP provided by the claimant to confirm their contribution.
            </p>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">OTP Code</Label>
              <Input
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                placeholder="6-digit OTP"
                maxLength={6}
                className="bg-gray-800 border-gray-600 text-gray-200 text-center text-xl font-mono tracking-widest"
              />
            </div>
            <p className="text-xs text-gray-500">
              Contribution: {(verifyDialogContrib as any)?.claimantName ?? "—"} · {verifyDialogContrib?.periodLabel} · {fmt(verifyDialogContrib?.amount)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setVerifyDialogContrib(null); setOtpInput(""); }} className="text-gray-400">
              Cancel
            </Button>
            <Button
              onClick={handleVerifyOtp}
              disabled={otpInput.length !== 6 || verifyOtpMut.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {verifyOtpMut.isPending ? "Verifying…" : "Confirm Contribution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Contribution Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-gray-100 text-base">Record Claimant Contribution</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-gray-300 text-xs">Participation Record</Label>
                <Select
                  value={addForm.participationRecordId}
                  onValueChange={(v) => setAddForm((f) => ({ ...f, participationRecordId: v }))}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Select claimant participation…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {participations.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {(p as any).claimantName ?? p.claimantId.slice(0, 8)} — {(p as any).projectName ?? ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Period</Label>
                <Input
                  value={addForm.periodLabel}
                  onChange={(e) => setAddForm((f) => ({ ...f, periodLabel: e.target.value }))}
                  placeholder="e.g. FY 2024-25 Q1"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Amount (₹)</Label>
                <Input
                  type="number"
                  value={addForm.amount}
                  onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Type</Label>
                <Select value={addForm.contributionType} onValueChange={(v) => setAddForm((f) => ({ ...f, contributionType: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="in_kind">In-Kind</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Description</Label>
                <Input
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} className="text-gray-400">
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={createMut.isPending || !addForm.participationRecordId || !addForm.periodLabel || !addForm.amount}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {createMut.isPending ? "Saving…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 4 — DISPUTED ACCUMULATION LEDGER
// ══════════════════════════════════════════════════════════════════════════

function AccumulationTab({
  projectId,
  canAdmin,
}: {
  projectId: string | null;
  canAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [releaseEntry, setReleaseEntry] = useState<DisputedAccumulationEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState("__all__");

  const { data: accumData, isLoading } = useListDisputedAccumulation({
    ...(projectId ? { projectId } : {}),
    ...(statusFilter !== "__all__" ? { status: statusFilter } : {}),
  });

  const { data: participationsData } = useListClaimantParticipations(
    projectId ? { projectId } : {},
  );
  const { data: claimsData } = useListInheritanceClaims({});
  const { data: projectsData } = useListProjects();

  const createMut = useCreateDisputedAccumulationEntry();
  const updateMut = useUpdateDisputedAccumulationEntry();
  const releaseMut = useReleaseAccumulationEntry();
  const forfeitMut = useForfeitAccumulationEntry();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListDisputedAccumulationQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPrematuritySuccessionDashboardQueryKey() });
  };

  const entries: DisputedAccumulationEntry[] = (accumData as any)?.entries ?? [];
  const totalAccumulating: number = (accumData as any)?.totalAccumulatingAmount ?? 0;
  const claims = (claimsData as any)?.claims ?? [];
  const projects = (projectsData as any)?.projects ?? [];
  const participations: ClaimantParticipationRecord[] = (participationsData as any)?.participations ?? [];

  const [addForm, setAddForm] = useState({
    claimId: "",
    projectId: projectId ?? "",
    claimantId: "",
    periodLabel: "",
    periodYear: "",
    amount: "",
    accumulationType: "other" as string,
    description: "",
  });

  const [releaseForm, setReleaseForm] = useState({
    releasedToClaimantId: "",
    releasedToClaimantName: "",
    releaseNotes: "",
  });

  const handleAdd = async () => {
    if (!addForm.claimId || !addForm.projectId || !addForm.periodLabel || !addForm.amount) return;
    await createMut.mutateAsync({
      data: {
        claimId: addForm.claimId,
        projectId: addForm.projectId,
        claimantId: addForm.claimantId || undefined,
        periodLabel: addForm.periodLabel,
        periodYear: addForm.periodYear ? parseInt(addForm.periodYear) : undefined,
        amount: parseFloat(addForm.amount),
        accumulationType: addForm.accumulationType as any,
        description: addForm.description || undefined,
      },
    });
    invalidate();
    setAddOpen(false);
  };

  const handleRelease = async () => {
    if (!releaseEntry) return;
    await releaseMut.mutateAsync({
      id: releaseEntry.id,
      data: {
        releasedToClaimantId: releaseForm.releasedToClaimantId || undefined,
        releasedToClaimantName: releaseForm.releasedToClaimantName || undefined,
        releaseNotes: releaseForm.releaseNotes || undefined,
      },
    });
    setReleaseEntry(null);
    invalidate();
  };

  const handleForfeit = async (entry: DisputedAccumulationEntry) => {
    if (!confirm(`Forfeit ${fmt(entry.amount)} from ${entry.periodLabel}? This action records a court/council decision and cannot be undone.`)) return;
    await forfeitMut.mutateAsync({ id: entry.id, data: {} });
    invalidate();
  };

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      {totalAccumulating > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <Banknote className="h-5 w-5 text-orange-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-orange-300">
              {fmt(totalAccumulating)} currently held in accumulation
            </p>
            <p className="text-xs text-orange-400/70">
              These funds are held pending claimant dispute resolution. Project operations continue normally.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-gray-800 border-gray-600 text-gray-200 text-sm">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700">
            <SelectItem value="__all__">All</SelectItem>
            {["accumulating", "released", "forfeited"].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canAdmin && (
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Entry
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <Scale className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">No accumulation entries.</p>
          <p className="text-xs mt-1 text-gray-600">
            Entries are created when disputed claimants have amounts that need to be held until resolution.
          </p>
        </div>
      ) : (
        <Card className="bg-gray-800/60 border-gray-700/50">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-700">
                  <TableHead className="text-gray-400 text-xs">Claimant</TableHead>
                  <TableHead className="text-gray-400 text-xs">Project</TableHead>
                  <TableHead className="text-gray-400 text-xs">Period</TableHead>
                  <TableHead className="text-gray-400 text-xs">Type</TableHead>
                  <TableHead className="text-gray-400 text-xs text-right">Amount</TableHead>
                  <TableHead className="text-gray-400 text-xs">Status</TableHead>
                  <TableHead className="text-gray-400 text-xs">Released To</TableHead>
                  {canAdmin && <TableHead className="text-gray-400 text-xs">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id} className="border-gray-700/50">
                    <TableCell className="text-sm text-gray-200">
                      {(e as any).claimantName ?? "Pool"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {(e as any).projectName ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-300">{e.periodLabel}</TableCell>
                    <TableCell className="text-xs text-gray-400 capitalize">
                      {e.accumulationType.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono text-gray-200">
                      {fmt(e.amount)}
                    </TableCell>
                    <TableCell><AccumulationBadge status={e.status} /></TableCell>
                    <TableCell className="text-sm text-gray-400">
                      {e.releasedToClaimantName ?? (e.status === "forfeited" ? "Forfeited" : "—")}
                    </TableCell>
                    {canAdmin && (
                      <TableCell>
                        {e.status === "accumulating" && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300"
                              onClick={() => {
                                setReleaseEntry(e);
                                setReleaseForm({ releasedToClaimantId: "", releasedToClaimantName: "", releaseNotes: "" });
                              }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Release
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                              onClick={() => handleForfeit(e)}
                            >
                              <Ban className="h-3 w-3 mr-1" /> Forfeit
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Release Dialog */}
      <Dialog open={!!releaseEntry} onOpenChange={() => setReleaseEntry(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-gray-100 text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Release Accumulated Amount
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {releaseEntry && (
              <div className="rounded-lg bg-gray-800/80 border border-gray-700 p-3 space-y-1">
                <p className="text-xs text-gray-400">Amount: <span className="text-gray-200 font-mono font-semibold">{fmt(releaseEntry.amount)}</span></p>
                <p className="text-xs text-gray-400">Period: <span className="text-gray-300">{releaseEntry.periodLabel}</span></p>
                <p className="text-xs text-gray-400">Type: <span className="text-gray-300 capitalize">{releaseEntry.accumulationType.replace(/_/g, " ")}</span></p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Release to Claimant</Label>
              <Select value={releaseForm.releasedToClaimantId} onValueChange={(v) => {
                const part = participations.find((p) => p.claimantId === v);
                setReleaseForm((f) => ({ ...f, releasedToClaimantId: v, releasedToClaimantName: (part as any)?.claimantName ?? "" }));
              }}>
                <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                  <SelectValue placeholder="Select claimant…" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  {participations.map((p) => (
                    <SelectItem key={p.claimantId} value={p.claimantId}>
                      {(p as any).claimantName ?? p.claimantId.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-xs">Release Notes</Label>
              <Textarea
                value={releaseForm.releaseNotes}
                onChange={(e) => setReleaseForm((f) => ({ ...f, releaseNotes: e.target.value }))}
                placeholder="Reason for release, council decision reference…"
                className="bg-gray-800 border-gray-600 text-gray-200 text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReleaseEntry(null)} className="text-gray-400">Cancel</Button>
            <Button
              onClick={handleRelease}
              disabled={releaseMut.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {releaseMut.isPending ? "Releasing…" : "Confirm Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Entry Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-gray-100 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-gray-100 text-base">Add Accumulation Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Claim</Label>
                <Select value={addForm.claimId} onValueChange={(v) => setAddForm((f) => ({ ...f, claimId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Select claim…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {claims.filter((c: any) => c.claimType === "death").map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.id.slice(0, 8)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Project</Label>
                <Select value={addForm.projectId} onValueChange={(v) => setAddForm((f) => ({ ...f, projectId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Select project…" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Claimant (optional)</Label>
                <Select value={addForm.claimantId} onValueChange={(v) => setAddForm((f) => ({ ...f, claimantId: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue placeholder="Shared pool if blank" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {participations.map((p) => (
                      <SelectItem key={p.claimantId} value={p.claimantId}>
                        {(p as any).claimantName ?? p.claimantId.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Type</Label>
                <Select value={addForm.accumulationType} onValueChange={(v) => setAddForm((f) => ({ ...f, accumulationType: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-gray-200 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="contribution">Contribution</SelectItem>
                    <SelectItem value="revenue_entitlement">Revenue Entitlement</SelectItem>
                    <SelectItem value="lca_credit">LCA Credit</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Period</Label>
                <Input
                  value={addForm.periodLabel}
                  onChange={(e) => setAddForm((f) => ({ ...f, periodLabel: e.target.value }))}
                  placeholder="e.g. FY 2024-25"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Amount (₹)</Label>
                <Input
                  type="number"
                  value={addForm.amount}
                  onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-gray-300 text-xs">Description</Label>
                <Input
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional"
                  className="bg-gray-800 border-gray-600 text-gray-200 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} className="text-gray-400">Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={createMut.isPending || !addForm.claimId || !addForm.projectId || !addForm.periodLabel || !addForm.amount}
              className="bg-sky-600 hover:bg-sky-700 text-white"
            >
              {createMut.isPending ? "Saving…" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROOT PAGE
// ══════════════════════════════════════════════════════════════════════════

export default function PrematuritySuccession() {
  const { role } = useRole();
  const { selectedProjectId } = useProjectFilter();
  const canAdmin = role === "admin" || role === "developer";
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/15 p-2.5">
            <Sprout className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">
              Prematurity Death Succession
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Claimant participation continuation during pre-maturity inheritance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5">
          <CircleDot className="h-3 w-3 text-emerald-400" />
          <span className="text-xs text-emerald-400 font-medium">Project Active</span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-gray-800/60 border border-gray-700/50">
          <TabsTrigger value="dashboard" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 text-sm">
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="participations" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 text-sm">
            Participation
          </TabsTrigger>
          <TabsTrigger value="otp" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 text-sm">
            OTP Queue
          </TabsTrigger>
          <TabsTrigger value="accumulation" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 text-sm">
            Accumulation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <DashboardTab projectId={selectedProjectId} canAdmin={canAdmin} />
        </TabsContent>
        <TabsContent value="participations" className="mt-6">
          <ParticipationTab projectId={selectedProjectId} canAdmin={canAdmin} />
        </TabsContent>
        <TabsContent value="otp" className="mt-6">
          <OtpQueueTab projectId={selectedProjectId} canAdmin={canAdmin} />
        </TabsContent>
        <TabsContent value="accumulation" className="mt-6">
          <AccumulationTab projectId={selectedProjectId} canAdmin={canAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
