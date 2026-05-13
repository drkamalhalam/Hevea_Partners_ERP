import { useMemo } from "react";
import { Link } from "wouter";
import {
  useGetGovernanceSummary,
  useListPendingVerifications,
  useListBurdenRecords,
  useListExpenditures,
} from "@workspace/api-client-react";
import type {
  BurdenRecord,
  ExpenditureEntry,
  PendingVerificationItem,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { GovernanceStatusBadge } from "@/components/governance/GovernanceStatusBadge";
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  XCircle,
  ArrowLeftRight,
  Receipt,
  CheckCircle2,
  Ban,
  History,
  ExternalLink,
  Info,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXPENDITURE_CODES = new Set([
  "REJECTED_EXPENDITURE",
  "PENDING_EXPENDITURE_VERIFICATION",
  "UNRESOLVED_BURDEN_IMBALANCE",
]);

const INR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function IssuePill({ code }: { code: string }) {
  const map: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
    REJECTED_EXPENDITURE: { label: "Rejected", cls: "bg-red-100 text-red-700 border-red-200", Icon: XCircle },
    PENDING_EXPENDITURE_VERIFICATION: { label: "Pending Verification", cls: "bg-amber-100 text-amber-700 border-amber-200", Icon: Clock },
    UNRESOLVED_BURDEN_IMBALANCE: { label: "Burden Imbalance", cls: "bg-orange-100 text-orange-700 border-orange-200", Icon: ArrowLeftRight },
  };
  const def = map[code] ?? { label: code, cls: "bg-zinc-100 text-zinc-600 border-zinc-200", Icon: Info };
  const { label, cls, Icon } = def;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium", cls)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function AdjustmentBadge({ status }: { status: BurdenRecord["adjustmentStatus"] }) {
  const map: Record<string, string> = {
    developer_advance: "bg-blue-100 text-blue-700 border-blue-200",
    landowner_advance: "bg-purple-100 text-purple-700 border-purple-200",
    balanced: "bg-emerald-100 text-emerald-700 border-emerald-200",
    waived: "bg-zinc-100 text-zinc-500 border-zinc-200",
  };
  const label = (status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs border font-medium", map[status] ?? "bg-zinc-100 text-zinc-600")}>
      {label}
    </span>
  );
}

function RecoveryBadge({ status }: { status: BurdenRecord["recoveryStatus"] }) {
  const map: Record<string, string> = {
    none: "bg-red-100 text-red-600 border-red-200",
    pending: "bg-amber-100 text-amber-700 border-amber-200",
    in_recovery: "bg-blue-100 text-blue-700 border-blue-200",
    recovered: "bg-emerald-100 text-emerald-700 border-emerald-200",
    waived: "bg-zinc-100 text-zinc-500 border-zinc-200",
  };
  const label = (status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs border font-medium", map[status] ?? "bg-zinc-100 text-zinc-600")}>
      {label}
    </span>
  );
}

// ── Alert Center ──────────────────────────────────────────────────────────────

function AlertCenterTab() {
  const { data: gov, isLoading } = useGetGovernanceSummary();

  const expenditureProjects = useMemo(() => {
    if (!gov?.projectAlerts) return [];
    return gov.projectAlerts
      .map((p) => ({
        ...p,
        issues: p.issues.filter((i) => EXPENDITURE_CODES.has(i.code)),
      }))
      .filter((p) => p.issues.length > 0)
      .sort((a, b) => {
        const order = { attention_required: 0, incomplete: 1, pending: 2, complete: 3 };
        return (order[a.status] ?? 4) - (order[b.status] ?? 4);
      });
  }, [gov]);

  const totalRejected = useMemo(
    () =>
      expenditureProjects.flatMap((p) => p.issues).filter((i) => i.code === "REJECTED_EXPENDITURE").length,
    [expenditureProjects],
  );
  const totalPending = useMemo(
    () =>
      expenditureProjects.flatMap((p) => p.issues).filter((i) => i.code === "PENDING_EXPENDITURE_VERIFICATION").length,
    [expenditureProjects],
  );
  const totalImbalance = useMemo(
    () =>
      expenditureProjects.flatMap((p) => p.issues).filter((i) => i.code === "UNRESOLVED_BURDEN_IMBALANCE").length,
    [expenditureProjects],
  );

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="w-8 h-8 text-red-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-red-700">{totalRejected}</div>
              <div className="text-xs text-red-600">Projects w/ Rejected Expenditures</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-amber-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-amber-700">{totalPending}</div>
              <div className="text-xs text-amber-600">Projects w/ Pending Verification Backlog</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowLeftRight className="w-8 h-8 text-orange-500 shrink-0" />
            <div>
              <div className="text-2xl font-bold text-orange-700">{totalImbalance}</div>
              <div className="text-xs text-orange-600">Projects w/ Unresolved Burden Imbalances</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-project alert cards */}
      {expenditureProjects.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            <div className="font-semibold text-zinc-700">All clear — no expenditure governance issues</div>
            <div className="text-sm text-zinc-500">No rejected expenditures, pending backlogs, or unresolved burden imbalances across any project.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {expenditureProjects.map((project) => (
            <Card
              key={project.projectId}
              className={cn(
                "border",
                project.status === "attention_required"
                  ? "border-red-200 bg-red-50/40"
                  : "border-amber-200 bg-amber-50/40",
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2">
                    <ShieldAlert
                      className={cn(
                        "w-4 h-4 shrink-0",
                        project.status === "attention_required" ? "text-red-500" : "text-amber-500",
                      )}
                    />
                    <span className="font-semibold text-zinc-800">{project.projectName}</span>
                  </div>
                  <GovernanceStatusBadge status={project.status} size="sm" />
                </div>
                <div className="space-y-2">
                  {project.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <IssuePill code={issue.code} />
                      <span className="text-zinc-600 leading-snug">{issue.message}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-200/60 flex gap-3">
                  <Link
                    href={`/expenditure`}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    <Receipt className="w-3 h-3" />
                    View Expenditures
                  </Link>
                  <Link
                    href={`/burden`}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    Burden Accounting
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pending Tasks Tab ─────────────────────────────────────────────────────────

function PendingTasksTab() {
  const { data: pendingData, isLoading: loadingPending } = useListPendingVerifications();
  const { data: burdenData, isLoading: loadingBurden } = useListBurdenRecords({});

  const pendingItems: PendingVerificationItem[] = pendingData?.items ?? [];
  const unresolvedBurden: BurdenRecord[] = useMemo(
    () =>
      (burdenData?.records ?? []).filter(
        (r) =>
          (r.adjustmentStatus === "developer_advance" || r.adjustmentStatus === "landowner_advance") &&
          (r.recoveryStatus === "none" || r.recoveryStatus === "pending" || r.recoveryStatus === "in_recovery"),
      ),
    [burdenData],
  );

  return (
    <div className="space-y-8 pt-2">
      {/* Pending Expenditure Verifications */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-zinc-800">Expenditure Verifications Awaiting Review</h3>
          {!loadingPending && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
              {pendingItems.length} pending
            </Badge>
          )}
        </div>

        {loadingPending ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : pendingItems.length === 0 ? (
          <Card>
            <CardContent className="py-8 flex items-center justify-center gap-2 text-zinc-500">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span className="text-sm">No pending expenditure verifications</span>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pendingItems.map((item) => (
              <Card key={item.expenditure.id} className="border-amber-200">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-zinc-800 text-sm truncate">{item.expenditure.description}</span>
                        <Badge variant="outline" className="text-xs shrink-0 capitalize">
                          {item.expenditure.category?.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>{item.expenditure.projectName ?? "Unknown project"}</span>
                        <span>·</span>
                        <span>{fmtDate(item.expenditure.expenditureDate)}</span>
                        <span>·</span>
                        <span>Paid by: {item.expenditure.paidByName ?? "—"}</span>
                      </div>
                      {item.request.routingReason && (
                        <p className="text-xs text-zinc-500 mt-1 italic">{item.request.routingReason}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-base font-bold text-zinc-800">{INR(item.expenditure.amount)}</span>
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        Awaiting {item.request.requiredVerifierRole}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-zinc-100">
                    <Link
                      href="/expenditure"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open in Expenditure module
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Unresolved Burden Imbalances */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <ArrowLeftRight className="w-4 h-4 text-orange-500" />
          <h3 className="font-semibold text-zinc-800">Burden Imbalances Pending Recovery</h3>
          {!loadingBurden && (
            <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200 text-xs">
              {unresolvedBurden.length} unresolved
            </Badge>
          )}
        </div>

        <div className="mb-3 rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-xs text-zinc-600 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" />
          Burden imbalances arise when one party pays operational costs that another party was expected to bear. These are cost-sharing adjustments only — they do not affect ownership stakes or equity percentages.
        </div>

        {loadingBurden ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : unresolvedBurden.length === 0 ? (
          <Card>
            <CardContent className="py-8 flex items-center justify-center gap-2 text-zinc-500">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span className="text-sm">No unresolved burden imbalances</span>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {unresolvedBurden.map((record) => {
              const imbalance =
                record.adjustmentStatus === "developer_advance"
                  ? record.developerImbalanceAmount
                  : record.landownerImbalanceAmount;
              return (
                <Card key={record.id} className="border-orange-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-zinc-800 text-sm capitalize">
                            {record.category?.replace(/_/g, " ")}
                          </span>
                          <AdjustmentBadge status={record.adjustmentStatus} />
                          <RecoveryBadge status={record.recoveryStatus} />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-zinc-500">
                          <span>{record.projectName ?? "Unknown project"}</span>
                          <span>·</span>
                          <span>
                            Payer:{" "}
                            <span className="capitalize">
                              {record.actualPayerRole?.replace(/_/g, " ")} {record.actualPayerName ? `(${record.actualPayerName})` : ""}
                            </span>
                          </span>
                        </div>
                        {record.expenditureDescription && (
                          <p className="text-xs text-zinc-500 mt-1 truncate">{record.expenditureDescription}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-base font-bold text-zinc-800">{INR(record.totalAmount)}</span>
                        <span className="text-xs text-orange-600">
                          Imbalance: {INR(imbalance)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-zinc-100">
                      <Link
                        href="/burden"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open in Burden Accounting
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Dispute History Tab ───────────────────────────────────────────────────────

const DISPUTE_STATUS_CONFIG: Record<
  string,
  { label: string; cls: string; Icon: React.ElementType }
> = {
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700 border-red-200", Icon: XCircle },
  pending_review: { label: "Pending Review", cls: "bg-amber-100 text-amber-700 border-amber-200", Icon: Clock },
  draft: { label: "Draft", cls: "bg-zinc-100 text-zinc-600 border-zinc-200", Icon: Ban },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
};

function VerificationStatusBadge({ status }: { status: ExpenditureEntry["verificationStatus"] }) {
  const cfg = DISPUTE_STATUS_CONFIG[status] ?? DISPUTE_STATUS_CONFIG.draft;
  const { label, cls, Icon } = cfg;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium", cls)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function DisputeHistoryTab() {
  const { data, isLoading } = useListExpenditures({});

  const rejectedExpenditures = useMemo(
    () =>
      (data?.expenditures ?? [])
        .filter((e) => e.verificationStatus === "rejected" || e.verificationStatus === "pending_review")
        .sort((a, b) => new Date(b.expenditureDate).getTime() - new Date(a.expenditureDate).getTime()),
    [data],
  );

  const rejected = rejectedExpenditures.filter((e) => e.verificationStatus === "rejected");
  const pendingReview = rejectedExpenditures.filter((e) => e.verificationStatus === "pending_review");

  if (isLoading) {
    return (
      <div className="space-y-2 pt-2">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">
      {/* Summary row */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <XCircle className="w-4 h-4 text-red-500" />
          <span className="font-semibold text-red-700">{rejected.length}</span>
          <span className="text-zinc-500">Rejected</span>
        </span>
        <span className="text-zinc-300">|</span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-amber-500" />
          <span className="font-semibold text-amber-700">{pendingReview.length}</span>
          <span className="text-zinc-500">Pending Review</span>
        </span>
      </div>

      {rejectedExpenditures.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <History className="w-10 h-10 text-zinc-300" />
            <div className="font-semibold text-zinc-600">No dispute history</div>
            <div className="text-sm text-zinc-400">No rejected or pending-review expenditures found.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rejectedExpenditures.map((exp) => (
            <Card
              key={exp.id}
              className={cn(
                "border",
                exp.verificationStatus === "rejected" ? "border-red-200 bg-red-50/30" : "border-amber-200 bg-amber-50/30",
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <VerificationStatusBadge status={exp.verificationStatus} />
                      <span className="font-medium text-zinc-800 text-sm">{exp.description}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                      <span>{exp.projectName ?? "Unknown project"}</span>
                      <span>·</span>
                      <span className="capitalize">{exp.category?.replace(/_/g, " ")}</span>
                      <span>·</span>
                      <span>{fmtDate(exp.expenditureDate)}</span>
                      {exp.paidByName && (
                        <>
                          <span>·</span>
                          <span>Paid by: {exp.paidByName}</span>
                        </>
                      )}
                    </div>
                    {exp.verifierNotes && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-700 italic">{exp.verifierNotes}</p>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-bold text-zinc-800">{INR(exp.amount)}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{exp.lifecyclePhaseSnapshot?.replace(/_/g, " ")}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-400 text-center pb-2">
        Showing rejected and pending-review expenditures. Resolved items are visible in the Expenditure module.
      </p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpenditureGovernance() {
  const { role } = useRole();

  if (role !== "admin" && role !== "developer") {
    return (
      <div className="p-8 flex flex-col items-center gap-4 text-center">
        <ShieldAlert className="w-12 h-12 text-zinc-300" />
        <div className="font-semibold text-zinc-600">Access Restricted</div>
        <p className="text-sm text-zinc-500">Expenditure governance monitoring is available to Admin and Developer roles only.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-lg bg-red-100 shrink-0">
          <ShieldAlert className="w-6 h-6 text-red-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Expenditure Governance</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Monitor rejected expenditures, pending verification backlogs, and unresolved operational burden conflicts. Projects with open issues require attention before lifecycle transitions.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="alerts">
        <TabsList className="bg-zinc-100">
          <TabsTrigger value="alerts" className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            Alert Center
          </TabsTrigger>
          <TabsTrigger value="pending" className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Pending Tasks
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Dispute History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <AlertCenterTab />
        </TabsContent>
        <TabsContent value="pending">
          <PendingTasksTab />
        </TabsContent>
        <TabsContent value="history">
          <DisputeHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
