import { useRoute, Link } from "wouter";
import { useGetProject, useListAgreements, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MapPin, ChevronRight, Lock, Archive, Layers, Hash, ShieldCheck, AlertTriangle } from "lucide-react";
import ProjectParticipants from "./ProjectParticipants";
import ProjectNomineeSection from "./ProjectNominee";
import ProjectLifecycleSection from "./ProjectLifecycleSection";
import { OwnershipFreezePanel } from "@/components/ownership/OwnershipFreezePanel";
import MissingDeveloperPanel from "./MissingDeveloperPanel";

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  maturing: "bg-emerald-100 text-emerald-800",
  tapping: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
  missing_developer: "bg-orange-100 text-orange-800",
};

const modelConfig: Record<string, { label: string; desc: string; color: string; bg: string; border: string }> = {
  ownership_contribution: {
    label: "Ownership Contribution Model",
    desc: "Revenue distributed by verified equity stakes. LCA eligible after maturity. Inheritance and share transfers supported.",
    color: "text-violet-800",
    bg: "bg-violet-50",
    border: "border-violet-200",
  },
  fifty_percent_revenue: {
    label: "50% Revenue Model",
    desc: "Fixed contractual revenue split. No ownership equity formation. LCA, land notional value, and contribution equity are disabled.",
    color: "text-sky-800",
    bg: "bg-sky-50",
    border: "border-sky-200",
  },
};

const activationConfig: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "text-emerald-800", bg: "bg-emerald-100" },
  draft: { label: "Draft", color: "text-slate-600", bg: "bg-slate-100" },
  pending_verification: { label: "Pending Verification", color: "text-amber-800", bg: "bg-amber-100" },
  pending_agreement: { label: "Pending Agreement", color: "text-amber-800", bg: "bg-amber-100" },
  pending_participant_confirmation: { label: "Pending Confirmation", color: "text-amber-800", bg: "bg-amber-100" },
  pending_land_verification: { label: "Pending Land Verification", color: "text-amber-800", bg: "bg-amber-100" },
  ready_for_activation: { label: "Ready for Activation", color: "text-lime-800", bg: "bg-lime-100" },
  suspended: { label: "Suspended", color: "text-red-800", bg: "bg-red-100" },
  closed: { label: "Closed", color: "text-gray-700", bg: "bg-gray-100" },
};

export default function ProjectDetails() {
  const [, params] = useRoute("/projects/:id");
  const id = params?.id ?? "";
  const { data: project, isLoading } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  const { data: agreements } = useListAgreements();

  const projectAgreements = agreements?.filter(a => a.projectId === id) ?? [];
  const isFrozen = !!project?.ownershipFrozenAt;
  const model = project ? (modelConfig[project.commercialModel] ?? modelConfig.ownership_contribution) : null;
  const activation = project ? (activationConfig[project.activationStatus] ?? activationConfig.active) : null;
  const isFiftyPercent = project?.commercialModel === "fifty_percent_revenue";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Project not found.</p>
        <Link href="/projects"><Button variant="outline" className="mt-4">Back to Projects</Button></Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="w-4 h-4" /> Projects</Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-3xl font-serif font-bold text-foreground">{project.name}</h1>
            {isFrozen && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium bg-red-100 text-red-800 border-red-200">
                <Lock className="w-3 h-3" />
                Ownership Frozen
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <span>{project.location}{project.village ? `, ${project.village}` : ""}, {project.district}, {project.state}</span>
          </div>
          {project.projectCode && (
            <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
              <Hash className="w-3.5 h-3.5" />
              <span className="font-mono">{project.projectCode}</span>
            </div>
          )}
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium capitalize flex-shrink-0 ${statusColors[project.status] ?? ""}`}>
          {project.status}
        </span>
      </div>

      {/* ── Governance Foundation Banner ── */}
      {model && activation && (
        <Card className={`border ${model.border} ${model.bg}`}>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="flex items-start gap-3 flex-1">
                <ShieldCheck className={`w-5 h-5 mt-0.5 flex-shrink-0 ${model.color}`} />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${model.color}`}>{model.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${activation.bg} ${activation.color}`}>
                      {activation.label}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${model.color} opacity-80`}>{model.desc}</p>
                </div>
              </div>
              {isFiftyPercent && (
                <div className="flex items-start gap-1.5 text-xs text-sky-700 bg-white/60 rounded px-3 py-2 border border-sky-200 sm:max-w-xs">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>LCA, land notional value and ownership equity modules are <strong>disabled</strong> for this project.</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stats strip ── */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Land Area</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{project.landArea} <span className="text-base font-normal text-muted-foreground">{project.landAreaUnit}</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Agreement Term</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{project.termYears} <span className="text-base font-normal text-muted-foreground">years</span></p></CardContent>
        </Card>
        {!isFiftyPercent && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Land Notional Value</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{project.landNotionalValue ? `₹${project.landNotionalValue.toLocaleString("en-IN")}` : "—"}</p></CardContent>
          </Card>
        )}
        {isFiftyPercent && (
          <Card className="border-sky-100 bg-sky-50/30">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Revenue Structure</CardTitle></CardHeader>
            <CardContent><p className="text-sm font-semibold text-sky-800">Fixed 50 / 50 contractual split</p></CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="font-serif">Project Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><dt className="text-muted-foreground mb-1">Start Date</dt><dd className="font-medium">{project.startDate}</dd></div>
            {project.expectedMaturityDate && <div><dt className="text-muted-foreground mb-1">Expected Maturity</dt><dd className="font-medium">{project.expectedMaturityDate}</dd></div>}
            {!isFiftyPercent && project.landValuePerUnit && (
              <div><dt className="text-muted-foreground mb-1">Value Per {project.landAreaUnit}</dt><dd className="font-medium">₹{project.landValuePerUnit.toLocaleString("en-IN")}</dd></div>
            )}
            <div><dt className="text-muted-foreground mb-1">District</dt><dd className="font-medium">{project.district}</dd></div>
            <div><dt className="text-muted-foreground mb-1">State</dt><dd className="font-medium">{project.state}</dd></div>
            {project.village && <div><dt className="text-muted-foreground mb-1">Village</dt><dd className="font-medium">{project.village}</dd></div>}
            <div>
              <dt className="text-muted-foreground mb-1 flex items-center gap-1"><Layers className="w-3 h-3" /> Commercial Model</dt>
              <dd className="font-medium">{model?.label ?? project.commercialModel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground mb-1">Activation Status</dt>
              <dd className={`text-xs px-2 py-0.5 rounded-full font-medium inline-block ${activation?.bg ?? ""} ${activation?.color ?? ""}`}>
                {activation?.label ?? project.activationStatus}
              </dd>
            </div>
          </dl>
          {project.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{project.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif">Partnership Agreements</CardTitle>
          <Link href="/agreements"><Button variant="outline" size="sm">View All</Button></Link>
        </CardHeader>
        <CardContent>
          {!projectAgreements.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No agreements for this project yet.</p>
          ) : (
            <div className="space-y-3">
              {projectAgreements.map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{a.landOwnerName} (Landowner)</p>
                    <p className="text-xs text-muted-foreground">{a.landArea} {a.landAreaUnit} · ₹{a.landNotionalValue.toLocaleString("en-IN")} notional value</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${a.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{a.status}</span>
                    <Link href={`/agreements/${a.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProjectLifecycleSection projectId={id} />

      {/* Ownership Freeze — shown for mature/closed projects where freeze exists */}
      {!isFiftyPercent && (project.lifecycleStatus === "mature_production" || project.lifecycleStatus === "closed") && (
        <OwnershipFreezePanel projectId={id} />
      )}

      {/* Maturity Declaration — only visible for prematurity projects */}
      {project.lifecycleStatus === "prematurity" && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-serif text-base">Maturity Declaration</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Multi-party OTP governance workflow to advance this project to Mature Production
                </p>
              </div>
              <Link href={`/projects/${id}/maturity`}>
                <Button size="sm" variant="outline" className="gap-1.5 border-amber-300">
                  <ChevronRight className="w-4 h-4" />
                  Manage
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Project Closure — only visible for non-closed projects */}
      {project.lifecycleStatus !== "closed" && (
        <Card className="border-gray-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="font-serif text-base flex items-center gap-2">
                  <Archive className="w-4 h-4 text-gray-500" />
                  Project Closure
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Governance workflow for operational closure with landowner acknowledgment
                </p>
              </div>
              <Link href={`/projects/${id}/closure`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <ChevronRight className="w-4 h-4" />
                  Manage
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      )}

      <MissingDeveloperPanel projectId={id} />

      <ProjectParticipants projectId={id} />

      <ProjectNomineeSection projectId={id} />
    </div>
  );
}
