import { Link } from "wouter";
import { useGetDashboardSummary, useListProjects, useListPartners, useListAgreements, useGetRecentActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trees, Users, FileText, Map, ExternalLink, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

const roleColors: Record<string, string> = {
  project_developer: "bg-purple-100 text-purple-800",
  landowner: "bg-emerald-100 text-emerald-800",
  investor: "bg-blue-100 text-blue-800",
};

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  developing: "bg-amber-100 text-amber-800",
  maturing: "bg-emerald-100 text-emerald-800",
  tapping: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
};

export default function Admin() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: projects } = useListProjects();
  const { data: partners } = useListPartners();
  const { data: agreements } = useListAgreements();
  const { data: activities } = useGetRecentActivity();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Admin Overview</h1>
          <p className="text-muted-foreground mt-1">Full management view of all platform data</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoadingSummary ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />) : summary ? (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                <Trees className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalProjects}</div>
                <p className="text-xs text-muted-foreground mt-1">{summary.tappingProjectsCount} tapping</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Partners</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{summary.totalPartners}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Agreements</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{summary.totalAgreements}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Land</CardTitle>
                <Map className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalLandArea.toFixed(1)}</div>
                <p className="text-xs text-muted-foreground">kani</p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-serif">All Projects</CardTitle>
            <Link href="/projects"><Button variant="outline" size="sm" className="gap-1"><ExternalLink className="w-3 h-3" /> Manage</Button></Link>
          </CardHeader>
          <CardContent>
            {!projects?.length ? <p className="text-sm text-muted-foreground text-center py-4">No projects yet.</p> : (
              <div className="space-y-2">
                {projects.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <span className="font-medium">{p.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[p.status] ?? ""}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-serif">All Partners</CardTitle>
            <Link href="/partners"><Button variant="outline" size="sm" className="gap-1"><ExternalLink className="w-3 h-3" /> Manage</Button></Link>
          </CardHeader>
          <CardContent>
            {!partners?.length ? <p className="text-sm text-muted-foreground text-center py-4">No partners yet.</p> : (
              <div className="space-y-2">
                {partners.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <span className="font-medium">{p.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleColors[p.role] ?? ""}`}>{p.role.replace("_", " ")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif">All Agreements</CardTitle>
          <Link href="/agreements"><Button variant="outline" size="sm" className="gap-1"><ExternalLink className="w-3 h-3" /> Manage</Button></Link>
        </CardHeader>
        <CardContent>
          {!agreements?.length ? <p className="text-sm text-muted-foreground text-center py-4">No agreements yet.</p> : (
            <div className="space-y-2">
              {agreements.map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{a.projectName}</p>
                    <p className="text-xs text-muted-foreground">{a.landOwnerName} · {a.landArea} {a.landAreaUnit}</p>
                  </div>
                  <Link href={`/agreements/${a.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {activities && activities.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="font-serif">Recent Activity</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activities.slice(0, 8).map(a => (
                <div key={a.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <span className="flex-1">{a.description}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(a.createdAt), "MMM d, yyyy")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
