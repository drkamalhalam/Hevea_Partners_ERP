/**
 * OwnershipTransfers.tsx
 *
 * Ownership Share Transfer Request Workflow.
 *
 * Rules enforced (UI-side validation mirrors server):
 *   - Project must be in mature_production lifecycle
 *   - Third-party transfers require ROFR completion first
 *   - Third-party minimum offered value: ₹1,00,000
 *   - Partial transfers allowed
 *   - Execution is explicit admin action only (no silent modification)
 *
 * Views:
 *   1. Transfer list (all + filters)
 *   2. Pending dashboard (admin/developer only)
 *   3. New transfer wizard
 *   4. Transfer detail (status timeline, ROFR, actions)
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListOwnershipTransfers,
  useCreateOwnershipTransfer,
  useUpdateOwnershipTransfer,
  useGetOwnershipTransfer,
  useGetOwnershipTransferDashboard,
  useSubmitOwnershipTransfer,
  useRecordRofrResponse,
  useFinalizeRofr,
  useApproveOwnershipTransfer,
  useExecuteOwnershipTransfer,
  useCancelOwnershipTransfer,
  useListProjects,
  useListPartners,
  useListOwnershipSnapshots,
  getListOwnershipTransfersQueryKey,
  getGetOwnershipTransferQueryKey,
  getGetOwnershipTransferDashboardQueryKey,
  getListOwnershipSnapshotsQueryKey,
} from "@workspace/api-client-react";
import type { OwnershipTransfer } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeftRight,
  Plus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Users,
  ShieldCheck,
  Ban,
  RefreshCw,
  Eye,
  Info,
  Percent,
  IndianRupee,
  ArrowRight,
  Lock,
  Unlock,
  LayoutDashboard,
  ListFilter,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Mode = "list" | "dashboard" | "new" | "detail";
type WizardStep = 1 | 2 | 3 | 4;

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_rofr: "ROFR Pending",
  rofr_accepted: "ROFR Accepted",
  rofr_rejected: "ROFR Rejected",
  pending_approval: "Pending Approval",
  approved: "Approved",
  executed: "Executed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-700 text-slate-300",
  pending_rofr: "bg-amber-900/60 text-amber-300 border border-amber-700/40",
  rofr_accepted: "bg-emerald-900/60 text-emerald-300 border border-emerald-700/40",
  rofr_rejected: "bg-red-900/60 text-red-300 border border-red-700/40",
  pending_approval: "bg-yellow-900/60 text-yellow-200 border border-yellow-700/40",
  approved: "bg-blue-900/60 text-blue-300 border border-blue-700/40",
  executed: "bg-emerald-900 text-emerald-200 border border-emerald-600/40",
  cancelled: "bg-slate-800 text-slate-500",
  expired: "bg-slate-800 text-slate-500",
};

const TERMINAL = new Set(["executed", "cancelled", "expired"]);

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[status] ?? "bg-slate-700 text-slate-300"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${type === "third_party" ? "bg-purple-900/60 text-purple-300 border border-purple-700/40" : "bg-sky-900/60 text-sky-300 border border-sky-700/40"}`}>
      {type === "third_party" ? "Third Party" : "Internal"}
    </span>
  );
}

function fmt(pct: string | number | null | undefined) {
  if (pct == null) return "—";
  return `${parseFloat(String(pct)).toFixed(4)}%`;
}
function fmtInr(val: string | number | null | undefined) {
  if (val == null) return "—";
  const n = parseFloat(String(val));
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

// ── Status timeline steps ─────────────────────────────────────────────────

const INTERNAL_STEPS = ["draft", "pending_approval", "approved", "executed"];
const THIRD_PARTY_STEPS = ["draft", "pending_rofr", "rofr_rejected", "pending_approval", "approved", "executed"];

function StatusTimeline({ transfer }: { transfer: OwnershipTransfer }) {
  const steps = transfer.transferType === "third_party" ? THIRD_PARTY_STEPS : INTERNAL_STEPS;
  const currentIdx = steps.indexOf(transfer.status);
  const isCancelled = transfer.status === "cancelled" || transfer.status === "expired";

  return (
    <div className="flex items-center gap-0 flex-wrap">
      {steps.map((step, i) => {
        const past = currentIdx > i;
        const current = currentIdx === i && !isCancelled;
        const future = currentIdx < i;
        return (
          <div key={step} className="flex items-center">
            <div className={`flex flex-col items-center`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2
                ${past ? "bg-emerald-600 border-emerald-500 text-white" : ""}
                ${current ? "bg-blue-600 border-blue-400 text-white animate-pulse" : ""}
                ${future ? "bg-slate-800 border-slate-600 text-slate-500" : ""}
                ${isCancelled ? "bg-red-900/40 border-red-700 text-red-400" : ""}
              `}>
                {past ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-[10px] mt-0.5 whitespace-nowrap
                ${past ? "text-emerald-400" : ""}
                ${current ? "text-blue-300 font-semibold" : ""}
                ${future ? "text-slate-600" : ""}
              `}>
                {STATUS_LABEL[step]}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 mb-3 ${past ? "bg-emerald-600" : "bg-slate-700"}`} />
            )}
          </div>
        );
      })}
      {isCancelled && (
        <div className="ml-3 flex items-center gap-1 text-red-400 text-xs">
          <Ban className="w-3 h-3" /> {STATUS_LABEL[transfer.status]}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function OwnershipTransfers() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdminDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";

  const [mode, setMode] = useState<Mode>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);

  // Wizard form state
  const [wProjectId, setWProjectId] = useState("");
  const [wTransferorId, setWTransferorId] = useState("");
  const [wPct, setWPct] = useState("");
  const [wValue, setWValue] = useState("");
  const [wType, setWType] = useState<"internal" | "third_party">("internal");
  const [wBuyerPartnerId, setWBuyerPartnerId] = useState("");
  const [wBuyerName, setWBuyerName] = useState("");
  const [wBuyerContact, setWBuyerContact] = useState("");
  const [wReason, setWReason] = useState("");
  const [wSnapshotId, setWSnapshotId] = useState("");

  // Action dialogs
  const [showSubmit, setShowSubmit] = useState(false);
  const [skipRofr, setSkipRofr] = useState(false);
  const [showRofr, setShowRofr] = useState(false);
  const [rofrPartnerId, setRofrPartnerId] = useState("");
  const [rofrPartnerName, setRofrPartnerName] = useState("");
  const [rofrResponse, setRofrResponse] = useState<"accepted" | "rejected">("rejected");
  const [rofrNotes, setRofrNotes] = useState("");
  const [showFinalizeRofr, setShowFinalizeRofr] = useState(false);
  const [finalRofrOutcome, setFinalRofrOutcome] = useState<"rofr_accepted" | "rofr_rejected">("rofr_rejected");
  const [finalRofrNotes, setFinalRofrNotes] = useState("");
  const [showApprove, setShowApprove] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");
  const [showExecute, setShowExecute] = useState(false);
  const [executeNotes, setExecuteNotes] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionError, setActionError] = useState("");

  // Data fetches
  const { data: projectsData } = useListProjects();
  const projects = projectsData ?? [];

  const { data: partnersData } = useListPartners();
  const partners = useMemo(() => (partnersData as any)?.partners ?? [], [partnersData]);

  const listQuery = useListOwnershipTransfers(
    {
      projectId: filterProject === "all" ? undefined : filterProject,
      status: filterStatus === "all" ? undefined : filterStatus,
    },
    { query: { enabled: mode === "list", queryKey: getListOwnershipTransfersQueryKey({ projectId: filterProject === "all" ? undefined : filterProject, status: filterStatus === "all" ? undefined : filterStatus }) } },
  );
  const transfers: OwnershipTransfer[] = (listQuery.data as any)?.transfers ?? [];

  const dashQuery = useGetOwnershipTransferDashboard({
    query: { enabled: mode === "dashboard" && isAdminDev, queryKey: getGetOwnershipTransferDashboardQueryKey() },
  });
  const dashboard = dashQuery.data as any;

  const detailQuery = useGetOwnershipTransfer(
    selectedId ?? "",
    { query: { enabled: mode === "detail" && !!selectedId, queryKey: getGetOwnershipTransferQueryKey(selectedId ?? "") } },
  );
  const detail = detailQuery.data as OwnershipTransfer | undefined;

  const snapshotsQuery = useListOwnershipSnapshots(
    wProjectId,
    {},
    { query: { enabled: mode === "new" && !!wProjectId, queryKey: getListOwnershipSnapshotsQueryKey(wProjectId, {}) } },
  );
  const snapshots = useMemo(() => (snapshotsQuery.data as any)?.snapshots ?? [], [snapshotsQuery.data]);

  // Mutations
  const createMut = useCreateOwnershipTransfer();
  const submitMut = useSubmitOwnershipTransfer();
  const rofrMut = useRecordRofrResponse();
  const finalizeRofrMut = useFinalizeRofr();
  const approveMut = useApproveOwnershipTransfer();
  const executeMut = useExecuteOwnershipTransfer();
  const cancelMut = useCancelOwnershipTransfer();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListOwnershipTransfersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetOwnershipTransferDashboardQueryKey() });
    if (selectedId) qc.invalidateQueries({ queryKey: getGetOwnershipTransferQueryKey(selectedId) });
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setMode("detail");
    setActionError("");
  }

  function resetWizard() {
    setWizardStep(1);
    setWProjectId(""); setWTransferorId(""); setWPct(""); setWValue("");
    setWType("internal"); setWBuyerPartnerId(""); setWBuyerName("");
    setWBuyerContact(""); setWReason(""); setWSnapshotId("");
    setActionError("");
  }

  // ── Wizard submit ──────────────────────────────────────────────────────

  async function handleCreate() {
    setActionError("");
    const pct = parseFloat(wPct);
    if (!wProjectId || !wTransferorId || isNaN(pct) || pct <= 0 || !wBuyerName) {
      setActionError("Please fill all required fields.");
      return;
    }
    if (wType === "third_party" && (!wValue || parseFloat(wValue) < 100000)) {
      setActionError("Third-party transfers require an offered value of at least ₹1,00,000.");
      return;
    }
    try {
      const created = await createMut.mutateAsync({
        data: {
          projectId: wProjectId,
          transferorPartnerId: wTransferorId,
          offeredPercentage: pct,
          offeredValue: wValue ? parseFloat(wValue) : undefined,
          transferType: wType,
          buyerPartnerId: wType === "internal" && wBuyerPartnerId ? wBuyerPartnerId : undefined,
          buyerName: wBuyerName,
          buyerContact: wBuyerContact || undefined,
          reason: wReason || undefined,
          linkedSnapshotId: wSnapshotId || undefined,
        },
      });
      invalidate();
      resetWizard();
      openDetail((created as any).id);
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to create transfer request.");
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!selectedId) return;
    setActionError("");
    try {
      await submitMut.mutateAsync({ id: selectedId, data: { skipRofr } });
      invalidate();
      setShowSubmit(false);
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to submit.");
    }
  }

  async function handleRofrResponse() {
    if (!selectedId || !rofrPartnerId || !rofrPartnerName) return;
    setActionError("");
    try {
      await rofrMut.mutateAsync({
        id: selectedId,
        data: { partnerId: rofrPartnerId, partnerName: rofrPartnerName, response: rofrResponse, notes: rofrNotes || undefined },
      });
      invalidate();
      setShowRofr(false);
      setRofrPartnerId(""); setRofrPartnerName(""); setRofrNotes("");
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to record ROFR response.");
    }
  }

  async function handleFinalizeRofr() {
    if (!selectedId) return;
    setActionError("");
    try {
      await finalizeRofrMut.mutateAsync({
        id: selectedId,
        data: { outcome: finalRofrOutcome, notes: finalRofrNotes || undefined },
      });
      invalidate();
      setShowFinalizeRofr(false);
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to finalize ROFR.");
    }
  }

  async function handleApprove() {
    if (!selectedId) return;
    setActionError("");
    try {
      await approveMut.mutateAsync({ id: selectedId, data: { adminNotes: approveNotes || undefined } });
      invalidate();
      setShowApprove(false);
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to approve.");
    }
  }

  async function handleExecute() {
    if (!selectedId || !executeNotes.trim()) return;
    setActionError("");
    try {
      await executeMut.mutateAsync({ id: selectedId, data: { executionNotes: executeNotes } });
      invalidate();
      setShowExecute(false);
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to execute.");
    }
  }

  async function handleCancel() {
    if (!selectedId || !cancelReason.trim()) return;
    setActionError("");
    try {
      await cancelMut.mutateAsync({ id: selectedId, data: { cancellationReason: cancelReason } });
      invalidate();
      setShowCancel(false);
    } catch (e: any) {
      setActionError(e?.response?.data?.error ?? "Failed to cancel.");
    }
  }

  // ── Wizard steps ───────────────────────────────────────────────────────

  const wizardCanNext = useMemo(() => {
    if (wizardStep === 1) return !!wProjectId && !!wTransferorId;
    if (wizardStep === 2) {
      const pct = parseFloat(wPct);
      if (isNaN(pct) || pct <= 0 || pct > 100) return false;
      if (wType === "third_party") {
        const v = parseFloat(wValue);
        if (isNaN(v) || v < 100000) return false;
      }
      return true;
    }
    if (wizardStep === 3) return !!wBuyerName;
    return true;
  }, [wizardStep, wProjectId, wTransferorId, wPct, wValue, wType, wBuyerName]);

  // ── Render: List ───────────────────────────────────────────────────────

  function renderList() {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Select value={filterProject} onValueChange={setFilterProject}>
              <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-56">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                <SelectItem value="all">All projects</SelectItem>
                {(projects as any[]).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-48">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {listQuery.isLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
          </div>
          {isAdminDev && (
            <Button size="sm" onClick={() => { resetWizard(); setMode("new"); }}
              className="bg-blue-700 hover:bg-blue-600 text-white gap-1.5">
              <Plus className="w-4 h-4" /> New Transfer
            </Button>
          )}
        </div>

        {transfers.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-20 text-center">
            <ArrowLeftRight className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-slate-500 text-sm">No transfer requests found.</p>
            {isAdminDev && (
              <p className="text-slate-600 text-xs mt-1">Ownership transfers are only available after a project reaches mature production.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {transfers.map((t) => (
              <button key={t.id} onClick={() => openDetail(t.id)}
                className="w-full text-left bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-slate-600 hover:bg-slate-900/80 transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <StatusBadge status={t.status} />
                      <TypeBadge type={t.transferType} />
                      <span className="text-slate-500 text-xs">{(t as any).projectName ?? t.projectId.slice(0, 8)}</span>
                    </div>
                    <p className="text-slate-200 text-sm font-medium">
                      {t.transferorName} <ArrowRight className="inline w-3 h-3 text-slate-500" /> {t.buyerName}
                    </p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {fmt(t.offeredPercentage)} of project stake
                      {t.offeredValue && ` · ${fmtInr(t.offeredValue)}`}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500 shrink-0">
                    {fmtDate(t.createdAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Render: Dashboard ─────────────────────────────────────────────────

  function renderDashboard() {
    if (!isAdminDev) return <p className="text-slate-500 text-sm">Access denied.</p>;
    const pending: OwnershipTransfer[] = dashboard?.pendingTransfers ?? [];
    const byStatus: Record<string, number> = dashboard?.byStatus ?? {};

    return (
      <div>
        {dashQuery.isLoading ? (
          <div className="flex items-center gap-2 text-slate-500 py-8"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {[
                { label: "ROFR Pending", key: "pending_rofr", color: "amber" },
                { label: "Pending Approval", key: "pending_approval", color: "yellow" },
                { label: "Approved", key: "approved", color: "blue" },
                { label: "Total Pending", key: "_total", color: "slate" },
              ].map(({ label, key, color }) => {
                const count = key === "_total" ? (dashboard?.totalPending ?? 0) : (byStatus[key] ?? 0);
                return (
                  <div key={key} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
                    <p className="text-2xl font-bold text-slate-100">{count}</p>
                    <p className="text-slate-400 text-xs mt-1">{label}</p>
                  </div>
                );
              })}
            </div>

            {pending.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-12 text-center">
                <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
                <p className="text-slate-400 text-sm">No pending transfer requests.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-slate-500 text-xs mb-2">Requires action</p>
                {pending.map((t) => (
                  <button key={t.id} onClick={() => openDetail(t.id)}
                    className="w-full text-left bg-slate-900/50 border border-slate-800 rounded-xl p-4 hover:border-slate-600 transition-all">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <StatusBadge status={t.status} />
                          <TypeBadge type={t.transferType} />
                        </div>
                        <p className="text-slate-200 text-sm font-medium">
                          {t.transferorName} → {t.buyerName}
                        </p>
                        <p className="text-slate-400 text-xs">{(t as any).projectName} · {fmt(t.offeredPercentage)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Render: Wizard ─────────────────────────────────────────────────────

  function renderWizard() {
    const projectPartners = partners.filter(() => true); // all partners (project-scope filtering is server-side)

    return (
      <div className="max-w-xl mx-auto">
        {/* Stepper */}
        <div className="flex items-center gap-0 mb-8">
          {[1, 2, 3, 4].map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2
                ${wizardStep > s ? "bg-emerald-600 border-emerald-500 text-white" : ""}
                ${wizardStep === s ? "bg-blue-600 border-blue-400 text-white" : ""}
                ${wizardStep < s ? "bg-slate-800 border-slate-600 text-slate-500" : ""}
              `}>
                {wizardStep > s ? <CheckCircle2 className="w-4 h-4" /> : s}
              </div>
              <span className={`text-[10px] ml-1 ${wizardStep === s ? "text-blue-300 font-medium" : "text-slate-600"}`}>
                {["Project & Transferor", "Offer Details", "Buyer", "Review"][i]}
              </span>
              {i < 3 && <div className={`h-0.5 w-8 mx-1 ${wizardStep > s ? "bg-emerald-600" : "bg-slate-700"}`} />}
            </div>
          ))}
        </div>

        {actionError && (
          <div className="mb-4 bg-red-950/60 border border-red-700/40 text-red-300 text-sm rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {actionError}
          </div>
        )}

        {/* Step 1: Project & Transferor */}
        {wizardStep === 1 && (
          <div className="space-y-4">
            <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-3 text-amber-300 text-xs flex items-start gap-2 mb-4">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              Ownership transfers are only permitted after a project has reached <strong>Mature Production</strong> lifecycle and ownership has been frozen.
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Project <span className="text-red-400">*</span></Label>
              <Select value={wProjectId} onValueChange={setWProjectId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  {(projects as any[]).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.lifecycleStatus !== "mature_production" && (
                        <span className="text-slate-500 ml-2 text-xs">({p.lifecycleStatus})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Transferor (Seller) <span className="text-red-400">*</span></Label>
              <Select value={wTransferorId} onValueChange={setWTransferorId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                  <SelectValue placeholder="Select transferor partner" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  {projectPartners.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-slate-500 text-xs">({p.role})</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {wProjectId && snapshots.length > 0 && (
              <div>
                <Label className="text-slate-300 mb-1 block">
                  Link Ownership Snapshot <span className="text-slate-500 text-xs">(optional — used to validate offered %)</span>
                </Label>
                <Select value={wSnapshotId} onValueChange={setWSnapshotId}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                    <SelectValue placeholder="No snapshot linked" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="__none__">No snapshot</SelectItem>
                    {snapshots.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.snapshotType} — {fmtDate(s.snapshotAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Offer Details */}
        {wizardStep === 2 && (
          <div className="space-y-4">
            <div>
              <Label className="text-slate-300 mb-1 block">Transfer Type <span className="text-red-400">*</span></Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: "internal", label: "Internal", desc: "To an existing registered partner. ROFR may be skipped." },
                  { value: "third_party", label: "Third Party", desc: "To an external buyer. ROFR is mandatory. Min ₹1L value." },
                ].map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => setWType(opt.value as "internal" | "third_party")}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${wType === opt.value ? "border-blue-500 bg-blue-950/40" : "border-slate-700 bg-slate-900/40 hover:border-slate-600"}`}>
                    <p className={`text-sm font-medium ${wType === opt.value ? "text-blue-300" : "text-slate-200"}`}>{opt.label}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">
                Offered Percentage <span className="text-red-400">*</span>
                <span className="text-slate-500 text-xs ml-2">(partial transfers allowed)</span>
              </Label>
              <div className="relative">
                <Input value={wPct} onChange={e => setWPct(e.target.value)} type="number" min="0.0001" max="100" step="0.0001"
                  placeholder="e.g. 15.5" className="bg-slate-900/60 border-slate-700 text-slate-100 pr-8" />
                <Percent className="absolute right-2.5 top-2.5 w-4 h-4 text-slate-500" />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">
                Offered Value (INR)
                {wType === "third_party" && <span className="text-red-400 ml-1">* min ₹1,00,000</span>}
              </Label>
              <div className="relative">
                <Input value={wValue} onChange={e => setWValue(e.target.value)} type="number" min="0" step="1"
                  placeholder={wType === "third_party" ? "Min ₹1,00,000" : "Optional"}
                  className="bg-slate-900/60 border-slate-700 text-slate-100 pl-8" />
                <IndianRupee className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-500" />
              </div>
              {wType === "third_party" && parseFloat(wValue) > 0 && parseFloat(wValue) < 100000 && (
                <p className="text-red-400 text-xs mt-1">Value must be at least ₹1,00,000 for third-party transfers.</p>
              )}
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Reason for Transfer <span className="text-slate-500 text-xs">(optional)</span></Label>
              <Textarea value={wReason} onChange={e => setWReason(e.target.value)} rows={2}
                placeholder="State your reason for the transfer..."
                className="bg-slate-900/60 border-slate-700 text-slate-100 placeholder:text-slate-600 resize-none" />
            </div>
          </div>
        )}

        {/* Step 3: Buyer */}
        {wizardStep === 3 && (
          <div className="space-y-4">
            {wType === "internal" && (
              <div>
                <Label className="text-slate-300 mb-1 block">Buyer Partner (existing) <span className="text-slate-500 text-xs">(optional)</span></Label>
                <Select value={wBuyerPartnerId} onValueChange={id => {
                  setWBuyerPartnerId(id);
                  const p = projectPartners.find((pp: any) => pp.id === id);
                  if (p) setWBuyerName((p as any).name);
                }}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                    <SelectValue placeholder="Select an existing partner" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="__none__">Not linked to partner record</SelectItem>
                    {projectPartners
                      .filter((p: any) => p.id !== wTransferorId)
                      .map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-slate-300 mb-1 block">Buyer Full Name <span className="text-red-400">*</span></Label>
              <Input value={wBuyerName} onChange={e => setWBuyerName(e.target.value)}
                placeholder="Full legal name of buyer"
                className="bg-slate-900/60 border-slate-700 text-slate-100" />
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Buyer Contact <span className="text-slate-500 text-xs">(phone / email, optional)</span></Label>
              <Input value={wBuyerContact} onChange={e => setWBuyerContact(e.target.value)}
                placeholder="Contact details"
                className="bg-slate-900/60 border-slate-700 text-slate-100" />
            </div>
            {wType === "third_party" && (
              <div className="bg-purple-950/30 border border-purple-700/30 rounded-lg p-3 text-purple-300 text-xs flex items-start gap-2">
                <Users className="w-4 h-4 shrink-0 mt-0.5" />
                Third-party transfer: All existing partners must be notified with Right of First Refusal (14-day window) before this transfer can be approved.
              </div>
            )}
          </div>
        )}

        {/* Step 4: Review */}
        {wizardStep === 4 && (
          <div className="space-y-3">
            <p className="text-slate-400 text-sm mb-3">Review transfer request before creating:</p>
            {[
              ["Project", (projects as any[]).find((p: any) => p.id === wProjectId)?.name],
              ["Transferor", projectPartners.find((p: any) => p.id === wTransferorId)?.name ?? wTransferorId],
              ["Transfer Type", wType === "third_party" ? "Third Party" : "Internal"],
              ["Offered %", fmt(wPct)],
              ["Offered Value", wValue ? fmtInr(wValue) : "Not specified"],
              ["Buyer", wBuyerName],
              ["Buyer Contact", wBuyerContact || "—"],
              ["Reason", wReason || "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-start justify-between gap-4 py-2 border-b border-slate-800/60">
                <span className="text-slate-500 text-sm shrink-0">{k}</span>
                <span className="text-slate-200 text-sm text-right">{v}</span>
              </div>
            ))}
            <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-slate-400 text-xs mt-3 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              The transfer will be saved as a <strong className="text-slate-300">Draft</strong>. No ownership modification occurs until an admin explicitly marks the transfer as executed.
            </div>
          </div>
        )}

        {/* Wizard footer */}
        <div className="flex items-center justify-between mt-8 pt-4 border-t border-slate-800">
          <Button variant="ghost" size="sm" className="text-slate-400 hover:text-slate-200"
            onClick={() => { if (wizardStep === 1) { setMode("list"); resetWizard(); } else setWizardStep(s => (s - 1) as WizardStep); }}>
            <ChevronLeft className="w-4 h-4 mr-1" /> {wizardStep === 1 ? "Cancel" : "Back"}
          </Button>
          {wizardStep < 4 ? (
            <Button size="sm" disabled={!wizardCanNext}
              onClick={() => setWizardStep(s => (s + 1) as WizardStep)}
              className="bg-blue-700 hover:bg-blue-600 text-white gap-1">
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleCreate}
              disabled={createMut.isPending}
              className="bg-emerald-700 hover:bg-emerald-600 text-white gap-1">
              {createMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Create Transfer Request
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Render: Detail ─────────────────────────────────────────────────────

  function renderDetail() {
    if (detailQuery.isLoading) {
      return <div className="flex items-center gap-2 text-slate-500 py-12"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</div>;
    }
    if (!detail) return <p className="text-slate-500 text-sm">Transfer not found.</p>;

    const isTerminal = TERMINAL.has(detail.status);
    const rofrResponses: any[] = (detail.rofrResponses as any) ?? [];
    const canSubmit = isAdminDev && detail.status === "draft";
    const canRecordRofr = isAdminDev && detail.status === "pending_rofr";
    const canFinalizeRofr = isAdminDev && ["pending_rofr", "rofr_accepted", "rofr_rejected"].includes(detail.status);
    const canApprove = isAdminDev && ["rofr_accepted", "rofr_rejected", "pending_approval"].includes(detail.status);
    const canExecute = isAdmin && detail.status === "approved";
    const canCancel = !isTerminal && (isAdminDev || detail.status === "draft");

    return (
      <div className="space-y-5">
        {actionError && (
          <div className="bg-red-950/60 border border-red-700/40 text-red-300 text-sm rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {actionError}
          </div>
        )}

        {/* Header card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <StatusBadge status={detail.status} />
                <TypeBadge type={detail.transferType} />
              </div>
              <h2 className="text-slate-100 font-semibold">
                {detail.transferorName} <ArrowRight className="inline w-4 h-4 text-slate-500" /> {detail.buyerName}
              </h2>
              <p className="text-slate-400 text-sm mt-0.5">
                {(detail as any).projectName ?? detail.projectId.slice(0, 8)} · Created {fmtDate(detail.createdAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-100">{fmt(detail.offeredPercentage)}</p>
              <p className="text-slate-500 text-xs">of project stake</p>
              {detail.offeredValue && (
                <p className="text-emerald-400 text-sm font-medium mt-1">{fmtInr(detail.offeredValue)}</p>
              )}
            </div>
          </div>

          {/* Status timeline */}
          <div className="pt-3 border-t border-slate-800 overflow-x-auto">
            <StatusTimeline transfer={detail} />
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Transfer Details</p>
            {[
              ["Transferor", detail.transferorName],
              ["Buyer", detail.buyerName],
              ["Buyer Contact", detail.buyerContact ?? "—"],
              ["Type", detail.transferType === "third_party" ? "Third Party" : "Internal"],
              ["Offered %", fmt(detail.offeredPercentage)],
              ["Offered Value", detail.offeredValue ? fmtInr(detail.offeredValue) : "Not specified"],
              ["Reason", detail.reason ?? "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-2 text-sm">
                <span className="text-slate-500 shrink-0">{k}</span>
                <span className="text-slate-200 text-right">{v}</span>
              </div>
            ))}
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Timeline</p>
            {[
              ["Submitted", fmtDate(detail.submittedAt), detail.submittedByName],
              ["ROFR Deadline", detail.rofrDeadline ? fmtDate(detail.rofrDeadline) : "—", null],
              ["Approved", fmtDate(detail.approvedAt), detail.approvedByName],
              ["Executed", fmtDate(detail.executedAt), detail.executedByName],
              ["Cancelled", fmtDate(detail.cancelledAt), detail.cancelledByName],
            ].map(([label, val, who]) => (
              <div key={label as string} className="text-sm">
                <span className="text-slate-500">{label}: </span>
                <span className="text-slate-200">{val}</span>
                {who && <span className="text-slate-500 ml-1">by {who}</span>}
              </div>
            ))}
            {detail.adminNotes && (
              <div className="pt-2 border-t border-slate-800">
                <p className="text-slate-500 text-xs mb-1">Admin Notes</p>
                <p className="text-slate-300 text-sm">{detail.adminNotes}</p>
              </div>
            )}
            {detail.cancellationReason && (
              <div className="pt-2 border-t border-slate-800">
                <p className="text-slate-500 text-xs mb-1">Cancellation Reason</p>
                <p className="text-red-300 text-sm">{detail.cancellationReason}</p>
              </div>
            )}
            {detail.executionNotes && (
              <div className="pt-2 border-t border-slate-800">
                <p className="text-slate-500 text-xs mb-1">Execution Notes</p>
                <p className="text-emerald-300 text-sm">{detail.executionNotes}</p>
              </div>
            )}
          </div>
        </div>

        {/* ROFR Panel */}
        {(detail.status.startsWith("pending_rofr") || detail.status === "rofr_accepted" || detail.status === "rofr_rejected" || rofrResponses.length > 0) && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-300 text-sm font-medium flex items-center gap-2">
                <Users className="w-4 h-4 text-amber-400" /> Right of First Refusal (ROFR)
              </p>
              {detail.rofrDeadline && (
                <span className="text-amber-400 text-xs">Deadline: {fmtDate(detail.rofrDeadline)}</span>
              )}
            </div>
            {rofrResponses.length === 0 ? (
              <p className="text-slate-500 text-sm">No ROFR responses recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {rofrResponses.map((r: any) => (
                  <div key={r.partnerId} className="flex items-center justify-between bg-slate-900/60 rounded-lg px-3 py-2">
                    <span className="text-slate-200 text-sm">{r.partnerName}</span>
                    <div className="flex items-center gap-2">
                      {r.response === "accepted" && <span className="text-emerald-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Accepted</span>}
                      {r.response === "rejected" && <span className="text-red-400 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Declined</span>}
                      {r.response === "pending" && <span className="text-amber-400 text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> Pending</span>}
                      {r.respondedAt && <span className="text-slate-500 text-xs">{fmtDate(r.respondedAt)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {canRecordRofr && (
              <Button size="sm" variant="outline"
                className="mt-3 border-amber-700/40 text-amber-300 hover:bg-amber-950/40 hover:text-amber-200"
                onClick={() => { setShowRofr(true); setActionError(""); }}>
                + Record Partner Response
              </Button>
            )}
            {canFinalizeRofr && (
              <Button size="sm" variant="outline"
                className="mt-3 ml-2 border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={() => { setShowFinalizeRofr(true); setActionError(""); }}>
                Finalize ROFR Outcome
              </Button>
            )}
          </div>
        )}

        {/* Governance notice */}
        {detail.status === "executed" && (
          <div className="bg-emerald-950/30 border border-emerald-700/30 rounded-xl p-4 flex items-start gap-3">
            <Unlock className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-emerald-300 text-sm font-medium">Transfer Executed</p>
              <p className="text-emerald-400/70 text-xs mt-0.5">
                This transfer has been recorded as executed. The actual ownership records must be updated separately via the Ownership module to reflect the new allocation. No automatic ownership modification was performed.
              </p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {isAdminDev && (
          <div className="flex items-center gap-2 flex-wrap pt-2">
            {canSubmit && (
              <Button size="sm" onClick={() => { setShowSubmit(true); setActionError(""); }}
                className="bg-blue-700 hover:bg-blue-600 text-white">
                Submit for Review
              </Button>
            )}
            {canApprove && (
              <Button size="sm" onClick={() => { setShowApprove(true); setActionError(""); }}
                className="bg-emerald-700 hover:bg-emerald-600 text-white">
                <ShieldCheck className="w-4 h-4 mr-1" /> Approve Transfer
              </Button>
            )}
            {canExecute && (
              <Button size="sm" onClick={() => { setShowExecute(true); setActionError(""); }}
                className="bg-amber-700 hover:bg-amber-600 text-white">
                <CheckCircle2 className="w-4 h-4 mr-1" /> Mark as Executed
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="outline"
                className="border-red-700/40 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                onClick={() => { setShowCancel(true); setActionError(""); }}>
                <Ban className="w-4 h-4 mr-1" /> Cancel Transfer
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {(mode === "detail" || mode === "new") ? (
          <button onClick={() => { setMode("list"); setSelectedId(null); setActionError(""); resetWizard(); }}
            className="text-slate-400 hover:text-slate-200 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
        ) : null}
        <div className="p-2 rounded-xl bg-blue-900/40 border border-blue-700/30">
          <ArrowLeftRight className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-slate-100 text-xl font-semibold">
            {mode === "new" ? "New Transfer Request" : mode === "detail" ? "Transfer Details" : "Ownership Share Transfers"}
          </h1>
          <p className="text-slate-500 text-sm">
            {mode === "list" ? "Manage and track ownership share transfer requests" :
              mode === "dashboard" ? "Pending transfers requiring action" :
              mode === "new" ? `Step ${wizardStep} of 4` :
              `Transfer · ${detail ? detail.transferorName + " → " + detail.buyerName : "Loading..."}`}
          </p>
        </div>
      </div>

      {/* Tab bar (list / dashboard) */}
      {(mode === "list" || mode === "dashboard") && (
        <div className="flex items-center gap-1 mb-5 bg-slate-900/40 border border-slate-800 rounded-xl p-1 w-fit">
          {[
            { key: "list", label: "All Transfers", icon: ListFilter },
            ...(isAdminDev ? [{ key: "dashboard", label: "Pending Dashboard", icon: LayoutDashboard }] : []),
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setMode(key as Mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                ${mode === key ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
          {isAdminDev && mode === "list" && (
            <button onClick={() => { resetWizard(); setMode("new"); }}
              className="ml-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-950/30 transition-all">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {mode === "list" && renderList()}
      {mode === "dashboard" && renderDashboard()}
      {mode === "new" && renderWizard()}
      {mode === "detail" && renderDetail()}

      {/* ── Action Dialogs ─────────────────────────────────────────────── */}

      {/* Submit */}
      <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Submit Transfer Request</DialogTitle>
            <DialogDescription className="text-slate-400">Choose how to proceed with this transfer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {detail?.transferType === "third_party" ? (
              <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-3 text-amber-300 text-sm flex items-start gap-2">
                <Users className="w-4 h-4 shrink-0 mt-0.5" />
                Third-party transfers must go through the Right of First Refusal (ROFR) process. All existing partners will be notified with a 14-day response window.
              </div>
            ) : (
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="radio" checked={!skipRofr} onChange={() => setSkipRofr(false)} className="mt-1" />
                  <div>
                    <p className="text-slate-200 text-sm font-medium">Send ROFR to existing partners</p>
                    <p className="text-slate-500 text-xs">Notify all existing partners with a 14-day right of first refusal before proceeding.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="radio" checked={skipRofr} onChange={() => setSkipRofr(true)} className="mt-1" />
                  <div>
                    <p className="text-slate-200 text-sm font-medium">Skip ROFR (internal transfer)</p>
                    <p className="text-slate-500 text-xs">Go directly to pending approval. Suitable when transferring to a known existing partner.</p>
                  </div>
                </label>
              </div>
            )}
            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={submitMut.isPending}
              className="bg-blue-700 hover:bg-blue-600 text-white">
              {submitMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ROFR Response */}
      <Dialog open={showRofr} onOpenChange={setShowRofr}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Record ROFR Response</DialogTitle>
            <DialogDescription className="text-slate-400">Record a partner's right of first refusal decision.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300 mb-1 block">Partner</Label>
              <Select value={rofrPartnerId} onValueChange={id => {
                setRofrPartnerId(id);
                const p = partners.find((pp: any) => pp.id === id);
                if (p) setRofrPartnerName((p as any).name);
              }}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200">
                  <SelectValue placeholder="Select partner" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  {partners
                    .filter((p: any) => p.id !== detail?.transferorPartnerId)
                    .map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Response</Label>
              <div className="flex gap-3">
                {[
                  { value: "accepted", label: "Accepted", color: "emerald" },
                  { value: "rejected", label: "Declined", color: "red" },
                ].map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => setRofrResponse(opt.value as "accepted" | "rejected")}
                    className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all
                      ${rofrResponse === opt.value
                        ? opt.color === "emerald" ? "border-emerald-500 bg-emerald-950/40 text-emerald-300" : "border-red-500 bg-red-950/40 text-red-300"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Notes (optional)</Label>
              <Textarea value={rofrNotes} onChange={e => setRofrNotes(e.target.value)} rows={2}
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none" />
            </div>
            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowRofr(false)}>Cancel</Button>
            <Button size="sm" onClick={handleRofrResponse} disabled={!rofrPartnerId || rofrMut.isPending}
              className="bg-amber-700 hover:bg-amber-600 text-white">
              Record Response
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize ROFR */}
      <Dialog open={showFinalizeRofr} onOpenChange={setShowFinalizeRofr}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Finalize ROFR Outcome</DialogTitle>
            <DialogDescription className="text-slate-400">Set the final outcome of the right of first refusal period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-3">
              {[
                { value: "rofr_rejected", label: "All Partners Declined", desc: "Proceed to third-party transfer" },
                { value: "rofr_accepted", label: "Partner Accepted", desc: "Internal transfer proceeds" },
              ].map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setFinalRofrOutcome(opt.value as any)}
                  className={`flex-1 p-3 rounded-xl border-2 text-left transition-all
                    ${finalRofrOutcome === opt.value ? "border-blue-500 bg-blue-950/40" : "border-slate-700 hover:border-slate-600"}`}>
                  <p className="text-slate-200 text-sm font-medium">{opt.label}</p>
                  <p className="text-slate-500 text-xs">{opt.desc}</p>
                </button>
              ))}
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Notes (optional)</Label>
              <Textarea value={finalRofrNotes} onChange={e => setFinalRofrNotes(e.target.value)} rows={2}
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none" />
            </div>
            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowFinalizeRofr(false)}>Cancel</Button>
            <Button size="sm" onClick={handleFinalizeRofr} disabled={finalizeRofrMut.isPending}
              className="bg-blue-700 hover:bg-blue-600 text-white">
              Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve */}
      <Dialog open={showApprove} onOpenChange={setShowApprove}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Approve Transfer</DialogTitle>
            <DialogDescription className="text-slate-400">Approving will advance the transfer to the execution stage.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300 mb-1 block">Governance Notes (optional)</Label>
              <Textarea value={approveNotes} onChange={e => setApproveNotes(e.target.value)} rows={3}
                placeholder="Any notes or conditions for approval..."
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none" />
            </div>
            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowApprove(false)}>Cancel</Button>
            <Button size="sm" onClick={handleApprove} disabled={approveMut.isPending}
              className="bg-emerald-700 hover:bg-emerald-600 text-white">
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execute */}
      <Dialog open={showExecute} onOpenChange={setShowExecute}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Mark Transfer as Executed</DialogTitle>
            <DialogDescription className="text-slate-400">This is an explicit confirmation that the share transfer has been physically completed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-amber-950/30 border border-amber-700/30 rounded-lg p-3 text-amber-300 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>No automatic ownership changes will occur.</strong> You must separately update the ownership records in the Ownership module to reflect the new allocation after execution.
              </div>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Execution Notes <span className="text-red-400">*</span></Label>
              <Textarea value={executeNotes} onChange={e => setExecuteNotes(e.target.value)} rows={3}
                placeholder="Describe the execution: e.g. 'Transfer deed signed 12 May 2026, registered at Sub-Registrar Office, Agartala. New ownership records updated separately.'"
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none" />
            </div>
            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowExecute(false)}>Cancel</Button>
            <Button size="sm" onClick={handleExecute}
              disabled={!executeNotes.trim() || executeMut.isPending}
              className="bg-amber-700 hover:bg-amber-600 text-white">
              Confirm Execution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle>Cancel Transfer Request</DialogTitle>
            <DialogDescription className="text-slate-400">This action is irreversible. The transfer request will be permanently cancelled.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-slate-300 mb-1 block">Reason for Cancellation <span className="text-red-400">*</span></Label>
              <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3}
                placeholder="State the reason for cancelling this transfer..."
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none" />
            </div>
            {actionError && <p className="text-red-400 text-sm">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCancel(false)}>Keep Transfer</Button>
            <Button size="sm" onClick={handleCancel}
              disabled={!cancelReason.trim() || cancelMut.isPending}
              className="bg-red-800 hover:bg-red-700 text-white">
              Cancel Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
