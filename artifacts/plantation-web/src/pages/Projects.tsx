import { useMemo } from "react";
import { Link } from "wouter";
import { useListProjects, useDeleteProject, getListProjectsQueryKey, useGetGovernanceSummary } from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { GovernanceStatusBadge } from "@/components/governance";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, MapPin, Trees, Trash2, ExternalLink, Lock, Layers, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800 border-blue-200",
  missing_developer: "bg-orange-100 text-orange-800 border-orange-200",
  developing: "bg-amber-100 text-amber-800 border-amber-200",
  maturing: "bg-emerald-100 text-emerald-800 border-emerald-200",
  tapping: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-gray-100 text-gray-800 border-gray-200",
  suspended: "bg-red-100 text-red-800 border-red-200",
};

const modelColors: Record<string, string> = {
  ownership_contribution: "bg-violet-100 text-violet-800 border-violet-200",
  fifty_percent_revenue: "bg-sky-100 text-sky-800 border-sky-200",
};

const modelLabels: Record<string, string> = {
  ownership_contribution: "Contribution Model",
  fifty_percent_revenue: "50% Revenue Model",
};

const activationColors: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  pending_verification: "bg-amber-100 text-amber-800 border-amber-200",
  pending_agreement: "bg-amber-100 text-amber-800 border-amber-200",
  pending_participant_confirmation: "bg-amber-100 text-amber-800 border-amber-200",
  pending_land_verification: "bg-amber-100 text-amber-800 border-amber-200",
  ready_for_activation: "bg-lime-100 text-lime-800 border-lime-200",
  suspended: "bg-red-100 text-red-800 border-red-200",
  closed: "bg-gray-100 text-gray-800 border-gray-200",
};

const activationLabels: Record<string, string> = {
  active: "Active",
  draft: "Draft",
  pending_verification: "Pending Verification",
  pending_agreement: "Pending Agreement",
  pending_participant_confirmation: "Pending Confirmation",
  pending_land_verification: "Pending Land Verification",
  ready_for_activation: "Ready for Activation",
  suspended: "Suspended",
  closed: "Closed",
};

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();
  const deleteProject = useDeleteProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canAccessAllProjects } = useRole();
  const { data: governance } = useGetGovernanceSummary();
  const govProjectMap = useMemo(
    () => new Map(governance?.projectAlerts.map((a) => [a.projectId, a.status]) ?? []),
    [governance]
  );

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}"?`)) return;
    deleteProject.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project deleted" });
      },
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Plantation Projects</h1>
          <p className="text-muted-foreground mt-1">All active rubber plantation ventures</p>
        </div>
        <Link href="/projects/create">
          <Button data-testid="button-create-project" className="gap-2">
            <Plus className="w-4 h-4" /> New Project
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : !projects?.length ? (
        <Card className="py-16 text-center">
          <Trees className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No plantation projects yet. Create the first one.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} data-testid={`card-project-${project.id}`} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="font-serif text-lg leading-tight truncate">{project.name}</CardTitle>
                    {project.projectCode && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <Hash className="w-3 h-3" />{project.projectCode}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-xs px-2 py-1 rounded-full border font-medium capitalize whitespace-nowrap ${statusColors[project.status] ?? ""}`}>
                      {project.status}
                    </span>
                    {project.ownershipFrozenAt && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium bg-red-100 text-red-800 border-red-200 whitespace-nowrap">
                        <Lock className="w-2.5 h-2.5" />
                        Frozen
                      </span>
                    )}
                    {canAccessAllProjects && governance && (
                      <GovernanceStatusBadge
                        status={govProjectMap.get(project.id) ?? "complete"}
                        size="xs"
                      />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  {project.village ? `${project.village}, ` : ""}{project.district}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Commercial model + activation status */}
                <div className="flex flex-wrap gap-1.5">
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${modelColors[project.commercialModel] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                    <Layers className="w-2.5 h-2.5" />
                    {modelLabels[project.commercialModel] ?? project.commercialModel}
                  </span>
                  {project.activationStatus !== "active" && (
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${activationColors[project.activationStatus] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                      {activationLabels[project.activationStatus] ?? project.activationStatus}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Land Area</p>
                    <p className="font-semibold">{project.landArea} {project.landAreaUnit}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Term</p>
                    <p className="font-semibold">{project.termYears} years</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Started</p>
                    <p className="font-semibold">{project.startDate}</p>
                  </div>
                  {project.expectedMaturityDate && (
                    <div>
                      <p className="text-muted-foreground text-xs">Maturity</p>
                      <p className="font-semibold">{project.expectedMaturityDate}</p>
                    </div>
                  )}
                </div>
                {project.notes && <p className="text-xs text-muted-foreground line-clamp-2">{project.notes}</p>}
                <div className="flex gap-2 pt-1">
                  <Link href={`/projects/${project.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full gap-1" data-testid={`button-view-project-${project.id}`}>
                      <ExternalLink className="w-3 h-3" /> View Details
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                    data-testid={`button-delete-project-${project.id}`}
                    onClick={() => handleDelete(project.id, project.name)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
