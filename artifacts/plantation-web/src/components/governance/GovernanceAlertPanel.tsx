import {
  useGetGovernanceSummary,
  type GovernanceSummary,
  type ProjectGovernanceStatus,
  type PartnerGovernanceStatus,
  type GovernanceAlert,
} from "@workspace/api-client-react";
import { GovernanceStatusBadge } from "./GovernanceStatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  User,
  Users,
  Trees,
} from "lucide-react";

function IssueRow({ issue }: { issue: GovernanceAlert }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span
        className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          issue.severity === "attention_required" ? "bg-red-500" : "bg-amber-400"
        }`}
      />
      <p className="text-[11px] text-muted-foreground leading-snug">{issue.message}</p>
    </div>
  );
}

function ProjectAlertBlock({ alert }: { alert: ProjectGovernanceStatus }) {
  return (
    <div className="py-2 border-b last:border-0">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <Link href="/projects">
          <p className="text-xs font-medium hover:text-primary cursor-pointer truncate max-w-[160px]">
            {alert.projectName}
          </p>
        </Link>
        <GovernanceStatusBadge status={alert.status} size="xs" />
      </div>
      {alert.issues.map((issue, i) => (
        <IssueRow key={i} issue={issue} />
      ))}
    </div>
  );
}

function PartnerAlertBlock({ alert }: { alert: PartnerGovernanceStatus }) {
  return (
    <div className="py-2 border-b last:border-0">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <Link href="/partners">
          <p className="text-xs font-medium hover:text-primary cursor-pointer truncate max-w-[160px]">
            {alert.partnerName}
          </p>
        </Link>
        <GovernanceStatusBadge status={alert.status} size="xs" />
      </div>
      {alert.issues.map((issue, i) => (
        <IssueRow key={i} issue={issue} />
      ))}
    </div>
  );
}

function AllCompleteState() {
  return (
    <CardContent className="px-5 pb-4">
      <div className="flex items-center gap-2 text-emerald-700">
        <ShieldCheck className="w-4 h-4" />
        <p className="text-xs font-medium">All governance checks passed — no action required.</p>
      </div>
    </CardContent>
  );
}

function IssueGrid({ data }: { data: GovernanceSummary }) {
  return (
    <CardContent className="px-5 pb-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-4">
        {data.projectAlerts.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Trees className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Projects ({data.projectAlerts.length})
              </p>
            </div>
            <div>
              {data.projectAlerts.map((a) => (
                <ProjectAlertBlock key={a.projectId} alert={a} />
              ))}
            </div>
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 mt-1 px-0 text-primary">
                Manage Projects <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        )}

        {data.profileAlerts.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <User className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Your Profile ({data.profileAlerts.length})
              </p>
            </div>
            <div>
              {data.profileAlerts.map((a, i) => (
                <IssueRow key={i} issue={a} />
              ))}
            </div>
            <Link href="/profile">
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 mt-1 px-0 text-primary">
                Update Profile <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        )}

        {data.partnerAlerts.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Partners ({data.partnerAlerts.length})
              </p>
            </div>
            <div>
              {data.partnerAlerts.map((a) => (
                <PartnerAlertBlock key={a.partnerId} alert={a} />
              ))}
            </div>
            <Link href="/partners">
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 mt-1 px-0 text-primary">
                View Partners <ChevronRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        )}
      </div>
    </CardContent>
  );
}

export function GovernanceAlertPanel() {
  const { data, isLoading } = useGetGovernanceSummary();

  if (isLoading) {
    return (
      <Card className="border border-gray-200 shadow-none bg-white">
        <CardHeader className="pb-2 px-5 pt-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-7 h-7 rounded-lg" />
            <div className="space-y-1">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-2.5 w-52" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-4 space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const isAllComplete = data.overallStatus === "complete";

  const borderColor =
    data.overallStatus === "attention_required"
      ? "border-red-200"
      : data.overallStatus === "incomplete"
      ? "border-amber-200"
      : "border-emerald-200";

  const bgColor =
    data.overallStatus === "attention_required"
      ? "bg-red-50/40"
      : data.overallStatus === "incomplete"
      ? "bg-amber-50/30"
      : "bg-emerald-50/20";

  const iconBg =
    data.overallStatus === "attention_required"
      ? "bg-red-100 text-red-600"
      : data.overallStatus === "incomplete"
      ? "bg-amber-100 text-amber-600"
      : "bg-emerald-100 text-emerald-600";

  return (
    <Card className={`border shadow-none ${borderColor} ${bgColor}`}>
      <CardHeader className="pb-2 px-5 pt-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${iconBg}`}>
              {isAllComplete ? (
                <ShieldCheck className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Governance Status</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isAllComplete
                  ? "All governance checks passed — no action needed"
                  : `${data.totalIssues} issue${data.totalIssues !== 1 ? "s" : ""} require${data.totalIssues === 1 ? "s" : ""} attention`}
              </p>
            </div>
          </div>
          <GovernanceStatusBadge status={data.overallStatus} />
        </div>
      </CardHeader>

      {isAllComplete ? <AllCompleteState /> : <IssueGrid data={data} />}
    </Card>
  );
}
