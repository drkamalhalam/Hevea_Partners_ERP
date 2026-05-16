import { useMemo } from "react";
import { Link } from "wouter";
import {
  useListProjects,
  useDeleteProject,
  getListProjectsQueryKey,
  useGetGovernanceSummary,
  useGetProjectCardSummaries,
  useListOnboardingParticipants,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { GovernanceStatusBadge } from "@/components/governance";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, MapPin, Trees, Trash2, Hash, Layers, Users, Package,
  FileText, AlertTriangle, ChevronRight, Lock, Leaf, Wallet,
  Activity, Scale, BarChart3, AlertCircle, TrendingUp, ShieldX, Wrench,
  Boxes, Factory, ShoppingCart, Banknote, ClipboardList,
  CheckCircle2, Clock, XCircle, CreditCard, Target,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  missing_developer: "bg-orange-100 text-orange-800",
  developing: "bg-amber-100 text-amber-800",
  maturing: "bg-emerald-100 text-emerald-800",
  tapping: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-600",
  suspended: "bg-red-100 text-red-800",
};

const ACTIVATION_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  suspended: "bg-red-100 text-red-800 border-red-200",
  closed: "bg-gray-100 text-gray-600 border-gray-200",
  ready_for_activation: "bg-lime-100 text-lime-800 border-lime-200",
  pending_verification: "bg-amber-100 text-amber-800 border-amber-200",
  pending_agreement: "bg-amber-100 text-amber-800 border-amber-200",
  pending_participant_confirmation: "bg-amber-100 text-amber-800 border-amber-200",
  pending_land_verification: "bg-amber-100 text-amber-800 border-amber-200",
};

const ACTIVATION_LABELS: Record<string, string> = {
  active: "Active",
  draft: "Draft",
  suspended: "Suspended",
  closed: "Closed",
  ready_for_activation: "Ready to Activate",
  pending_verification: "Pending Verification",
  pending_agreement: "Pending Agreement",
  pending_participant_confirmation: "Pending Confirmation",
  pending_land_verification: "Pending Land Verification",
};

const MODEL_COLORS: Record<string, string> = {
  ownership_contribution: "bg-violet-100 text-violet-800 border-violet-200",
  fifty_percent_revenue: "bg-sky-100 text-sky-800 border-sky-200",
};

const MODEL_LABELS: Record<string, string> = {
  ownership_contribution: "Contribution Model",
  fifty_percent_revenue: "50% Revenue Model",
};

const ALERT_ICON: Record<string, React.ReactNode> = {
  attention_required: <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />,
  incomplete: <AlertCircle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />,
  pending: <AlertCircle className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />,
};

// ── Utility Formatters ────────────────────────────────────────────────────────

function fmtNum(n: unknown): string {
  if (n == null || n === "") return "—";
  const num = Number(n);
  if (isNaN(num)) return "—";
  return num.toLocaleString("en-IN");
}

function fmtRupees(n: unknown): string {
  if (n == null || n === "" || Number(n) === 0) return "—";
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function fmtKg(n: number): string {
  if (n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

// ── Small UI primitives ───────────────────────────────────────────────────────

function SectionHead({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ElementType;
  label: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center justify-between py-0.5">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      {href && (
        <ChevronRight className="h-3 w-3 text-muted-foreground/50 group-hover/section:text-primary transition-colors" />
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href}>
        <div className="group/section -mx-1 px-1 rounded hover:bg-muted/50 transition-colors cursor-pointer">
          {inner}
        </div>
      </Link>
    );
  }
  return inner;
}

function DataRow({
  label,
  value,
  href,
  span2 = false,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  span2?: boolean;
}) {
  const row = (
    <div className={`flex justify-between items-center min-h-[1.4rem] ${span2 ? "col-span-2" : ""}`}>
      <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
      <span className="text-[11px] font-medium text-right ml-2 leading-tight">{value ?? "—"}</span>
    </div>
  );
  if (href) {
    return (
      <Link href={href}>
        <div className="group/row -mx-1 px-1 rounded hover:bg-muted/40 transition-colors cursor-pointer">
          {row}
        </div>
      </Link>
    );
  }
  return row;
}

// ── Per-project card ──────────────────────────────────────────────────────────

type CardSummary = {
  projectId: string;
  rubberSheetBalanceKg: number;
  rubberScrapBalanceKg: number;
  latexBalanceLitres: number;
  pendingStockCount: number;
  collectionEntryCount: number;
  collectionSheetCount: number;
  storeEntryCount: number;
  storeSheetCount: number;
  storeWeightKg: number;
  confirmedSaleCount: number;
  draftSaleCount: number;
  totalGrossRevenue?: number | null;
  totalNetRevenue?: number | null;
  lcaOutstandingBalance?: number | null;
  lcaOutstandingCount: number;
  distributionPendingAmount?: number | null;
  distributionPendingCount: number;
  kycParticipantCount: number;
  agreementCount: number;
  latestAgreementStatus?: string | null;
  // Contribution intelligence
  contributionTotal: number;
  contributionVerified: number;
  contributionOwnershipEligible: number;
  contributionPendingCount: number;
  contributionDisputedCount: number;
  contributorCount: number;
  // Recoverable advances
  advancesTotalOutstanding: number;
  advancesPendingCount: number;
  // LCA configuration
  lcaIsConfigured: boolean;
  // Participant role breakdown
  participantLandownerCount: number;
  participantDeveloperCount: number;
  participantInvestorCount: number;
  participantOtherCount: number;
};

function ProjectGovernanceCard({
  project,
  govAlerts,
  cardSummary,
  onDelete,
  canAccessAllProjects,
}: {
  project: any;
  govAlerts: any;
  cardSummary: CardSummary | undefined;
  onDelete: () => void;
  canAccessAllProjects: boolean;
}) {
  // Per-card lightweight fetch — developer + landowner KYC names
  const { data: participantData } = useListOnboardingParticipants(project.id);
  const participants: any[] = (participantData as any)?.participants ?? [];
  const developer = participants.find((p) => p.role === "developer");
  const landowner = participants.find((p) => p.role === "landowner");

  const isOwnership = project.commercialModel === "ownership_contribution";
  const issues: any[] = govAlerts?.issues ?? [];
  const worstStatus: string = govAlerts?.status ?? "complete";

  const isLocked = project.governanceLocked === true;
  const isMissingLandowner =
    project.landownerValidationStatus === "MISSING" ||
    project.invalidReason === "MISSING_LANDOWNER";

  const s = cardSummary;

  // Derived booleans for conditional rendering
  const hasInventory =
    s && (s.rubberSheetBalanceKg > 0 || s.rubberScrapBalanceKg > 0 || s.latexBalanceLitres > 0);
  const hasOperations = s && (s.collectionEntryCount > 0 || s.storeEntryCount > 0);
  const hasSalesActivity = s && s.confirmedSaleCount > 0;
  const hasLcaOutstanding = s && (s.lcaOutstandingCount > 0);
  const hasDistPending = s && s.distributionPendingCount > 0;
  const hasFinanceSection = (hasLcaOutstanding || hasDistPending) && isOwnership;

  return (
    <Card
      data-testid={`card-project-${project.id}`}
      className={`flex flex-col border transition-all duration-200 ${isLocked ? "border-red-200 bg-red-50/30 hover:shadow-md" : "hover:shadow-lg"}`}
    >
      {/* ── Governance Lock Banner ────────────────────────────────────────── */}
      {isLocked && (
        <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <ShieldX className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-red-800 uppercase tracking-wide">
                Invalid Configuration — Operational Access Blocked
              </p>
              <p className="text-[11px] text-red-700 mt-0.5">
                {isMissingLandowner
                  ? "Missing Mandatory Landowner. At least one verified landowner with full KYC must be linked before this project can operate."
                  : `Configuration issue: ${project.invalidReason ?? "Unknown"}.`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── §1 Identity ─────────────────────────────────────────────────── */}
      <CardHeader className="px-4 pt-4 pb-3">
        <Link href={`/projects/${project.id}`}>
          <div className="group/identity cursor-pointer space-y-1.5">
            {/* Name + status badges */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-serif font-bold text-base leading-tight line-clamp-2 group-hover/identity:text-primary transition-colors">
                  {project.name}
                </h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {project.projectCode && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <Hash className="h-2.5 w-2.5" />
                      {project.projectCode}
                    </span>
                  )}
                  {project.village && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                      <MapPin className="h-2.5 w-2.5" />
                      {project.village}
                      {project.district ? `, ${project.district}` : ""}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${ACTIVATION_COLORS[project.activationStatus] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
                >
                  {ACTIVATION_LABELS[project.activationStatus] ?? project.activationStatus}
                </span>
                {project.ownershipFrozenAt && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-semibold bg-red-100 text-red-800 border-red-200">
                    <Lock className="h-2.5 w-2.5" /> Frozen
                  </span>
                )}
                {canAccessAllProjects && govAlerts && (
                  <GovernanceStatusBadge status={worstStatus as any} size="xs" />
                )}
              </div>
            </div>

            {/* Model + lifecycle phase row */}
            <div className="flex flex-wrap gap-1.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${MODEL_COLORS[project.commercialModel] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
              >
                <Layers className="h-2.5 w-2.5" />
                {MODEL_LABELS[project.commercialModel] ?? project.commercialModel}
              </span>
              {project.status && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[project.status] ?? "bg-gray-100 text-gray-600"}`}
                >
                  <Leaf className="h-2.5 w-2.5" />
                  {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                </span>
              )}
            </div>
          </div>
        </Link>
      </CardHeader>

      <CardContent className="px-4 pb-4 flex-1 flex flex-col gap-2.5">
        <Separator />

        {/* ── §2 Land & Location ────────────────────────────────────────── */}
        <div>
          <SectionHead icon={MapPin} label="Land & Location" href={`/projects/${project.id}`} />
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            <DataRow
              label="Area"
              value={
                project.landArea
                  ? `${project.landArea} ${project.landAreaUnit ?? ""}`
                  : undefined
              }
              href={`/projects/${project.id}`}
            />
            <DataRow
              label="Type"
              value={
                project.landType === "recorded"
                  ? "Recorded"
                  : project.landType === "non_recorded"
                    ? "Non-Recorded"
                    : undefined
              }
            />
            <DataRow label="District" value={project.district} />
            <DataRow
              label="Capacity"
              value={
                project.rubberCapacity
                  ? `${fmtNum(project.rubberCapacity)} ${project.rubberCapacityUnit ?? "trees"}`
                  : undefined
              }
            />
          </div>
          {project.landType === "recorded" &&
            (project.khatianNumber || project.plotNumber || project.mouja) && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {project.khatianNumber && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                    Khatian {project.khatianNumber}
                  </span>
                )}
                {project.plotNumber && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                    Plot {project.plotNumber}
                  </span>
                )}
                {project.mouja && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted border text-muted-foreground">
                    {project.mouja}
                  </span>
                )}
              </div>
            )}
        </div>

        <Separator />

        {/* ── §3 Participants ───────────────────────────────────────────── */}
        <div>
          <SectionHead icon={Users} label="Participants" href="/partners" />
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            <DataRow
              label="Developer"
              value={
                developer?.fullName ?? (
                  <span className="text-amber-600 italic">Not set</span>
                )
              }
              href="/partners"
            />
            <DataRow
              label="Landowner"
              value={
                landowner?.fullName ?? (
                  <span className="text-amber-600 italic">Not set</span>
                )
              }
              href="/partners"
            />
          </div>
          {/* Role breakdown chips */}
          {s && (s.participantDeveloperCount > 0 || s.participantLandownerCount > 0 || s.participantInvestorCount > 0) && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {s.participantDeveloperCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-700">
                  {s.participantDeveloperCount} Dev{s.participantDeveloperCount !== 1 ? "s" : ""}
                </span>
              )}
              {s.participantLandownerCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">
                  {s.participantLandownerCount} Landowner{s.participantLandownerCount !== 1 ? "s" : ""}
                </span>
              )}
              {s.participantInvestorCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700">
                  {s.participantInvestorCount} Investor{s.participantInvestorCount !== 1 ? "s" : ""}
                </span>
              )}
              {s.participantOtherCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500">
                  +{s.participantOtherCount} Other
                </span>
              )}
            </div>
          )}
        </div>

        <Separator />

        {/* ── §4 Financial Structure ────────────────────────────────────── */}
        <div>
          <SectionHead
            icon={Wallet}
            label={isOwnership ? "Financial Structure" : "Revenue Structure"}
            href={isOwnership ? "/contributions" : "/distribution"}
          />
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            {isOwnership ? (
              <>
                <DataRow
                  label="Land Notional"
                  value={fmtRupees(project.landNotionalValue)}
                  href="/contributions"
                />
                <DataRow
                  label="Value / Unit"
                  value={fmtRupees(project.landValuePerUnit)}
                  href="/contributions"
                />
                <DataRow
                  label="LCA Base"
                  value={project.lcaBaseAmount ? `${fmtRupees(project.lcaBaseAmount)}/yr` : undefined}
                  href="/lca/ledger"
                />
                <DataRow
                  label="LCA Escalation"
                  value={project.lcaEscalationPct ? `${project.lcaEscalationPct}%/yr` : undefined}
                  href="/lca/ledger"
                />
              </>
            ) : (
              <>
                <DataRow label="Split" value="50 / 50 Revenue" href="/distribution" />
                <DataRow label="LCA" value={<span className="text-muted-foreground italic">N/A</span>} />
                <DataRow
                  label="EP Pool"
                  value={<span className="text-sky-700">Active</span>}
                  href="/distribution"
                />
              </>
            )}
            <DataRow
              label="Term"
              value={
                project.agreementDurationYears
                  ? `${project.agreementDurationYears} yrs`
                  : project.termYears
                    ? `${project.termYears} yrs`
                    : undefined
              }
            />
          </div>
        </div>

        <Separator />

        {/* ── §4a Contribution Intelligence ─────────────────────────────── */}
        {isOwnership && (
          <>
            <Separator />
            <div>
              <SectionHead icon={TrendingUp} label="Contribution Intelligence" href="/contributions" />
              {s ? (
                <>
                  <div className="grid grid-cols-2 gap-x-3 mt-1">
                    <DataRow
                      label="Total Recorded"
                      value={
                        s.contributionTotal > 0 ? (
                          fmtRupees(s.contributionTotal)
                        ) : (
                          <span className="text-muted-foreground italic">None yet</span>
                        )
                      }
                      href="/contributions"
                    />
                    <DataRow
                      label="Verified"
                      value={
                        s.contributionVerified > 0 ? (
                          <span className="text-emerald-700 font-semibold">{fmtRupees(s.contributionVerified)}</span>
                        ) : (
                          <span className="text-muted-foreground">₹0</span>
                        )
                      }
                      href="/contributions"
                    />
                    {s.contributionOwnershipEligible > 0 && (
                      <DataRow
                        label="Ownership-Eligible"
                        value={
                          <span className="text-violet-700 font-semibold">{fmtRupees(s.contributionOwnershipEligible)}</span>
                        }
                        href="/contributions"
                        span2
                      />
                    )}
                    {s.contributorCount > 0 && (
                      <DataRow
                        label="Contributors"
                        value={`${s.contributorCount} partner${s.contributorCount !== 1 ? "s" : ""}`}
                        href="/contributions"
                      />
                    )}
                  </div>
                  {(s.contributionPendingCount > 0 || s.contributionDisputedCount > 0) && (
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {s.contributionPendingCount > 0 && (
                        <Link href="/contributions">
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700 cursor-pointer hover:bg-amber-100 transition-colors">
                            <Clock className="h-2.5 w-2.5" />
                            {s.contributionPendingCount} Pending Verification
                          </span>
                        </Link>
                      )}
                      {s.contributionDisputedCount > 0 && (
                        <Link href="/contributions">
                          <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border bg-red-50 border-red-200 text-red-700 cursor-pointer hover:bg-red-100 transition-colors">
                            <XCircle className="h-2.5 w-2.5" />
                            {s.contributionDisputedCount} Disputed
                          </span>
                        </Link>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-1 h-8 animate-pulse rounded bg-muted" />
              )}
            </div>
          </>
        )}

        {/* ── §4b Recoverable Advances ────────────────────────────────────── */}
        {s && (s.advancesTotalOutstanding > 0 || s.advancesPendingCount > 0) && (
          <>
            <Separator />
            <div>
              <SectionHead icon={CreditCard} label="Recoverable Advances" href="/recoverable-advances" />
              <div className="grid grid-cols-2 gap-x-3 mt-1">
                <DataRow
                  label="Outstanding"
                  value={
                    s.advancesTotalOutstanding > 0 ? (
                      <span className="text-orange-600 font-semibold">{fmtRupees(s.advancesTotalOutstanding)}</span>
                    ) : "₹0"
                  }
                  href="/recoverable-advances"
                  span2
                />
                {s.advancesPendingCount > 0 && (
                  <DataRow
                    label="Open Advances"
                    value={
                      <span className="text-amber-600">
                        {s.advancesPendingCount} advance{s.advancesPendingCount !== 1 ? "s" : ""}
                      </span>
                    }
                    href="/recoverable-advances"
                    span2
                  />
                )}
              </div>
            </div>
          </>
        )}

        {/* ── §5 Live Stock (Inventory Ledger) ──────────────────────────── */}
        <div>
          <SectionHead icon={Boxes} label="Current Stock" href="/inventory" />
          {s ? (
            <div className="grid grid-cols-3 gap-x-2 mt-1">
              <DataRow
                label="Sheet"
                value={
                  <span
                    className={
                      s.rubberSheetBalanceKg > 0
                        ? "text-emerald-700 font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {fmtKg(s.rubberSheetBalanceKg)}
                  </span>
                }
                href="/inventory"
              />
              <DataRow
                label="Scrap"
                value={
                  <span className={s.rubberScrapBalanceKg > 0 ? "text-emerald-700" : "text-muted-foreground"}>
                    {fmtKg(s.rubberScrapBalanceKg)}
                  </span>
                }
                href="/inventory"
              />
              <DataRow
                label="Latex"
                value={
                  <span className={s.latexBalanceLitres > 0 ? "text-emerald-700" : "text-muted-foreground"}>
                    {s.latexBalanceLitres > 0
                      ? `${s.latexBalanceLitres.toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`
                      : "0 L"}
                  </span>
                }
                href="/inventory"
              />
              {s.pendingStockCount > 0 && (
                <DataRow
                  label="Pending"
                  value={
                    <span className="text-amber-600">
                      {s.pendingStockCount} movement{s.pendingStockCount !== 1 ? "s" : ""}
                    </span>
                  }
                  href="/inventory"
                  span2
                />
              )}
            </div>
          ) : (
            <div className="mt-1 h-5 animate-pulse rounded bg-muted" />
          )}
        </div>

        {/* ── §6 Production Operations ──────────────────────────────────── */}
        {(hasOperations || (s && !hasInventory)) && (
          <>
            <Separator />
            <div>
              <SectionHead icon={Factory} label="Production Operations" href="/production-log" />
              <div className="grid grid-cols-2 gap-x-3 mt-1">
                {s ? (
                  <>
                    <DataRow
                      label="Collections"
                      value={
                        s.collectionEntryCount > 0
                          ? `${fmtNum(s.collectionEntryCount)} batches`
                          : <span className="text-muted-foreground italic">None</span>
                      }
                      href="/production-log"
                    />
                    <DataRow
                      label="Sheets Collected"
                      value={s.collectionSheetCount > 0 ? fmtNum(s.collectionSheetCount) : undefined}
                      href="/production-log"
                    />
                    <DataRow
                      label="Store Entries"
                      value={
                        s.storeEntryCount > 0
                          ? fmtNum(s.storeEntryCount)
                          : <span className="text-muted-foreground italic">None</span>
                      }
                      href="/inventory"
                    />
                    <DataRow
                      label="Stored Weight"
                      value={s.storeWeightKg > 0 ? fmtKg(s.storeWeightKg) : undefined}
                      href="/inventory"
                    />
                  </>
                ) : (
                  <div className="col-span-2 mt-1 h-8 animate-pulse rounded bg-muted" />
                )}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* ── §7 Sales ──────────────────────────────────────────────────── */}
        <div>
          <SectionHead icon={ShoppingCart} label="Sales" href="/sales" />
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            {s ? (
              <>
                <DataRow
                  label="Confirmed Sales"
                  value={
                    s.confirmedSaleCount > 0 ? (
                      <span className="text-emerald-700 font-semibold">{fmtNum(s.confirmedSaleCount)}</span>
                    ) : (
                      <span className="text-muted-foreground italic">None</span>
                    )
                  }
                  href="/sales"
                />
                <DataRow
                  label="Draft / Pending"
                  value={
                    s.draftSaleCount > 0 ? (
                      <span className="text-amber-600">{fmtNum(s.draftSaleCount)}</span>
                    ) : (
                      "0"
                    )
                  }
                  href="/sales"
                />
                {s.totalGrossRevenue != null && s.totalGrossRevenue > 0 && (
                  <DataRow
                    label="Gross Revenue"
                    value={fmtRupees(s.totalGrossRevenue)}
                    href="/sales"
                  />
                )}
                {s.totalNetRevenue != null && s.totalNetRevenue > 0 && (
                  <DataRow
                    label="Net Revenue"
                    value={
                      <span className="text-emerald-700 font-semibold">
                        {fmtRupees(s.totalNetRevenue)}
                      </span>
                    }
                    href="/sales"
                  />
                )}
              </>
            ) : (
              <div className="col-span-2 mt-1 h-8 animate-pulse rounded bg-muted" />
            )}
          </div>
        </div>

        {/* ── §8 Finance (LCA + Distribution) — ownership model only ────── */}
        {hasFinanceSection && (
          <>
            <Separator />
            <div>
              <SectionHead icon={Banknote} label="Finance Obligations" href="/lca/ledger" />
              <div className="grid grid-cols-2 gap-x-3 mt-1">
                {hasLcaOutstanding && s && (
                  <>
                    <DataRow
                      label="LCA Outstanding"
                      value={
                        s.lcaOutstandingBalance != null ? (
                          <span className="text-red-600 font-semibold">
                            {fmtRupees(s.lcaOutstandingBalance)}
                          </span>
                        ) : `${s.lcaOutstandingCount} yr${s.lcaOutstandingCount !== 1 ? "s" : ""}`
                      }
                      href="/lca/ledger"
                    />
                    <DataRow
                      label="Yrs Unpaid"
                      value={s.lcaOutstandingCount}
                      href="/lca/ledger"
                    />
                  </>
                )}
                {hasDistPending && s && (
                  <>
                    <DataRow
                      label="Dist. Pending"
                      value={
                        s.distributionPendingAmount != null ? (
                          <span className="text-amber-600 font-semibold">
                            {fmtRupees(s.distributionPendingAmount)}
                          </span>
                        ) : `${s.distributionPendingCount} record${s.distributionPendingCount !== 1 ? "s" : ""}`
                      }
                      href="/distribution"
                    />
                    <DataRow
                      label="Partners Owed"
                      value={s.distributionPendingCount}
                      href="/distribution"
                    />
                  </>
                )}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* ── §9 Compliance & Legal ─────────────────────────────────────── */}
        <div>
          <SectionHead icon={FileText} label="Compliance & Legal" href="/agreements" />
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            <DataRow
              label="Agreements"
              value={
                !s ? (
                  <span className="text-muted-foreground">…</span>
                ) : s.agreementCount === 0 ? (
                  <span className="text-amber-600 italic">None</span>
                ) : (
                  `${s.agreementCount}`
                )
              }
              href="/agreements"
            />
            <DataRow
              label="Status"
              value={
                s?.latestAgreementStatus ? (
                  <span
                    className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                      s.latestAgreementStatus === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {s.latestAgreementStatus}
                  </span>
                ) : undefined
              }
              href="/agreements"
            />
            {project.agreementEffectiveDate && (
              <DataRow
                label="Effective"
                value={project.agreementEffectiveDate}
                span2
              />
            )}
          </div>
        </div>

        {/* ── §9a Maturity Readiness ────────────────────────────────────── */}
        {project.lifecycleStatus === "prematurity" && isOwnership && s && (
          <>
            <Separator />
            <div>
              <SectionHead icon={Target} label="Maturity Readiness" href="/contributions" />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {project.ownershipFrozenAt ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-red-50 border-red-200 text-red-700">
                    <Lock className="h-2.5 w-2.5" /> Ownership Locked
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-violet-50 border-violet-200 text-violet-700">
                    <TrendingUp className="h-2.5 w-2.5" /> Ownership Evolving
                  </span>
                )}
                {s.lcaIsConfigured ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-green-50 border-green-200 text-green-700">
                    <CheckCircle2 className="h-2.5 w-2.5" /> LCA Configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700">
                    <AlertCircle className="h-2.5 w-2.5" /> LCA Not Configured
                  </span>
                )}
                {s.contributionPendingCount > 0 && (
                  <Link href="/contributions">
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-700 cursor-pointer hover:bg-amber-100 transition-colors">
                      <Clock className="h-2.5 w-2.5" />
                      {s.contributionPendingCount} Verification{s.contributionPendingCount !== 1 ? "s" : ""} Pending
                    </span>
                  </Link>
                )}
                {s.contributionDisputedCount > 0 && (
                  <Link href="/contributions">
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-red-50 border-red-200 text-red-700 cursor-pointer hover:bg-red-100 transition-colors">
                      <XCircle className="h-2.5 w-2.5" />
                      {s.contributionDisputedCount} Dispute{s.contributionDisputedCount !== 1 ? "s" : ""} Unresolved
                    </span>
                  </Link>
                )}
                {s.contributionTotal === 0 && !project.ownershipFrozenAt && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-500">
                    <AlertCircle className="h-2.5 w-2.5" /> No Contributions Yet
                  </span>
                )}
                {s.contributionPendingCount === 0 && s.contributionDisputedCount === 0 && s.contributionTotal > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border bg-green-50 border-green-200 text-green-700">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Contributions Clean
                  </span>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── §10 Governance Alerts ─────────────────────────────────────── */}
        {canAccessAllProjects && issues.length > 0 && (
          <>
            <Separator />
            <div>
              <SectionHead icon={AlertTriangle} label="Governance Alerts" href="/governance" />
              <div className="mt-1 space-y-1">
                {issues.slice(0, 3).map((issue: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    {ALERT_ICON[issue.severity] ?? (
                      <AlertCircle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {issue.message}
                    </p>
                  </div>
                ))}
                {issues.length > 3 && (
                  <Link href="/governance">
                    <span className="text-[11px] text-primary hover:underline cursor-pointer">
                      +{issues.length - 3} more
                    </span>
                  </Link>
                )}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* ── §11 Quick Actions ─────────────────────────────────────────── */}
        {isLocked ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Repair Actions
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <Link href={`/projects/create/${project.id}`}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-[11px] px-2 gap-1 border-red-300 text-red-700 hover:bg-red-50"
                >
                  <Wrench className="h-3.5 w-3.5" /> Repair / Add Landowner
                </Button>
              </Link>
              <Link href={`/projects/${project.id}`}>
                <Button variant="outline" size="sm" className="w-full h-8 text-[11px] px-2 gap-1">
                  <Activity className="h-3.5 w-3.5" /> View Project
                </Button>
              </Link>
            </div>
            {canAccessAllProjects && (
              <p className="text-[10px] text-muted-foreground pt-0.5">
                Operational modules blocked until landowner KYC is completed.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            <Link href={`/projects/${project.id}`}>
              <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                <Activity className="h-3 w-3" /> Dashboard
              </Button>
            </Link>
            <Link href="/partners">
              <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                <Users className="h-3 w-3" /> Participants
              </Button>
            </Link>
            <Link href="/agreements">
              <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                <FileText className="h-3 w-3" /> Agreements
              </Button>
            </Link>
            <Link href="/inventory">
              <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                <Boxes className="h-3 w-3" /> Inventory
              </Button>
            </Link>
            <Link href={isOwnership ? "/contributions" : "/distribution"}>
              <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                <Wallet className="h-3 w-3" />
                {isOwnership ? "Contributions" : "Distribution"}
              </Button>
            </Link>
            <Link href={isOwnership ? "/lca/ledger" : "/sales"}>
              <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                {isOwnership ? <Scale className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                {isOwnership ? "LCA Ledger" : "Sales"}
              </Button>
            </Link>
            {canAccessAllProjects && (
              <>
                <Link href="/production-log">
                  <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                    <ClipboardList className="h-3 w-3" /> Production
                  </Button>
                </Link>
                <Link href="/sales">
                  <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                    <ShoppingCart className="h-3 w-3" /> Sales
                  </Button>
                </Link>
                <Link href="/reports">
                  <Button variant="outline" size="sm" className="w-full h-7 text-[10px] px-1.5 gap-0.5">
                    <BarChart3 className="h-3 w-3" /> Reports
                  </Button>
                </Link>
              </>
            )}
          </div>
        )}

        {/* Delete action — admin only */}
        {canAccessAllProjects && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/5 mt-0.5"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Delete Project
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();
  const deleteProject = useDeleteProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canAccessAllProjects } = useRole();

  // Page-level global fetches — governance alerts + live card summaries
  const { data: governance } = useGetGovernanceSummary();
  const { data: cardSummaryData } = useGetProjectCardSummaries();

  // Build lookup maps so each ProjectCard gets O(1) access
  const govAlertsMap = useMemo(
    () => new Map((governance?.projectAlerts ?? []).map((a: any) => [a.projectId, a])),
    [governance],
  );

  const summaryMap = useMemo(
    () =>
      new Map<string, CardSummary>(
        ((cardSummaryData as any)?.summaries ?? []).map((s: CardSummary) => [s.projectId, s]),
      ),
    [cardSummaryData],
  );

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    deleteProject.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: `"${name}" deleted` });
        },
      },
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Plantation Projects
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Live governance hubs — click any field to navigate to its source module
          </p>
        </div>
        <Link href="/projects/create">
          <Button data-testid="button-create-project" className="gap-2">
            <Plus className="w-4 h-4" /> New Project
          </Button>
        </Link>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[700px] rounded-xl" />
          ))}
        </div>
      ) : !projects?.length ? (
        <Card className="py-16 text-center">
          <Trees className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">
            No plantation projects yet. Create the first one.
          </p>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {projects.map((project) => (
            <ProjectGovernanceCard
              key={project.id}
              project={project}
              govAlerts={canAccessAllProjects ? govAlertsMap.get(project.id) : undefined}
              cardSummary={summaryMap.get(project.id)}
              onDelete={() => handleDelete(project.id, project.name)}
              canAccessAllProjects={canAccessAllProjects}
            />
          ))}
        </div>
      )}
    </div>
  );
}
