/**
 * ActivationDashboard
 *
 * Shows all agreements currently in pending_activation status.
 * Admin and developer only.  Each row shows the agreement details, OTP
 * verification progress, and a direct link to the agreement detail page.
 */

import { format } from "date-fns";
import { Link } from "wouter";
import {
  useListPendingActivationAgreements,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  RefreshCw,
  Users,
  AlertTriangle,
} from "lucide-react";

// ── Progress indicator ────────────────────────────────────────────────────────

function OtpProgress({
  tasks,
}: {
  tasks: Array<{ status: string; partyRole: string; partyName: string }>;
}) {
  if (!tasks || tasks.length === 0) return null;
  const verified = tasks.filter((t) => t.status === "verified").length;
  const total = tasks.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        {tasks.map((task) => {
          const isVerified = task.status === "verified";
          const isSent = task.status === "sent";
          return (
            <div key={task.partyRole} className="flex items-center gap-1.5 text-xs">
              {isVerified ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              ) : isSent ? (
                <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <span className={`capitalize ${isVerified ? "text-emerald-700" : isSent ? "text-amber-700" : "text-muted-foreground"}`}>
                {task.partyRole}: {task.partyName}
              </span>
            </div>
          );
        })}
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(verified / total) * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{verified}/{total} parties verified</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ActivationDashboard() {
  const { data: items, isLoading, refetch, isFetching } = useListPendingActivationAgreements();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold font-serif tracking-tight">Activation Tasks</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Agreements awaiting OTP verification from all parties before becoming active.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <ShieldCheck className="w-5 h-5 text-amber-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : (items?.length ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Pending Activation</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-sky-100">
                <Clock className="w-5 h-5 text-sky-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {isLoading ? "—" : (
                    items?.reduce((sum, item) => {
                      const tasks = item.activation?.otpTasks ?? [];
                      return sum + tasks.filter((t) => t.status === "sent").length;
                    }, 0) ?? 0
                  )}
                </p>
                <p className="text-xs text-muted-foreground">OTPs Awaiting Entry</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {isLoading ? "—" : (
                    items?.reduce((sum, item) => {
                      const tasks = item.activation?.otpTasks ?? [];
                      return sum + tasks.filter((t) => t.status === "verified").length;
                    }, 0) ?? 0
                  )}
                </p>
                <p className="text-xs text-muted-foreground">OTPs Verified</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Agreement list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : !items || items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="font-semibold">All clear!</p>
            <p className="text-sm text-muted-foreground mt-1">
              No agreements are currently pending activation.
            </p>
            <Button variant="outline" size="sm" className="mt-4 gap-1.5" asChild>
              <Link href="/agreements">
                <ShieldCheck className="w-4 h-4" /> View All Agreements
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const tasks = item.activation?.otpTasks ?? [];
            const verified = tasks.filter((t) => t.status === "verified").length;
            const total = tasks.length;
            const hasPendingOtp = tasks.some((t) => t.status === "pending");
            const hasExpired = tasks.some((t) => t.status === "expired" || t.status === "failed");

            return (
              <Card
                key={item.agreementId}
                className="hover:border-primary/40 transition-colors"
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-3 flex-1 min-w-0">
                      {/* Agreement header */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold truncate">{item.projectName}</h3>
                          <Badge variant="outline" className="text-xs shrink-0">
                            Pending Activation
                          </Badge>
                          {hasExpired && (
                            <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200 shrink-0">
                              <AlertTriangle className="w-3 h-3 mr-1" /> OTP Issue
                            </Badge>
                          )}
                          {hasPendingOtp && (
                            <Badge variant="outline" className="text-xs bg-gray-50 text-gray-600 shrink-0">
                              OTP not sent
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {item.landOwnerName} ↔ {item.projectDeveloperName}
                          </span>
                          <span>Execution: {item.executionDate}</span>
                          {item.activation?.initiatedByName && (
                            <span>Initiated by {item.activation.initiatedByName}</span>
                          )}
                          {item.activation?.createdAt && (
                            <span>{format(new Date(item.activation.createdAt), "dd MMM yyyy")}</span>
                          )}
                        </div>
                      </div>

                      {/* OTP progress */}
                      <OtpProgress tasks={tasks} />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-2xl font-bold">{verified}/{total}</p>
                        <p className="text-xs text-muted-foreground">verified</p>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" asChild>
                        <Link href={`/agreements/${item.agreementId}`}>
                          Manage <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t pt-3">
        Only admin and developer roles can view and manage the activation dashboard.
        OTP codes are simulated — in production these would be dispatched via SMS/email.
      </p>
    </div>
  );
}
