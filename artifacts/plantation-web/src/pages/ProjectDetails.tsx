import { useRoute, Link } from "wouter";
import { useGetProject, useListAgreements, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MapPin } from "lucide-react";
import ProjectParticipants from "./ProjectParticipants";
import ProjectNomineeSection from "./ProjectNominee";
import ProjectLifecycleSection from "./ProjectLifecycleSection";

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  maturing: "bg-emerald-100 text-emerald-800",
  tapping: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
};

export default function ProjectDetails() {
  const [, params] = useRoute("/projects/:id");
  const id = params?.id ?? "";
  const { data: project, isLoading } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  const { data: agreements } = useListAgreements();

  const projectAgreements = agreements?.filter(a => a.projectId === id) ?? [];

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
          <h1 className="text-3xl font-serif font-bold text-foreground">{project.name}</h1>
          <div className="flex items-center gap-2 mt-1 text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <span>{project.location}{project.village ? `, ${project.village}` : ""}, {project.district}, {project.state}</span>
          </div>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium capitalize ${statusColors[project.status] ?? ""}`}>
          {project.status}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Land Area</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{project.landArea} <span className="text-base font-normal text-muted-foreground">{project.landAreaUnit}</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Agreement Term</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{project.termYears} <span className="text-base font-normal text-muted-foreground">years</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Land Notional Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{project.landNotionalValue ? `₹${project.landNotionalValue.toLocaleString("en-IN")}` : "—"}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-serif">Project Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><dt className="text-muted-foreground mb-1">Start Date</dt><dd className="font-medium">{project.startDate}</dd></div>
            {project.expectedMaturityDate && <div><dt className="text-muted-foreground mb-1">Expected Maturity</dt><dd className="font-medium">{project.expectedMaturityDate}</dd></div>}
            {project.landValuePerUnit && <div><dt className="text-muted-foreground mb-1">Value Per {project.landAreaUnit}</dt><dd className="font-medium">₹{project.landValuePerUnit.toLocaleString("en-IN")}</dd></div>}
            <div><dt className="text-muted-foreground mb-1">District</dt><dd className="font-medium">{project.district}</dd></div>
            <div><dt className="text-muted-foreground mb-1">State</dt><dd className="font-medium">{project.state}</dd></div>
            {project.village && <div><dt className="text-muted-foreground mb-1">Village</dt><dd className="font-medium">{project.village}</dd></div>}
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

      <ProjectParticipants projectId={id} />

      <ProjectNomineeSection projectId={id} />
    </div>
  );
}
