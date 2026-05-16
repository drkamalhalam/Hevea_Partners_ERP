import { useMemo } from "react";
import { Link } from "wouter";
import {
  useListProjects,
  useDeleteProject,
  getListProjectsQueryKey,
  useGetGovernanceSummary,
  useGetStockSummary,
  useListAgreements,
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
  Activity, Scale, BarChart3, AlertCircle, TrendingUp,
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

function ProjectGovernanceCard({
  project,
  govAlerts,
  stockEntry,
  projectAgreements,
  onDelete,
  canAccessAllProjects,
}: {
  project: any;
  govAlerts: any;
  stockEntry: any;
  projectAgreements: any[];
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

  const latestAgreement = projectAgreements[0] ?? null;

  return (
    <Card
      data-testid={`card-project-${project.id}`}
      className="flex flex-col border hover:shadow-lg transition-all duration-200"
    >
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
                      {project.village}{project.district ? `, ${project.district}` : ""}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${ACTIVATION_COLORS[project.activationStatus] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
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
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold ${MODEL_COLORS[project.commercialModel] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                <Layers className="h-2.5 w-2.5" />
                {MODEL_LABELS[project.commercialModel] ?? project.commercialModel}
              </span>
              {project.status && (
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_COLORS[project.status] ?? "bg-gray-100 text-gray-600"}`}>
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
              value={project.landArea ? `${project.landArea} ${project.landAreaUnit ?? ""}` : undefined}
              href={`/projects/${project.id}`}
            />
            <DataRow
              label="Type"
              value={
                project.landType === "recorded" ? "Recorded"
                  : project.landType === "non_recorded" ? "Non-Recorded"
                  : undefined
              }
            />
            <DataRow label="District" value={project.district} />
            <DataRow
              label="Capacity"
              value={project.rubberCapacity ? `${fmtNum(project.rubberCapacity)} ${project.rubberCapacityUnit ?? "trees"}` : undefined}
            />
          </div>
          {project.landType === "recorded" && (project.khatianNumber || project.plotNumber || project.mouja) && (
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
                <DataRow
                  label="LCA"
                  value={<span className="text-muted-foreground italic">N/A</span>}
                />
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

        {/* ── §5 Operational Status ─────────────────────────────────────── */}
        <div>
          <SectionHead icon={Package} label="Operational" href="/inventory" />
          <div className="grid grid-cols-3 gap-x-2 mt-1">
            <DataRow
              label="Produced"
              value={stockEntry ? fmtNum(stockEntry.totalProduced) : undefined}
              href="/inventory"
            />
            <DataRow
              label="Sold"
              value={stockEntry ? fmtNum(stockEntry.totalSold) : undefined}
              href="/sales"
            />
            <DataRow
              label="Stock"
              value={
                stockEntry ? (
                  <span className={
                    stockEntry.currentStock === 0
                      ? "text-muted-foreground"
                      : stockEntry.currentStock > 0
                      ? "text-emerald-700 font-semibold"
                      : "text-red-600 font-semibold"
                  }>
                    {fmtNum(stockEntry.currentStock)}
                  </span>
                ) : undefined
              }
              href="/inventory"
            />
          </div>
        </div>

        <Separator />

        {/* ── §6 Compliance & Legal ─────────────────────────────────────── */}
        <div>
          <SectionHead icon={FileText} label="Compliance & Legal" href="/agreements" />
          <div className="grid grid-cols-2 gap-x-3 mt-1">
            <DataRow
              label="Agreements"
              value={
                projectAgreements.length === 0 ? (
                  <span className="text-amber-600 italic">None</span>
                ) : (
                  `${projectAgreements.length}`
                )
              }
              href="/agreements"
            />
            <DataRow
              label="Status"
              value={
                latestAgreement ? (
                  <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${latestAgreement.status === "active" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                    {latestAgreement.status}
                  </span>
                ) : undefined
              }
              href="/agreements"
            />
            {project.agreementEffectiveDate && (
              <DataRow label="Effective" value={project.agreementEffectiveDate} span2 />
            )}
          </div>
        </div>

        {/* ── §7 Governance Alerts ──────────────────────────────────────── */}
        {canAccessAllProjects && issues.length > 0 && (
          <>
            <Separator />
            <div>
              <SectionHead icon={AlertTriangle} label="Governance Alerts" href="/governance" />
              <div className="mt-1 space-y-1">
                {issues.slice(0, 3).map((issue: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    {ALERT_ICON[issue.severity] ?? <AlertCircle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />}
                    <p className="text-[11px] text-muted-foreground leading-snug">{issue.message}</p>
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

        {/* ── §8 Quick Actions ──────────────────────────────────────────── */}
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
              <Package className="h-3 w-3" /> Inventory
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
        </div>

        {/* Delete */}
        <div className="flex justify-end pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive h-6 text-[10px] gap-0.5 px-2"
            data-testid={`button-delete-project-${project.id}`}
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" /> Delete project
          </Button>
        </div>
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

  // Page-level global fetches — shared across all cards
  const { data: governance } = useGetGovernanceSummary();
  const { data: stockData } = useGetStockSummary();
  const { data: agreements } = useListAgreements();

  // Build lookup maps so each ProjectCard gets O(1) access
  const govAlertsMap = useMemo(
    () => new Map((governance?.projectAlerts ?? []).map((a: any) => [a.projectId, a])),
    [governance],
  );

  const stockMap = useMemo(
    () => new Map((stockData ?? []).map((s: any) => [s.projectId, s])),
    [stockData],
  );

  const agreementsMap = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const a of agreements ?? []) {
      const list = map.get(a.projectId) ?? [];
      list.push(a);
      map.set(a.projectId, list);
    }
    return map;
  }, [agreements]);

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
              stockEntry={stockMap.get(project.id)}
              projectAgreements={agreementsMap.get(project.id) ?? []}
              onDelete={() => handleDelete(project.id, project.name)}
              canAccessAllProjects={canAccessAllProjects}
            />
          ))}
        </div>
      )}
    </div>
  );
}
