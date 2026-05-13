import { useState } from "react";
import { Link } from "wouter";
import {
  useListContributions,
  useGetContributionDisputeSummary,
  useRaiseContributionDispute,
  useResolveContributionDispute,
  useVerifyContribution,
  useRejectContribution,
  useGetGovernanceSummary,
  useListProjects,
  getListContributionsQueryKey,
  getGetContributionDisputeSummaryQueryKey,
  getGetGovernanceSummaryQueryKey,
} from "@workspace/api-client-react";
import type { ContributionEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ArrowRight,
  MessageSquareWarning,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronRight,
  Ban,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";

// ── helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TYPE_LABELS: Record<string, string> = {
  land_notional: "Land Notional",
  economic_investment: "Economic Investment",
  operational_cost: "Operational Cost",
  recoverable_advance: "Recoverable Advance",
  manual_adjustment: "Manual Adjustment",
};

// ── status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending_verification: {
      label: "Pending Verification",
      className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    },
    rejected: {
      label: "Rejected",
      className: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    },
    disputed: {
      label: "Disputed",
      className: "bg-red-500/15 text-red-400 border-red-500/30",
    },
    verified: {
      label: "Verified",
      className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    },
    draft: {
      label: "Draft",
      className: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    },
  };
  const c = config[status] ?? { label: status, className: "bg-slate-500/15 text-slate-400" };
  return (
    <Badge variant="outline" className={cn("text-xs font-medium border", c.className)}>
      {c.label}
    </Badge>
  );
}

// ── contribution row ─────────────────────────────────────────────────────────

interface ContribRowProps {
  entry: ContributionEntry;
  showActions: boolean;
  onDispute: (entry: ContributionEntry) => void;
  onResolve: (entry: ContributionEntry, action: "re_verify" | "reject") => void;
  onVerify: (entry: ContributionEntry) => void;
  onReject: (entry: ContributionEntry) => void;
}

function ContribRow({ entry, showActions, onDispute, onResolve, onVerify, onReject }: ContribRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isAdminDev = showActions;

  return (
    <>
      <tr
        className="border-b border-slate-700/50 hover:bg-slate-800/40 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium text-slate-200">{entry.partnerName}</p>
              <p className="text-xs text-slate-500">{entry.projectName ?? entry.projectId.slice(0, 8)}</p>
            </div>
          </div>
        </td>
        <td className="py-3 px-4">
          <span className="text-xs text-slate-400">
            {TYPE_LABELS[entry.contributionType] ?? entry.contributionType}
          </span>
        </td>
        <td className="py-3 px-4 text-right">
          <span className="text-sm font-mono text-slate-200">{fmt(entry.amount)}</span>
        </td>
        <td className="py-3 px-4">
          <StatusBadge status={entry.verificationStatus} />
        </td>
        <td className="py-3 px-4 text-xs text-slate-500">
          {entry.verificationStatus === "disputed"
            ? fmtDate(entry.disputedAt)
            : entry.verificationStatus === "rejected"
            ? fmtDate(entry.verifiedAt)
            : fmtDate(entry.createdAt)}
        </td>
        {isAdminDev && (
          <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-1.5">
              {entry.verificationStatus === "verified" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10"
                  onClick={() => onDispute(entry)}
                >
                  <MessageSquareWarning className="w-3 h-3 mr-1" />
                  Dispute
                </Button>
              )}
              {entry.verificationStatus === "disputed" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => onResolve(entry, "re_verify")}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Re-Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                    onClick={() => onResolve(entry, "reject")}
                  >
                    <XCircle className="w-3 h-3 mr-1" />
                    Reject
                  </Button>
                </>
              )}
              {entry.verificationStatus === "pending_verification" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                    onClick={() => onVerify(entry)}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs border-orange-500/40 text-orange-400 hover:bg-orange-500/10"
                    onClick={() => onReject(entry)}
                  >
                    <XCircle className="w-3 h-3 mr-1" />
                    Reject
                  </Button>
                </>
              )}
              {entry.verificationStatus === "rejected" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                  onClick={() => onVerify(entry)}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Re-Verify
                </Button>
              )}
            </div>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="border-b border-slate-700/30 bg-slate-800/20">
          <td colSpan={isAdminDev ? 6 : 5} className="py-3 px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-slate-500 mb-0.5">Contribution Date</p>
                <p className="text-slate-300">{fmtDate(entry.contributionDate)}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Reference</p>
                <p className="text-slate-300">{entry.referenceNumber ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Recorded By</p>
                <p className="text-slate-300">{entry.recordedByName ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Affects Ownership</p>
                <p className={entry.affectsOwnership ? "text-emerald-400" : "text-slate-400"}>
                  {entry.affectsOwnership ? "Yes" : "No"}
                </p>
              </div>
              {entry.remarks && (
                <div className="col-span-2">
                  <p className="text-slate-500 mb-0.5">Remarks</p>
                  <p className="text-slate-300">{entry.remarks}</p>
                </div>
              )}
              {entry.verificationStatus === "disputed" && entry.disputeNotes && (
                <div className="col-span-2 p-2 rounded bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 font-medium mb-0.5">Dispute Reason</p>
                  <p className="text-slate-300">{entry.disputeNotes}</p>
                  <p className="text-slate-500 mt-1">Raised by {entry.disputedByName ?? "—"} on {fmtDate(entry.disputedAt)}</p>
                </div>
              )}
              {(entry.verificationStatus === "rejected" || entry.verificationStatus === "verified") && entry.verifierNotes && (
                <div className="col-span-2">
                  <p className="text-slate-500 mb-0.5">Verifier Notes</p>
                  <p className="text-slate-300">{entry.verifierNotes}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── contribution table ───────────────────────────────────────────────────────

interface ContribTableProps {
  entries: ContributionEntry[];
  showActions: boolean;
  emptyMessage: string;
  onDispute: (entry: ContributionEntry) => void;
  onResolve: (entry: ContributionEntry, action: "re_verify" | "reject") => void;
  onVerify: (entry: ContributionEntry) => void;
  onReject: (entry: ContributionEntry) => void;
}

function ContribTable(props: ContribTableProps) {
  const { entries, showActions, emptyMessage } = props;

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
        <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-600/40" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-xs text-slate-500 uppercase tracking-wide">
            <th className="text-left py-2 px-4 font-medium">Partner / Project</th>
            <th className="text-left py-2 px-4 font-medium">Type</th>
            <th className="text-right py-2 px-4 font-medium">Amount</th>
            <th className="text-left py-2 px-4 font-medium">Status</th>
            <th className="text-left py-2 px-4 font-medium">Date</th>
            {showActions && <th className="text-left py-2 px-4 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <ContribRow key={entry.id} entry={entry} {...props} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── maturity block panel ────────────────────────────────────────────────────

function MaturityBlockPanel({
  blockedProjectIds,
  projects,
}: {
  blockedProjectIds: string[];
  projects: Array<{ id: string; name: string }>;
}) {
  if (blockedProjectIds.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/8 p-4">
      <div className="flex items-start gap-3">
        <Ban className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-red-400 mb-1.5">
            Maturity Declaration Blocked — {blockedProjectIds.length} Project{blockedProjectIds.length > 1 ? "s" : ""}
          </h3>
          <p className="text-xs text-slate-400 mb-3">
            The following projects cannot transition to Mature Production until all contribution disputes are resolved.
          </p>
          <div className="flex flex-wrap gap-2">
            {blockedProjectIds.map((pid) => {
              const proj = projects.find((p) => p.id === pid);
              return (
                <Link key={pid} to={`/projects/${pid}`}>
                  <Badge
                    variant="outline"
                    className="border-red-500/40 text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
                  >
                    <Ban className="w-3 h-3 mr-1" />
                    {proj?.name ?? pid.slice(0, 8)}
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Badge>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── raise dispute dialog ─────────────────────────────────────────────────────

interface RaiseDisputeDialogProps {
  entry: ContributionEntry | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function RaiseDisputeDialog({ entry, open, onOpenChange }: RaiseDisputeDialogProps) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const raiseMut = useRaiseContributionDispute();

  const handleSubmit = async () => {
    if (!entry) return;
    if (!notes.trim()) {
      setError("Please provide a reason for the dispute.");
      return;
    }
    try {
      await raiseMut.mutateAsync({ id: entry.id, data: { disputeNotes: notes.trim() } });
      await qc.invalidateQueries({ queryKey: getListContributionsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetContributionDisputeSummaryQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetGovernanceSummaryQueryKey() });
      setNotes("");
      setError(null);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to raise dispute");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setNotes(""); setError(null); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <MessageSquareWarning className="w-5 h-5" />
            Raise Contribution Dispute
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            This will mark the contribution as disputed and raise a governance alert. The project will be blocked from
            declaring maturity until this is resolved.
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="text-sm bg-slate-800 rounded p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Partner</span>
              <span className="text-slate-200 font-medium">{entry.partnerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Type</span>
              <span className="text-slate-200">{TYPE_LABELS[entry.contributionType] ?? entry.contributionType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Amount</span>
              <span className="text-slate-200 font-mono">{fmt(entry.amount)}</span>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-slate-300">Dispute Reason *</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe why this contribution is being disputed..."
            className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 resize-none"
            rows={3}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={raiseMut.isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {raiseMut.isPending ? "Raising..." : "Raise Dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── resolve dispute dialog ───────────────────────────────────────────────────

interface ResolveDisputeDialogProps {
  entry: ContributionEntry | null;
  action: "re_verify" | "reject" | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function ResolveDisputeDialog({ entry, action, open, onOpenChange }: ResolveDisputeDialogProps) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const resolveMut = useResolveContributionDispute();

  const handleSubmit = async () => {
    if (!entry || !action) return;
    try {
      await resolveMut.mutateAsync({ id: entry.id, data: { action, notes: notes.trim() || undefined } });
      await qc.invalidateQueries({ queryKey: getListContributionsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetContributionDisputeSummaryQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetGovernanceSummaryQueryKey() });
      setNotes("");
      setError(null);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resolve dispute");
    }
  };

  const isReVerify = action === "re_verify";

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setNotes(""); setError(null); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", isReVerify ? "text-emerald-400" : "text-orange-400")}>
            {isReVerify ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            {isReVerify ? "Re-Verify Contribution" : "Reject & Close Dispute"}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {isReVerify
              ? "This will mark the contribution as verified again, resolving the dispute and unblocking the project."
              : "This will reject the contribution and close the dispute. The project will be unblocked."}
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="text-sm bg-slate-800 rounded p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Partner</span>
              <span className="text-slate-200 font-medium">{entry.partnerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Amount</span>
              <span className="text-slate-200 font-mono">{fmt(entry.amount)}</span>
            </div>
            {entry.disputeNotes && (
              <div className="pt-1 border-t border-slate-700">
                <span className="text-red-400 text-xs">Dispute reason: </span>
                <span className="text-slate-300 text-xs">{entry.disputeNotes}</span>
              </div>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-slate-300">Resolution Notes (optional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any resolution notes..."
            className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 resize-none"
            rows={2}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={resolveMut.isPending}
            className={isReVerify ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
          >
            {resolveMut.isPending ? "Saving..." : isReVerify ? "Confirm Re-Verify" : "Confirm Rejection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── quick action dialog (verify/reject) ─────────────────────────────────────

interface QuickActionDialogProps {
  entry: ContributionEntry | null;
  action: "verify" | "reject" | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function QuickActionDialog({ entry, action, open, onOpenChange }: QuickActionDialogProps) {
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const verifyMut = useVerifyContribution();
  const rejectMut = useRejectContribution();

  const handleSubmit = async () => {
    if (!entry || !action) return;
    try {
      if (action === "verify") {
        await verifyMut.mutateAsync({ id: entry.id, data: { notes: notes.trim() || undefined } });
      } else {
        await rejectMut.mutateAsync({ id: entry.id, data: { notes: notes.trim() || undefined } });
      }
      await qc.invalidateQueries({ queryKey: getListContributionsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetContributionDisputeSummaryQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetGovernanceSummaryQueryKey() });
      setNotes("");
      setError(null);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  };

  const isVerify = action === "verify";

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setNotes(""); setError(null); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", isVerify ? "text-emerald-400" : "text-orange-400")}>
            {isVerify ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {isVerify ? "Verify Contribution" : "Reject Contribution"}
          </DialogTitle>
        </DialogHeader>
        {entry && (
          <div className="text-sm bg-slate-800 rounded p-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Partner</span>
              <span className="text-slate-200 font-medium">{entry.partnerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Amount</span>
              <span className="text-slate-200 font-mono">{fmt(entry.amount)}</span>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-slate-300">Notes (optional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            className="bg-slate-800 border-slate-600 text-slate-100 placeholder:text-slate-500 resize-none"
            rows={2}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={verifyMut.isPending || rejectMut.isPending}
            className={isVerify ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
          >
            {verifyMut.isPending || rejectMut.isPending ? "Saving..." : isVerify ? "Verify" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── resolution history panel ─────────────────────────────────────────────────

function ResolutionHistory({ allContributions }: { allContributions: ContributionEntry[] }) {
  const recentlyResolved = allContributions
    .filter((c) => c.verificationStatus === "verified" || c.verificationStatus === "rejected")
    .sort((a, b) => new Date(b.verifiedAt ?? b.updatedAt ?? b.createdAt).getTime() - new Date(a.verifiedAt ?? a.updatedAt ?? a.createdAt).getTime())
    .slice(0, 20);

  if (recentlyResolved.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-500">
        <Eye className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">No resolution history yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-1">
      {recentlyResolved.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border",
            entry.verificationStatus === "verified"
              ? "border-emerald-500/20 bg-emerald-500/5"
              : "border-orange-500/20 bg-orange-500/5",
          )}
        >
          <div className="mt-0.5 shrink-0">
            {entry.verificationStatus === "verified" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-orange-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-200 truncate">{entry.partnerName}</p>
              <span className="text-xs text-slate-500 shrink-0">{fmtDate(entry.verifiedAt)}</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {TYPE_LABELS[entry.contributionType] ?? entry.contributionType} · {fmt(entry.amount)}
            </p>
            {entry.verifierNotes && (
              <p className="text-xs text-slate-500 mt-1 italic">"{entry.verifierNotes}"</p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">
              {entry.verificationStatus === "verified" ? "Verified by" : "Rejected by"} {entry.verifiedByName ?? "—"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── main page ────────────────────────────────────────────────────────────────

export default function ContributionDisputeCenter() {
  const { role } = useRole();
  const isAdminDev = role === "admin" || role === "developer";

  const [disputeTarget, setDisputeTarget] = useState<ContributionEntry | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);

  const [resolveTarget, setResolveTarget] = useState<ContributionEntry | null>(null);
  const [resolveAction, setResolveAction] = useState<"re_verify" | "reject" | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  const [quickTarget, setQuickTarget] = useState<ContributionEntry | null>(null);
  const [quickAction, setQuickAction] = useState<"verify" | "reject" | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);

  const disputeSummaryQuery = useGetContributionDisputeSummary();
  const governanceQuery = useGetGovernanceSummary();
  const projectsQuery = useListProjects();
  const projects = (projectsQuery.data ?? []) as Array<{ id: string; name: string }>;

  const disputedQuery = useListContributions(
    { verificationStatus: "disputed" },
    { query: { queryKey: [...getListContributionsQueryKey(), "disputed"] } },
  );
  const pendingQuery = useListContributions(
    { verificationStatus: "pending_verification" },
    { query: { queryKey: [...getListContributionsQueryKey(), "pending"] } },
  );
  const rejectedQuery = useListContributions(
    { verificationStatus: "rejected" },
    { query: { queryKey: [...getListContributionsQueryKey(), "rejected"] } },
  );
  const allQuery = useListContributions({}, { query: { queryKey: [...getListContributionsQueryKey(), "all"] } });

  const disputed = (disputedQuery.data ?? []) as ContributionEntry[];
  const pending = (pendingQuery.data ?? []) as ContributionEntry[];
  const rejected = (rejectedQuery.data ?? []) as ContributionEntry[];
  const all = (allQuery.data ?? []) as ContributionEntry[];

  const summary = disputeSummaryQuery.data;
  const governance = governanceQuery.data;

  const disputedGovernanceAlerts = governance?.projectAlerts?.flatMap((p) =>
    p.issues.filter((i) => i.code === "DISPUTED_CONTRIBUTION").map((i) => ({ ...i, projectName: p.projectName }))
  ) ?? [];
  const pendingGovernanceAlerts = governance?.projectAlerts?.flatMap((p) =>
    p.issues.filter((i) => i.code === "PENDING_CONTRIBUTIONS").map((i) => ({ ...i, projectName: p.projectName }))
  ) ?? [];

  const handleDispute = (entry: ContributionEntry) => {
    setDisputeTarget(entry);
    setDisputeOpen(true);
  };
  const handleResolve = (entry: ContributionEntry, action: "re_verify" | "reject") => {
    setResolveTarget(entry);
    setResolveAction(action);
    setResolveOpen(true);
  };
  const handleVerify = (entry: ContributionEntry) => {
    setQuickTarget(entry);
    setQuickAction("verify");
    setQuickOpen(true);
  };
  const handleReject = (entry: ContributionEntry) => {
    setQuickTarget(entry);
    setQuickAction("reject");
    setQuickOpen(true);
  };

  const tableProps = { showActions: isAdminDev, onDispute: handleDispute, onResolve: handleResolve, onVerify: handleVerify, onReject: handleReject };

  const isLoading = disputeSummaryQuery.isLoading || disputedQuery.isLoading || pendingQuery.isLoading;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <ShieldAlert className="w-6 h-6 text-red-400" />
          <h1 className="text-xl font-semibold text-slate-100">Contribution Dispute Centre</h1>
        </div>
        <p className="text-sm text-slate-400">
          Manage contribution disputes, pending verifications, and resolution history.
          Unresolved disputes block projects from declaring maturity.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <Card className="bg-slate-800/60 border-red-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-1">Disputed</p>
                <p className="text-2xl font-bold text-red-400">{isLoading ? "—" : (summary?.totalDisputed ?? disputed.length)}</p>
                <p className="text-xs text-slate-500 mt-0.5">Active disputes</p>
              </div>
              <MessageSquareWarning className="w-5 h-5 text-red-400/60 mt-0.5" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-amber-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-1">Pending Verification</p>
                <p className="text-2xl font-bold text-amber-400">{isLoading ? "—" : (summary?.totalPending ?? pending.length)}</p>
                <p className="text-xs text-slate-500 mt-0.5">Awaiting review</p>
              </div>
              <Clock className="w-5 h-5 text-amber-400/60 mt-0.5" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/60 border-orange-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-1">Rejected</p>
                <p className="text-2xl font-bold text-orange-400">{isLoading ? "—" : (summary?.totalRejected ?? rejected.length)}</p>
                <p className="text-xs text-slate-500 mt-0.5">Need resolution</p>
              </div>
              <XCircle className="w-5 h-5 text-orange-400/60 mt-0.5" />
            </div>
          </CardContent>
        </Card>
        <Card className={cn("bg-slate-800/60", (summary?.blockedProjectIds?.length ?? 0) > 0 ? "border-red-500/50" : "border-slate-600/30")}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-400 mb-1">Maturity Blocked</p>
                <p className={cn("text-2xl font-bold", (summary?.blockedProjectIds?.length ?? 0) > 0 ? "text-red-400" : "text-slate-400")}>
                  {isLoading ? "—" : (summary?.blockedProjectIds?.length ?? 0)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Projects blocked</p>
              </div>
              <Ban className={cn("w-5 h-5 mt-0.5", (summary?.blockedProjectIds?.length ?? 0) > 0 ? "text-red-400/60" : "text-slate-500")} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* maturity block banner */}
      {(summary?.blockedProjectIds?.length ?? 0) > 0 && (
        <MaturityBlockPanel blockedProjectIds={summary!.blockedProjectIds} projects={projects} />
      )}

      {/* governance alert summary */}
      {(disputedGovernanceAlerts.length > 0 || pendingGovernanceAlerts.length > 0) && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {disputedGovernanceAlerts.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold text-red-400">Dispute Governance Alerts</span>
              </div>
              <div className="space-y-1.5">
                {disputedGovernanceAlerts.map((a, i) => (
                  <div key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                    <span className="text-red-400 shrink-0">•</span>
                    <span><strong>{a.projectName}</strong>: {a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {pendingGovernanceAlerts.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-400">Pending Verification Alerts</span>
              </div>
              <div className="space-y-1.5">
                {pendingGovernanceAlerts.map((a, i) => (
                  <div key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                    <span className="text-amber-400 shrink-0">•</span>
                    <span><strong>{a.projectName}</strong>: {a.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* main tabs */}
      <Card className="bg-slate-800/40 border-slate-700/60">
        <CardHeader className="pb-0 pt-4 px-4">
          <Tabs defaultValue="disputed">
            <TabsList className="bg-slate-800/80 border border-slate-700/50">
              <TabsTrigger value="disputed" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-300">
                <MessageSquareWarning className="w-3.5 h-3.5 mr-1.5" />
                Disputed
                {disputed.length > 0 && (
                  <Badge className="ml-1.5 bg-red-500 text-white text-[10px] px-1 py-0 h-4">{disputed.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="pending" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
                <Clock className="w-3.5 h-3.5 mr-1.5" />
                Pending Verification
                {pending.length > 0 && (
                  <Badge className="ml-1.5 bg-amber-500 text-white text-[10px] px-1 py-0 h-4">{pending.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="rejected" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300">
                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                Rejected
                {rejected.length > 0 && (
                  <Badge className="ml-1.5 bg-orange-500 text-white text-[10px] px-1 py-0 h-4">{rejected.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="resolved" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Resolution History
              </TabsTrigger>
            </TabsList>

            <Separator className="bg-slate-700/50 mt-3 -mx-4" />

            <TabsContent value="disputed" className="mt-0 pt-0">
              <ContribTable
                entries={disputed}
                emptyMessage="No disputed contributions — all clear."
                {...tableProps}
              />
            </TabsContent>

            <TabsContent value="pending" className="mt-0 pt-0">
              <ContribTable
                entries={pending}
                emptyMessage="No contributions pending verification."
                {...tableProps}
              />
            </TabsContent>

            <TabsContent value="rejected" className="mt-0 pt-0">
              <ContribTable
                entries={rejected}
                emptyMessage="No rejected contributions."
                {...tableProps}
              />
            </TabsContent>

            <TabsContent value="resolved" className="mt-0 pt-4 px-2">
              <ResolutionHistory allContributions={all} />
            </TabsContent>
          </Tabs>
        </CardHeader>
        <CardContent className="pb-0" />
      </Card>

      {/* dialogs */}
      <RaiseDisputeDialog
        entry={disputeTarget}
        open={disputeOpen}
        onOpenChange={setDisputeOpen}
      />
      <ResolveDisputeDialog
        entry={resolveTarget}
        action={resolveAction}
        open={resolveOpen}
        onOpenChange={setResolveOpen}
      />
      <QuickActionDialog
        entry={quickTarget}
        action={quickAction}
        open={quickOpen}
        onOpenChange={setQuickOpen}
      />
    </div>
  );
}
