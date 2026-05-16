import { useState, useEffect } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListPostMaturityPayments,
  useCreatePostMaturityPayment,
  useApprovePostMaturityPayment,
  useSettlePostMaturityPayment,
  useRejectPostMaturityPayment,
  useGetPostMaturityPaymentBalance,
  useListProjects,
  useListOnboardingParticipants,
  getListOnboardingParticipantsQueryKey,
  getListPostMaturityPaymentsQueryKey,
  getGetPostMaturityPaymentBalanceQueryKey,
} from "@workspace/api-client-react";
import type {
  PostMaturityCostPayment,
  Project,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Banknote,
  ShieldCheck,
  Filter,
  Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORY_LABELS: Record<string, string> = {
  operational_funding: "Operational Funding",
  maintenance_support: "Maintenance Support",
  emergency_expense: "Emergency Expense",
  project_settlement: "Project Settlement",
  other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-blue-100 text-blue-800 border-blue-200",
  settled: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  settled: "Settled",
  rejected: "Rejected",
};

function fmt(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default function PostMaturityPayments() {
  const { role } = useRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isAdminOrDev = role === "admin" || role === "developer";

  const [filterProjectId, setFilterProjectId] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [actionPayment, setActionPayment] = useState<PostMaturityCostPayment | null>(null);
  const [actionType, setActionType] = useState<"approve" | "settle" | "reject" | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [form, setForm] = useState({
    projectId: "",
    partnerName: "",
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    description: "",
    category: "operational_funding",
    referenceNumber: "",
    remarks: "",
  });
  const [createLoading, setCreateLoading] = useState(false);

  const projectsData = useListProjects();
  const projects: Project[] = projectsData.data ?? [];
  const matureProjects = projects.filter(
    (p) => p.lifecycleStatus === "mature_production" && p.isActive,
  );

  // ── Project-scoped participant list for the create form ─────────────────
  const formParticipantProjectId = form.projectId || "00000000-0000-0000-0000-000000000000";
  const { data: formParticipantsData } = useListOnboardingParticipants(
    formParticipantProjectId,
    {
      query: {
        enabled: showCreate && !!form.projectId,
        queryKey: getListOnboardingParticipantsQueryKey(formParticipantProjectId),
      },
    },
  );
  const formParticipants = formParticipantsData?.participants ?? [];

  // Reset paying party when project changes
  useEffect(() => {
    if (showCreate) setForm((f) => ({ ...f, partnerName: "" }));
  }, [form.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const listParams = {
    ...(filterProjectId ? { projectId: filterProjectId } : {}),
    ...(filterStatus ? { reimbursementStatus: filterStatus } : {}),
  };

  const { data: listData, isLoading } = useListPostMaturityPayments(
    Object.keys(listParams).length ? listParams : undefined,
  );
  const payments = listData?.payments ?? [];

  const balanceParams = filterProjectId ? { projectId: filterProjectId } : undefined;
  const { data: balanceData } = useGetPostMaturityPaymentBalance(balanceParams);
  const totals = balanceData?.totals;
  const balances = balanceData?.balances ?? [];

  const createMutation = useCreatePostMaturityPayment();
  const approveMutation = useApprovePostMaturityPayment();
  const settleMutation = useSettlePostMaturityPayment();
  const rejectMutation = useRejectPostMaturityPayment();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListPostMaturityPaymentsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPostMaturityPaymentBalanceQueryKey() });
  }

  async function handleCreate() {
    if (
      !form.projectId ||
      !form.partnerName ||
      !form.amount ||
      !form.paymentDate ||
      !form.description ||
      !form.category
    ) {
      toast({
        title: "Missing fields",
        description: "Please fill all required fields.",
        variant: "destructive",
      });
      return;
    }
    setCreateLoading(true);
    try {
      await createMutation.mutateAsync({
        data: {
          projectId: form.projectId,
          partnerName: form.partnerName,
          amount: Number(form.amount),
          paymentDate: form.paymentDate,
          description: form.description,
          category: form.category as PostMaturityCostPayment["category"],
          ...(form.referenceNumber ? { referenceNumber: form.referenceNumber } : {}),
          ...(form.remarks ? { remarks: form.remarks } : {}),
        },
      });
      toast({
        title: "Payment recorded",
        description: "The post-maturity cost payment has been recorded.",
      });
      setShowCreate(false);
      setForm({
        projectId: "",
        partnerName: "",
        amount: "",
        paymentDate: new Date().toISOString().split("T")[0],
        description: "",
        category: "operational_funding",
        referenceNumber: "",
        remarks: "",
      });
      invalidate();
    } catch {
      toast({
        title: "Error",
        description: "Failed to record payment.",
        variant: "destructive",
      });
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleAction() {
    if (!actionPayment || !actionType) return;
    setActionLoading(true);
    try {
      if (actionType === "approve") {
        await approveMutation.mutateAsync({
          id: actionPayment.id,
          data: { ...(actionNote ? { approvalNotes: actionNote } : {}) },
        });
        toast({ title: "Approved", description: "Payment approved for reimbursement." });
      } else if (actionType === "settle") {
        await settleMutation.mutateAsync({
          id: actionPayment.id,
          data: { ...(actionNote ? { settlementNote: actionNote } : {}) },
        });
        toast({ title: "Settled", description: "Payment marked as fully reimbursed." });
      } else if (actionType === "reject") {
        await rejectMutation.mutateAsync({
          id: actionPayment.id,
          data: { ...(actionNote ? { rejectionReason: actionNote } : {}) },
        });
        toast({ title: "Rejected", description: "Reimbursement claim rejected." });
      }
      setActionPayment(null);
      setActionType(null);
      setActionNote("");
      invalidate();
    } catch {
      toast({
        title: "Error",
        description: "Action failed.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Post-Maturity Cost Payments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track reimbursable payments made after maturity declaration. These payments do not
            affect ownership or equity.
          </p>
        </div>
        {isAdminOrDev && (
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Record Payment
          </Button>
        )}
      </div>

      {/* Important notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">
            Post-Maturity Payments Are Non-Equity
          </p>
          <p className="text-sm text-amber-700 mt-0.5">
            Payments recorded here are <strong>reimbursable project cost advances</strong> — they
            never create ownership rights, alter crystallized ownership percentages, or affect
            participant shares. Only projects in the mature production phase can have payments
            recorded here.
          </p>
        </div>
      </div>

      {/* Balance summary */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Total Recorded", value: totals.total, color: "text-gray-900" },
            { label: "Pending", value: totals.pending, color: "text-yellow-700" },
            { label: "Approved", value: totals.approved, color: "text-blue-700" },
            { label: "Settled", value: totals.settled, color: "text-green-700" },
            { label: "Rejected", value: totals.rejected, color: "text-red-700" },
          ].map((item) => (
            <Card key={item.label} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                  {item.label}
                </p>
                <p className={`text-lg font-bold mt-1 ${item.color}`}>{fmt(item.value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Per-project breakdown */}
      {!filterProjectId && balances.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-700">By Project</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {balances.map((b) => (
                <div
                  key={b.projectId}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <span className="text-sm font-medium text-gray-800">
                    {b.projectName ?? b.projectId}
                  </span>
                  <div className="flex gap-4 text-sm">
                    <span className="text-yellow-700">{fmt(b.pending)} pending</span>
                    <span className="text-blue-700">{fmt(b.approved)} approved</span>
                    <span className="text-green-700">{fmt(b.settled)} settled</span>
                    <span className="font-semibold">{fmt(b.total)} total</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Filter className="w-4 h-4 text-gray-400" />
        <Select
          value={filterProjectId || "__all"}
          onValueChange={(v) => setFilterProjectId(v === "__all" ? "" : v)}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filterStatus || "__all"}
          onValueChange={(v) => setFilterStatus(v === "__all" ? "" : v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Payments table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading payments…</div>
          ) : payments.length === 0 ? (
            <div className="p-8 text-center">
              <Banknote className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No post-maturity payments recorded yet.</p>
              {isAdminOrDev && matureProjects.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Payments can only be recorded for projects in the mature production phase.
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Paid By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdminOrDev && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium text-sm">
                      {p.projectName ?? p.projectId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{p.partnerName}</TableCell>
                    <TableCell className="text-sm text-gray-600">{p.paymentDate}</TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                        {CATEGORY_LABELS[p.category] ?? p.category}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-gray-700 max-w-xs truncate">
                      {p.description}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">
                      {fmt(p.amount)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.reimbursementStatus} />
                    </TableCell>
                    {isAdminOrDev && (
                      <TableCell>
                        <div className="flex gap-1">
                          {p.reimbursementStatus === "pending" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-blue-700 border-blue-200"
                                onClick={() => {
                                  setActionPayment(p);
                                  setActionType("approve");
                                  setActionNote("");
                                }}
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-red-700 border-red-200"
                                onClick={() => {
                                  setActionPayment(p);
                                  setActionType("reject");
                                  setActionNote("");
                                }}
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                          {p.reimbursementStatus === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-green-700 border-green-200"
                              onClick={() => {
                                setActionPayment(p);
                                setActionType("settle");
                                setActionNote("");
                              }}
                            >
                              <ShieldCheck className="w-3 h-3 mr-1" />
                              Settle
                            </Button>
                          )}
                          {(p.reimbursementStatus === "settled" ||
                            p.reimbursementStatus === "rejected") && (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {p.reimbursementStatus === "settled" ? "Reimbursed" : "Closed"}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Post-Maturity Cost Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
              This payment will be recorded as a{" "}
              <strong>reimbursable project cost advance</strong>. It will not affect ownership
              percentages or equity.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Project (must be in mature production) *</Label>
                <Select
                  value={form.projectId}
                  onValueChange={(v) => setForm((f) => ({ ...f, projectId: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select project…" />
                  </SelectTrigger>
                  <SelectContent>
                    {matureProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {matureProjects.length === 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    No projects are currently in mature production phase.
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                  Paying Party <span className="text-red-500">*</span>
                </Label>
                {!form.projectId ? (
                  <p className="text-xs text-gray-400 mt-1 italic">Select a project above first.</p>
                ) : formParticipants.length === 0 ? (
                  <div className="mt-1 rounded border border-dashed border-gray-300 p-2 text-center">
                    <p className="text-xs text-gray-500">No KYC participants linked to this project yet.</p>
                    <p className="text-xs text-gray-400">Add participants via the Project Onboarding module first.</p>
                  </div>
                ) : (
                  <Select
                    value={form.partnerName}
                    onValueChange={(v) => setForm((f) => ({ ...f, partnerName: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select participant…" />
                    </SelectTrigger>
                    <SelectContent>
                      {formParticipants.map((p) => (
                        <SelectItem key={p.id} value={p.fullName}>
                          <div className="flex flex-col">
                            <span>{p.fullName}</span>
                            <span className="text-xs text-muted-foreground capitalize">{p.role}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>Amount (INR) *</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>Payment Date *</Label>
                <Input
                  className="mt-1"
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <Label>Category *</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Description *</Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of what this payment covers…"
                />
              </div>
              <div>
                <Label>Reference Number</Label>
                <Input
                  className="mt-1"
                  value={form.referenceNumber}
                  onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="Voucher / transaction ID"
                />
              </div>
              <div>
                <Label>Remarks</Label>
                <Input
                  className="mt-1"
                  value={form.remarks}
                  onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                  placeholder="Optional notes"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createLoading || matureProjects.length === 0}
            >
              {createLoading ? "Recording…" : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action dialog */}
      <Dialog
        open={!!actionPayment}
        onOpenChange={(o) => {
          if (!o) {
            setActionPayment(null);
            setActionType(null);
            setActionNote("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve"
                ? "Approve Payment"
                : actionType === "settle"
                  ? "Mark as Settled"
                  : "Reject Claim"}
            </DialogTitle>
          </DialogHeader>
          {actionPayment && (
            <div className="space-y-3 py-2">
              <div className="bg-gray-50 rounded p-3 text-sm">
                <p className="font-semibold">{actionPayment.partnerName}</p>
                <p className="text-gray-600">
                  {fmt(actionPayment.amount)} —{" "}
                  {CATEGORY_LABELS[actionPayment.category] ?? actionPayment.category}
                </p>
                <p className="text-gray-500 text-xs mt-1">{actionPayment.description}</p>
              </div>
              <div>
                <Label>
                  {actionType === "approve"
                    ? "Approval Notes"
                    : actionType === "settle"
                      ? "Settlement Note"
                      : "Rejection Reason"}
                </Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder={
                    actionType === "reject" ? "Reason for rejection…" : "Optional note…"
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActionPayment(null);
                setActionType(null);
                setActionNote("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAction}
              disabled={actionLoading}
              variant={actionType === "reject" ? "destructive" : "default"}
            >
              {actionLoading
                ? "Processing…"
                : actionType === "approve"
                  ? "Approve"
                  : actionType === "settle"
                    ? "Mark Settled"
                    : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
