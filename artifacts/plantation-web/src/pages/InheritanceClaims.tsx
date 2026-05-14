/**
 * InheritanceClaims.tsx — Inheritance & Claimant Succession Workflow
 *
 * GOVERNANCE RULE: This system does NOT automatically divide or transfer shares.
 * All allocations are entered manually by admin/developer and require explicit
 * approval through a tribal/customary + developer-approval + document-verification
 * governance workflow before any claim is considered settled.
 *
 * Four top-level tabs:
 *   1. Claims           — list + create + detail (status workflow)
 *   2. Verification     — claimant verification dashboard
 *   3. Share Division   — manual share allocation interface
 *   4. Documents        — document registration + verification
 */

import { useState, useMemo } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListInheritanceClaims,
  useCreateInheritanceClaim,
  useGetInheritanceClaim,
  useUpdateInheritanceClaim,
  useDeleteInheritanceClaim,
  useTransitionInheritanceClaimStatus,
  useListInheritanceShares,
  useCreateInheritanceShare,
  useUpdateInheritanceShare,
  useDeleteInheritanceShare,
  useListInheritanceDocuments,
  useCreateInheritanceDocument,
  useUpdateInheritanceDocument,
  useDeleteInheritanceDocument,
  useListPartners,
  useListProjects,
  getListInheritanceClaimsQueryKey,
  getGetInheritanceClaimQueryKey,
  getListInheritanceSharesQueryKey,
  getListInheritanceDocumentsQueryKey,
} from "@workspace/api-client-react";
import type {
  InheritanceClaim,
  InheritanceClaimantShare,
  InheritanceDocument,
} from "@workspace/api-client-react";
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
import { useQueryClient } from "@tanstack/react-query";
import {
  Gavel,
  Plus,
  X,
  ArrowLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  RefreshCw,
  Pencil,
  Trash2,
  FileText,
  Users,
  Scale,
  Upload,
  Info,
  Ban,
  CircleDot,
  Check,
  Layers,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type ClaimStatus =
  | "open"
  | "under_review"
  | "developer_approved"
  | "documents_verified"
  | "approved"
  | "rejected"
  | "settled";

type DocVerification = "pending" | "verified" | "rejected";
type ShareStatus = "proposed" | "approved" | "disputed";

// ── Status workflow ────────────────────────────────────────────────────────

const CLAIM_WORKFLOW: { status: ClaimStatus; label: string; next: ClaimStatus | null; nextLabel: string | null }[] = [
  { status: "open", label: "Open", next: "under_review", nextLabel: "Begin Review" },
  { status: "under_review", label: "Under Review", next: "developer_approved", nextLabel: "Mark Developer Approved" },
  { status: "developer_approved", label: "Developer Approved", next: "documents_verified", nextLabel: "Mark Documents Verified" },
  { status: "documents_verified", label: "Documents Verified", next: "approved", nextLabel: "Approve Claim" },
  { status: "approved", label: "Approved", next: "settled", nextLabel: "Mark Settled" },
  { status: "rejected", label: "Rejected", next: null, nextLabel: null },
  { status: "settled", label: "Settled", next: null, nextLabel: null },
];

const STATUS_COLORS: Record<string, string> = {
  open: "text-slate-400 border-slate-700 bg-slate-800/40",
  under_review: "text-amber-400 border-amber-800/40 bg-amber-900/20",
  developer_approved: "text-blue-400 border-blue-700/40 bg-blue-900/20",
  documents_verified: "text-sky-400 border-sky-700/40 bg-sky-900/20",
  approved: "text-emerald-400 border-emerald-700/40 bg-emerald-900/20",
  rejected: "text-red-400 border-red-700/40 bg-red-900/20",
  settled: "text-purple-400 border-purple-700/40 bg-purple-900/20",
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  death: "Death",
  incapacity: "Incapacity",
  voluntary_transfer: "Voluntary Transfer",
};

const CLAIM_TYPE_COLORS: Record<string, string> = {
  death: "text-red-400 bg-red-900/20 border-red-800/30",
  incapacity: "text-amber-400 bg-amber-900/20 border-amber-800/30",
  voluntary_transfer: "text-blue-400 bg-blue-900/20 border-blue-800/30",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  death_certificate: "Death Certificate",
  succession_certificate: "Succession Certificate",
  court_order: "Court Order",
  tribal_council_letter: "Tribal Council Letter",
  id_proof: "ID Proof",
  affidavit: "Affidavit",
  land_record: "Land Record",
  other: "Other",
};

const SHARE_STATUS_COLORS: Record<ShareStatus, string> = {
  proposed: "text-amber-400 bg-amber-900/20 border-amber-800/30",
  approved: "text-emerald-400 bg-emerald-900/20 border-emerald-800/30",
  disputed: "text-red-400 bg-red-900/20 border-red-800/30",
};

// ── Helper components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${STATUS_COLORS[status] ?? "text-slate-400 border-slate-700 bg-slate-800/40"}`}>
      {CLAIM_WORKFLOW.find((w) => w.status === status)?.label ?? status}
    </span>
  );
}

function ClaimTypeBadge({ type }: { type: string }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${CLAIM_TYPE_COLORS[type] ?? "text-slate-400 border-slate-700"}`}>
      {CLAIM_TYPE_LABELS[type] ?? type}
    </span>
  );
}

function DocVerBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "text-amber-400 bg-amber-900/20 border-amber-800/30",
    verified: "text-emerald-400 bg-emerald-900/20 border-emerald-800/30",
    rejected: "text-red-400 bg-red-900/20 border-red-800/30",
  };
  const icons: Record<string, React.ReactNode> = {
    pending: <Clock className="w-2.5 h-2.5" />,
    verified: <CheckCircle2 className="w-2.5 h-2.5" />,
    rejected: <Ban className="w-2.5 h-2.5" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-medium ${map[status] ?? ""}`}>
      {icons[status]}
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-400">{label}</Label>
      {children}
    </div>
  );
}

function EmptyBox({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="py-10 text-center">
      <Icon className="w-8 h-8 mx-auto mb-3 opacity-20" />
      <p className="text-slate-500 text-sm">{label}</p>
    </div>
  );
}

function GovernanceDisclaimerBanner() {
  return (
    <div className="bg-amber-950/20 border border-amber-700/30 rounded-xl px-4 py-3 flex items-start gap-3 mb-5">
      <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="text-xs text-amber-300 space-y-0.5">
        <p className="font-semibold">Manual Governance Settlement Only</p>
        <p className="text-amber-400/80">
          This system does <strong>not</strong> automatically divide or transfer shares.
          All share allocations must be entered manually and require explicit approval
          through the tribal/customary process, project developer approval, and document
          verification before a claim can be settled.
        </p>
      </div>
    </div>
  );
}

// ── Status Stepper ─────────────────────────────────────────────────────────

function StatusStepper({ currentStatus }: { currentStatus: string }) {
  const mainSteps: ClaimStatus[] = [
    "open",
    "under_review",
    "developer_approved",
    "documents_verified",
    "approved",
    "settled",
  ];

  if (currentStatus === "rejected") {
    return (
      <div className="flex items-center gap-2 py-2">
        <Ban className="w-4 h-4 text-red-400" />
        <span className="text-sm text-red-400 font-medium">Claim Rejected</span>
      </div>
    );
  }

  const currentIdx = mainSteps.indexOf(currentStatus as ClaimStatus);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {mainSteps.map((step, i) => {
        const isPast = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFuture = i > currentIdx;
        const label = CLAIM_WORKFLOW.find((w) => w.status === step)?.label ?? step;
        return (
          <div key={step} className="flex items-center gap-1">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isPast
                  ? "bg-emerald-900/20 border-emerald-700/40 text-emerald-400"
                  : isCurrent
                  ? "bg-blue-900/30 border-blue-600/50 text-blue-300 shadow-sm shadow-blue-900/20"
                  : "bg-slate-900/30 border-slate-800 text-slate-600"
              }`}
            >
              {isPast ? (
                <Check className="w-3 h-3" />
              ) : isCurrent ? (
                <CircleDot className="w-3 h-3" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-slate-700" />
              )}
              {label}
            </div>
            {i < mainSteps.length - 1 && (
              <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function InheritanceClaims() {
  const { role } = useRole();
  const qc = useQueryClient();
  const isAdmin = role === "admin";
  const canEdit = role === "admin" || role === "developer";

  const [tab, setTab] = useState<"claims" | "verification" | "shares" | "documents">("claims");

  // ── Claims tab state ────────────────────────────────────────────────
  const [filterProject, setFilterProject] = useState("all");
  const [filterPartner, setFilterPartner] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [showNewClaimForm, setShowNewClaimForm] = useState(false);
  const [newClaimPartnerId, setNewClaimPartnerId] = useState("");
  const [newClaimProjectId, setNewClaimProjectId] = useState("");
  const [newClaimType, setNewClaimType] = useState<"death" | "incapacity" | "voluntary_transfer">("death");
  const [newClaimDesc, setNewClaimDesc] = useState("");
  const [newClaimError, setNewClaimError] = useState<string | null>(null);

  // Detail edit state
  const [editReviewNotes, setEditReviewNotes] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<ClaimStatus | null>(null);
  const [transitionReason, setTransitionReason] = useState("");
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showSettleForm, setShowSettleForm] = useState(false);
  const [settleNotes, setSettleNotes] = useState("");

  // ── Share state ─────────────────────────────────────────────────────
  const [shareClaimId, setShareClaimId] = useState("none");
  const [showShareForm, setShowShareForm] = useState(false);
  const [shareClaimantId, setShareClaimantId] = useState("");
  const [sharePct, setSharePct] = useState("");
  const [shareNotes, setShareNotes] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);
  const [editingShareId, setEditingShareId] = useState<string | null>(null);
  const [editSharePct, setEditSharePct] = useState("");
  const [editShareNotes, setEditShareNotes] = useState("");

  // ── Document state ──────────────────────────────────────────────────
  const [docClaimId, setDocClaimId] = useState("none");
  const [showDocForm, setShowDocForm] = useState(false);
  const [docType, setDocType] = useState("death_certificate");
  const [docTitle, setDocTitle] = useState("");
  const [docDesc, setDocDesc] = useState("");
  const [docClaimantId, setDocClaimantId] = useState("");
  const [docFilePath, setDocFilePath] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [verifyNotes, setVerifyNotes] = useState("");

  // ── Verification dashboard claim selection
  const [verifyClaimId, setVerifyClaimId] = useState("none");

  // ── Data fetches ────────────────────────────────────────────────────

  const { data: projects = [] } = useListProjects();
  const { data: partnersData } = useListPartners({});
  const partners = (partnersData as any)?.partners ?? (Array.isArray(partnersData) ? partnersData : []);

  const pid = filterProject === "all" ? undefined : filterProject;
  const partId = filterPartner === "all" ? undefined : filterPartner;
  const st = filterStatus === "all" ? undefined : filterStatus;

  const { data: claimsPage, isLoading: claimsLoading } = useListInheritanceClaims(
    { projectId: pid, partnerId: partId, status: st },
    {
      query: {
        queryKey: getListInheritanceClaimsQueryKey({ projectId: pid, partnerId: partId, status: st }),
      },
    },
  );
  const claims: InheritanceClaim[] = (claimsPage as any)?.claims ?? [];

  const { data: claimDetail, isLoading: detailLoading } = useGetInheritanceClaim(
    selectedClaimId ?? "",
    {
      query: {
        enabled: !!selectedClaimId,
        queryKey: getGetInheritanceClaimQueryKey(selectedClaimId ?? ""),
      },
    },
  );

  const activeShareClaimId = shareClaimId !== "none" ? shareClaimId : null;
  const { data: sharesPage, isLoading: sharesLoading } = useListInheritanceShares(
    activeShareClaimId ?? "",
    {
      query: {
        enabled: !!activeShareClaimId,
        queryKey: getListInheritanceSharesQueryKey(activeShareClaimId ?? ""),
      },
    },
  );
  const shares: InheritanceClaimantShare[] = (sharesPage as any)?.shares ?? [];
  const totalProposedPct: number = (sharesPage as any)?.totalProposedPct ?? 0;
  const totalApprovedPct: number = (sharesPage as any)?.totalApprovedPct ?? 0;

  const activeDocClaimId = docClaimId !== "none" ? docClaimId : null;
  const { data: docsPage, isLoading: docsLoading } = useListInheritanceDocuments(
    activeDocClaimId ?? "",
    {
      query: {
        enabled: !!activeDocClaimId,
        queryKey: getListInheritanceDocumentsQueryKey(activeDocClaimId ?? ""),
      },
    },
  );
  const documents: InheritanceDocument[] = (docsPage as any)?.documents ?? [];

  const activeVerifyClaimId = verifyClaimId !== "none" ? verifyClaimId : null;
  const { data: verifyDetail } = useGetInheritanceClaim(
    activeVerifyClaimId ?? "",
    {
      query: {
        enabled: !!activeVerifyClaimId,
        queryKey: getGetInheritanceClaimQueryKey(activeVerifyClaimId ?? ""),
      },
    },
  );

  // ── Mutations ────────────────────────────────────────────────────────

  const createClaimMut = useCreateInheritanceClaim();
  const updateClaimMut = useUpdateInheritanceClaim();
  const deleteClaimMut = useDeleteInheritanceClaim();
  const transitionMut = useTransitionInheritanceClaimStatus();
  const createShareMut = useCreateInheritanceShare();
  const updateShareMut = useUpdateInheritanceShare();
  const deleteShareMut = useDeleteInheritanceShare();
  const createDocMut = useCreateInheritanceDocument();
  const updateDocMut = useUpdateInheritanceDocument();
  const deleteDocMut = useDeleteInheritanceDocument();

  // ── Handlers ─────────────────────────────────────────────────────────

  function invalidateClaim(id: string) {
    qc.invalidateQueries({ queryKey: getGetInheritanceClaimQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListInheritanceClaimsQueryKey({}) });
  }

  async function handleCreateClaim() {
    setNewClaimError(null);
    if (!newClaimPartnerId || !newClaimProjectId) {
      return setNewClaimError("Partner and project are required.");
    }
    try {
      const res = await createClaimMut.mutateAsync({
        data: {
          partnerId: newClaimPartnerId,
          projectId: newClaimProjectId,
          claimType: newClaimType,
          description: newClaimDesc.trim() || undefined,
        },
      });
      const id = (res as any)?.claim?.id;
      qc.invalidateQueries({ queryKey: getListInheritanceClaimsQueryKey({}) });
      setShowNewClaimForm(false);
      setNewClaimPartnerId("");
      setNewClaimProjectId("");
      setNewClaimType("death");
      setNewClaimDesc("");
      if (id) setSelectedClaimId(id);
    } catch (e: any) {
      setNewClaimError(e?.response?.data?.error ?? "Failed to create claim.");
    }
  }

  async function handleTransition(toStatus: ClaimStatus) {
    setTransitionError(null);
    if (!selectedClaimId) return;
    try {
      await transitionMut.mutateAsync({
        id: selectedClaimId,
        data: {
          toStatus: toStatus as any,
          reason: rejectReason.trim() || undefined,
          notes: (toStatus === "settled" ? settleNotes : transitionReason).trim() || undefined,
        },
      });
      invalidateClaim(selectedClaimId);
      setTransitionTarget(null);
      setTransitionReason("");
      setRejectReason("");
      setShowRejectForm(false);
      setShowSettleForm(false);
    } catch (e: any) {
      setTransitionError(e?.response?.data?.error ?? "Failed to update status.");
    }
  }

  async function handleSaveNotes() {
    if (!selectedClaimId) return;
    await updateClaimMut.mutateAsync({
      id: selectedClaimId,
      data: { reviewNotes: editReviewNotes },
    });
    invalidateClaim(selectedClaimId);
    setShowReviewForm(false);
  }

  async function handleDeleteClaim(id: string) {
    await deleteClaimMut.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListInheritanceClaimsQueryKey({}) });
    if (selectedClaimId === id) setSelectedClaimId(null);
  }

  async function handleCreateShare() {
    setShareError(null);
    const pct = parseFloat(sharePct);
    if (!shareClaimantId) return setShareError("Select a claimant.");
    if (isNaN(pct) || pct <= 0 || pct > 100) return setShareError("Enter a valid share % (0.01–100).");
    try {
      await createShareMut.mutateAsync({
        id: activeShareClaimId!,
        data: { claimantId: shareClaimantId, proposedSharePct: pct, shareNotes: shareNotes.trim() || undefined },
      });
      qc.invalidateQueries({ queryKey: getListInheritanceSharesQueryKey(activeShareClaimId!) });
      setShowShareForm(false);
      setShareClaimantId("");
      setSharePct("");
      setShareNotes("");
    } catch (e: any) {
      setShareError(e?.response?.data?.error ?? "Failed to propose share.");
    }
  }

  async function handleShareStatus(shareId: string, status: ShareStatus) {
    await updateShareMut.mutateAsync({
      id: activeShareClaimId!,
      shareId,
      data: { status },
    });
    qc.invalidateQueries({ queryKey: getListInheritanceSharesQueryKey(activeShareClaimId!) });
  }

  async function handleDeleteShare(shareId: string) {
    await deleteShareMut.mutateAsync({ id: activeShareClaimId!, shareId });
    qc.invalidateQueries({ queryKey: getListInheritanceSharesQueryKey(activeShareClaimId!) });
  }

  async function handleSaveShareEdit(shareId: string) {
    const pct = parseFloat(editSharePct);
    if (isNaN(pct) || pct <= 0) return;
    await updateShareMut.mutateAsync({
      id: activeShareClaimId!,
      shareId,
      data: { proposedSharePct: pct, shareNotes: editShareNotes.trim() || undefined },
    });
    qc.invalidateQueries({ queryKey: getListInheritanceSharesQueryKey(activeShareClaimId!) });
    setEditingShareId(null);
  }

  async function handleCreateDoc() {
    setDocError(null);
    if (!docTitle.trim()) return setDocError("Document title is required.");
    try {
      await createDocMut.mutateAsync({
        id: activeDocClaimId!,
        data: {
          documentType: docType as any,
          documentTitle: docTitle.trim(),
          description: docDesc.trim() || undefined,
          claimantId: docClaimantId || undefined,
          fileObjectPath: docFilePath.trim() || undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getListInheritanceDocumentsQueryKey(activeDocClaimId!) });
      setShowDocForm(false);
      setDocTitle("");
      setDocDesc("");
      setDocClaimantId("");
      setDocFilePath("");
    } catch (e: any) {
      setDocError(e?.response?.data?.error ?? "Failed to register document.");
    }
  }

  async function handleVerifyDoc(docId: string, verificationStatus: DocVerification) {
    await updateDocMut.mutateAsync({
      id: activeDocClaimId!,
      docId,
      data: { verificationStatus, verificationNotes: verifyNotes.trim() || undefined },
    });
    qc.invalidateQueries({ queryKey: getListInheritanceDocumentsQueryKey(activeDocClaimId!) });
    setVerifyingDocId(null);
    setVerifyNotes("");
  }

  async function handleDeleteDoc(docId: string) {
    await deleteDocMut.mutateAsync({ id: activeDocClaimId!, docId });
    qc.invalidateQueries({ queryKey: getListInheritanceDocumentsQueryKey(activeDocClaimId!) });
  }

  // ── Derived ──────────────────────────────────────────────────────────

  const detail = claimDetail as any;
  const claimantList: any[] = detail?.claimants ?? [];
  const shareClaimDetail = claims.find((c) => c.id === activeShareClaimId);
  const docClaimDetail = claims.find((c) => c.id === activeDocClaimId);

  // claimants from the detail of share claim (for picker)
  const shareClaimClaimants: any[] = useMemo(() => {
    if (activeShareClaimId === selectedClaimId && detail) return detail.claimants ?? [];
    return [];
  }, [activeShareClaimId, selectedClaimId, detail]);

  const verifyClaimants: any[] = (verifyDetail as any)?.claimants ?? [];
  const verifyDocs: InheritanceDocument[] = (verifyDetail as any)?.documents ?? [];

  if (!["admin", "developer"].includes(role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <ShieldAlert className="w-12 h-12 text-red-500" />
        <p className="text-slate-400">Access restricted to admin and developer roles.</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-200">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          {selectedClaimId && tab === "claims" && (
            <button
              onClick={() => setSelectedClaimId(null)}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="p-2 bg-amber-900/20 border border-amber-700/30 rounded-lg">
            <Gavel className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Inheritance & Succession</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Tribal/customary process · Developer approval · Document verification · Manual settlement
            </p>
          </div>
        </div>

        <GovernanceDisclaimerBanner />

        {/* Tab nav */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit mb-6">
          {([
            { id: "claims", label: "Claims", icon: Gavel },
            { id: "verification", label: "Claimant Verification", icon: Users },
            { id: "shares", label: "Share Division", icon: Scale },
            { id: "documents", label: "Documents", icon: FileText },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setSelectedClaimId(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                tab === id ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════
         * TAB: CLAIMS
         * ══════════════════════════════════════════════ */}
        {tab === "claims" && !selectedClaimId && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Status filter pills */}
                <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                  {(["all", "open", "under_review", "developer_approved", "documents_verified", "approved", "rejected", "settled"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilterStatus(s)}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                        filterStatus === s ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {s === "all" ? "All" : CLAIM_WORKFLOW.find((w) => w.status === s)?.label ?? s}
                    </button>
                  ))}
                </div>

                <Select value={filterProject} onValueChange={setFilterProject}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-48 h-8 text-xs">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="all">All projects</SelectItem>
                    {(projects as any[]).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterPartner} onValueChange={setFilterPartner}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-48 h-8 text-xs">
                    <SelectValue placeholder="All partners" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="all">All partners</SelectItem>
                    {partners.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {claimsLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
              </div>

              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => setShowNewClaimForm(true)}
                  className="bg-amber-700 hover:bg-amber-600 text-white text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> New Inheritance Claim
                </Button>
              )}
            </div>

            {/* New claim form */}
            {showNewClaimForm && (
              <div className="bg-slate-900/40 border border-amber-700/40 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-amber-300">Open New Inheritance Claim</p>
                  <button onClick={() => setShowNewClaimForm(false)}>
                    <X className="w-4 h-4 text-slate-500 hover:text-slate-300" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <Field label="Partner *">
                    <Select value={newClaimPartnerId} onValueChange={setNewClaimPartnerId}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue placeholder="Select partner" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        {partners.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Project *">
                    <Select value={newClaimProjectId} onValueChange={setNewClaimProjectId}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        {(projects as any[]).map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Claim Type *">
                    <Select value={newClaimType} onValueChange={(v: any) => setNewClaimType(v)}>
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                        <SelectItem value="death">Death</SelectItem>
                        <SelectItem value="incapacity">Incapacity</SelectItem>
                        <SelectItem value="voluntary_transfer">Voluntary Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label="Description (optional)">
                  <Textarea
                    value={newClaimDesc}
                    onChange={(e) => setNewClaimDesc(e.target.value)}
                    placeholder="Brief description of the succession event…"
                    className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16 text-xs"
                  />
                </Field>

                {newClaimError && (
                  <p className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />{newClaimError}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateClaim}
                    disabled={createClaimMut.isPending}
                    className="bg-amber-700 hover:bg-amber-600 text-white text-xs"
                  >
                    {createClaimMut.isPending && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                    Open Claim
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewClaimForm(false)} className="text-slate-400 text-xs">
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Claims list */}
            {claims.length === 0 ? (
              <EmptyBox icon={Gavel} label="No inheritance claims found. Open one using the button above." />
            ) : (
              <div className="space-y-2">
                {claims.map((claim: InheritanceClaim) => (
                  <div
                    key={claim.id}
                    onClick={() => setSelectedClaimId(claim.id)}
                    className="flex items-center gap-4 px-5 py-4 bg-slate-900/40 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 hover:bg-slate-800/30 transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <StatusBadge status={claim.status} />
                        <ClaimTypeBadge type={claim.claimType} />
                        {(claim as any).partnerName && (
                          <span className="text-xs font-medium text-slate-300">
                            {(claim as any).partnerName}
                          </span>
                        )}
                        {(claim as any).projectName && (
                          <span className="text-xs text-slate-500">· {(claim as any).projectName}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate">
                        {claim.description ?? "No description"} · Opened {new Date(claim.createdAt).toLocaleDateString("en-IN")}
                        {claim.initiatedByName && ` by ${claim.initiatedByName}`}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Claim Detail ── */}
        {tab === "claims" && selectedClaimId && (
          <div className="space-y-4">
            {detailLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-500" />
              </div>
            ) : !detail ? (
              <EmptyBox icon={Gavel} label="Claim not found." />
            ) : (
              <>
                {/* Claim header */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge status={detail.claim.status} />
                        <ClaimTypeBadge type={detail.claim.claimType} />
                        {detail.claim.partnerName && (
                          <span className="text-sm font-semibold text-white">{detail.claim.partnerName}</span>
                        )}
                        {detail.claim.projectName && (
                          <span className="text-sm text-slate-400">· {detail.claim.projectName}</span>
                        )}
                      </div>
                      {detail.claim.description && (
                        <p className="text-xs text-slate-400 max-w-xl">{detail.claim.description}</p>
                      )}
                      <p className="text-xs text-slate-500">
                        Opened {new Date(detail.claim.createdAt).toLocaleDateString("en-IN")}
                        {detail.claim.initiatedByName && ` by ${detail.claim.initiatedByName}`}
                      </p>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => handleDeleteClaim(selectedClaimId)}
                        className="p-1.5 rounded hover:bg-red-900/20 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Workflow stepper */}
                  <StatusStepper currentStatus={detail.claim.status} />

                  {/* Status action buttons */}
                  {canEdit && (() => {
                    const wf = CLAIM_WORKFLOW.find((w) => w.status === detail.claim.status);
                    if (!wf || !wf.next) return null;
                    return (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (wf.next === "settled") {
                              setShowSettleForm(true);
                            } else {
                              setTransitionTarget(wf.next);
                              handleTransition(wf.next!);
                            }
                          }}
                          disabled={transitionMut.isPending}
                          className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                        >
                          {transitionMut.isPending && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                          {wf.nextLabel}
                        </Button>
                        {!["rejected", "settled"].includes(detail.claim.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowRejectForm(true)}
                            className="text-red-400 hover:bg-red-900/20 text-xs"
                          >
                            <Ban className="w-3 h-3 mr-1" /> Reject Claim
                          </Button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Settle form */}
                  {showSettleForm && (
                    <div className="border border-purple-700/40 rounded-lg p-4 bg-purple-950/10 space-y-3">
                      <p className="text-xs font-medium text-purple-300">Settlement Notes (required)</p>
                      <Textarea
                        value={settleNotes}
                        onChange={(e) => setSettleNotes(e.target.value)}
                        placeholder="Describe the settlement outcome: how shares were decided, tribal/customary process followed, etc."
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-20 text-xs"
                      />
                      {transitionError && <p className="text-red-400 text-xs">{transitionError}</p>}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleTransition("settled")} disabled={!settleNotes.trim() || transitionMut.isPending} className="bg-purple-700 hover:bg-purple-600 text-white text-xs">
                          Confirm Settlement
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowSettleForm(false)} className="text-slate-400 text-xs">Cancel</Button>
                      </div>
                    </div>
                  )}

                  {/* Reject form */}
                  {showRejectForm && (
                    <div className="border border-red-700/40 rounded-lg p-4 bg-red-950/10 space-y-3">
                      <p className="text-xs font-medium text-red-300">Rejection Reason *</p>
                      <Textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Reason for rejecting this claim…"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-16 text-xs"
                      />
                      {transitionError && <p className="text-red-400 text-xs">{transitionError}</p>}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleTransition("rejected")} disabled={!rejectReason.trim() || transitionMut.isPending} className="bg-red-700 hover:bg-red-600 text-white text-xs">
                          Reject Claim
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowRejectForm(false)} className="text-slate-400 text-xs">Cancel</Button>
                      </div>
                    </div>
                  )}

                  {/* Rejection info */}
                  {detail.claim.status === "rejected" && detail.claim.rejectionReason && (
                    <div className="bg-red-950/20 border border-red-800/30 rounded-lg px-3 py-2 text-xs text-red-300">
                      <p className="font-medium mb-0.5">Rejection Reason</p>
                      {detail.claim.rejectionReason}
                    </div>
                  )}

                  {/* Settlement notes */}
                  {detail.claim.status === "settled" && detail.claim.settlementNotes && (
                    <div className="bg-purple-950/20 border border-purple-800/30 rounded-lg px-3 py-2 text-xs text-purple-300">
                      <p className="font-medium mb-0.5">Settlement Outcome</p>
                      {detail.claim.settlementNotes}
                    </div>
                  )}
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Claimants", value: detail.summary.claimantCount, color: "text-slate-200" },
                    { label: "Share Proposals", value: detail.summary.shareCount, color: detail.summary.shareCount === 0 ? "text-amber-400" : "text-slate-200" },
                    { label: "Documents", value: `${detail.summary.verifiedDocumentCount}/${detail.summary.documentCount} verified`, color: detail.summary.allDocumentsVerified && detail.summary.documentCount > 0 ? "text-emerald-400" : "text-slate-200" },
                    { label: "Approved Share %", value: `${detail.summary.totalApprovedPct.toFixed(2)}%`, color: detail.summary.totalApprovedPct === 100 ? "text-emerald-400" : detail.summary.totalApprovedPct > 0 ? "text-blue-400" : "text-slate-500" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                      <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
                      <p className={`text-lg font-semibold font-mono ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Claimants panel */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-400" /> Registered Claimants
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShareClaimId(selectedClaimId); setTab("shares"); }}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        <Scale className="w-3 h-3 mr-1" /> Manage Shares
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setDocClaimId(selectedClaimId); setTab("documents"); }}
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        <FileText className="w-3 h-3 mr-1" /> Documents
                      </Button>
                    </div>
                  </div>

                  {claimantList.length === 0 ? (
                    <div className="py-6 text-center text-sm text-slate-500">
                      No claimants registered yet. Add claimant records from the Partner Details page first.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {claimantList.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-slate-800/30 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-300">
                              {c.claimantName?.charAt(0)?.toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm text-white font-medium">{c.claimantName}</p>
                              <p className="text-xs text-slate-500">{c.relationship} · {c.phone}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                              c.status === "verified"
                                ? "text-emerald-400 border-emerald-700/40 bg-emerald-900/20"
                                : c.status === "pending_verification"
                                ? "text-amber-400 border-amber-700/40 bg-amber-900/20"
                                : c.status === "disputed"
                                ? "text-red-400 border-red-700/40 bg-red-900/20"
                                : "text-slate-400 border-slate-700 bg-slate-800/40"
                            }`}>
                              {c.status?.replace("_", " ")}
                            </span>
                            {/* Share for this claimant */}
                            {(() => {
                              const sh = detail.shares?.find((s: any) => s.claimantId === c.id);
                              if (!sh) return <span className="text-xs text-slate-600">No share proposed</span>;
                              return (
                                <span className={`text-xs font-mono font-semibold ${
                                  sh.status === "approved" ? "text-emerald-400" : sh.status === "disputed" ? "text-red-400" : "text-amber-400"
                                }`}>
                                  {parseFloat(sh.proposedSharePct).toFixed(2)}%
                                  <span className="text-slate-600 font-normal ml-1">({sh.status})</span>
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Review notes */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-white">Review Notes</p>
                    {canEdit && !showReviewForm && (
                      <button
                        onClick={() => { setEditReviewNotes(detail.claim.reviewNotes ?? ""); setShowReviewForm(true); }}
                        className="text-xs text-slate-400 hover:text-slate-300 flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    )}
                  </div>
                  {showReviewForm ? (
                    <div className="space-y-3">
                      <Textarea
                        value={editReviewNotes}
                        onChange={(e) => setEditReviewNotes(e.target.value)}
                        placeholder="Internal review notes, correspondence record, committee decisions…"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-24 text-xs"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveNotes} disabled={updateClaimMut.isPending} className="bg-blue-700 hover:bg-blue-600 text-white text-xs">Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowReviewForm(false)} className="text-slate-400 text-xs">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 whitespace-pre-wrap">
                      {detail.claim.reviewNotes || "No review notes recorded."}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * TAB: VERIFICATION
         * ══════════════════════════════════════════════ */}
        {tab === "verification" && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Select value={verifyClaimId} onValueChange={setVerifyClaimId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-80 h-8 text-xs">
                  <SelectValue placeholder="Select a claim to view claimants" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectItem value="none">Select a claim…</SelectItem>
                  {claims.map((c: InheritanceClaim) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c as any).partnerName ?? "Partner"} · {(c as any).projectName ?? "Project"} ({c.claimType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!activeVerifyClaimId ? (
              <EmptyBox icon={Users} label="Select a claim above to view its claimants and document verification status." />
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {/* Claimant verification status */}
                <div className="col-span-2 space-y-3">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Claimants — Verification Status</p>

                  {verifyClaimants.length === 0 ? (
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl py-8 text-center text-sm text-slate-500">
                      No claimants registered for this claim's partner–project pair.
                    </div>
                  ) : (
                    verifyClaimants.map((c: any) => {
                      const docs = verifyDocs.filter((d) => d.claimantId === c.id);
                      const verifiedDocs = docs.filter((d) => d.verificationStatus === "verified").length;
                      return (
                        <div key={c.id} className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-slate-300">
                                {c.claimantName?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-medium text-white">{c.claimantName}</p>
                                <p className="text-xs text-slate-500">{c.relationship}</p>
                              </div>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                              c.status === "verified" ? "text-emerald-400 border-emerald-700/40 bg-emerald-900/20"
                              : c.status === "pending_verification" ? "text-amber-400 border-amber-700/40 bg-amber-900/20"
                              : c.status === "disputed" ? "text-red-400 border-red-700/40 bg-red-900/20"
                              : "text-slate-400 border-slate-700 bg-slate-800/40"
                            }`}>
                              {c.status?.replace(/_/g, " ")}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span>Phone: {c.phone}</span>
                            <span>Docs: {verifiedDocs}/{docs.length} verified</span>
                            {c.notes && <span className="truncate max-w-xs">{c.notes}</span>}
                          </div>
                          {/* Progress bar */}
                          {docs.length > 0 && (
                            <div className="mt-3">
                              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-600 rounded-full transition-all"
                                  style={{ width: `${(verifiedDocs / docs.length) * 100}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-slate-600 mt-1">
                                {verifiedDocs} of {docs.length} documents verified
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Summary panel */}
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Claim Overview</p>
                  {activeVerifyClaimId && (verifyDetail as any)?.claim && (
                    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
                      <StatusBadge status={(verifyDetail as any).claim.status} />
                      <ClaimTypeBadge type={(verifyDetail as any).claim.claimType} />

                      {[
                        { label: "Total Claimants", value: (verifyDetail as any).summary.claimantCount },
                        { label: "Docs Verified", value: `${(verifyDetail as any).summary.verifiedDocumentCount}/${(verifyDetail as any).summary.documentCount}` },
                        { label: "Shares Approved", value: `${(verifyDetail as any).summary.totalApprovedPct.toFixed(2)}%` },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between text-xs">
                          <span className="text-slate-500">{label}</span>
                          <span className="text-slate-200 font-mono">{value}</span>
                        </div>
                      ))}

                      <div className="space-y-1.5 border-t border-slate-800 pt-3">
                        {[
                          { label: "Shares approved", ok: (verifyDetail as any).summary.allSharesApproved },
                          { label: "Docs verified", ok: (verifyDetail as any).summary.allDocumentsVerified && (verifyDetail as any).summary.documentCount > 0 },
                        ].map(({ label, ok }) => (
                          <div key={label} className="flex items-center gap-2 text-xs">
                            {ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                            <span className={ok ? "text-emerald-300" : "text-amber-300"}>{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setDocClaimId(activeVerifyClaimId!); setTab("documents"); }}
                    className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs w-full"
                  >
                    <FileText className="w-3 h-3 mr-1.5" /> Manage Documents
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setSelectedClaimId(activeVerifyClaimId!); setTab("claims"); }}
                    className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs w-full"
                  >
                    <Gavel className="w-3 h-3 mr-1.5" /> Open Claim Detail
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * TAB: SHARE DIVISION
         * ══════════════════════════════════════════════ */}
        {tab === "shares" && (
          <div className="space-y-4">
            {/* Manual-only disclaimer */}
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 space-y-1">
                <p className="font-medium text-white">Manual Share Entry Only</p>
                <p className="text-slate-400">
                  Shares must be entered individually for each claimant by an admin or developer.
                  The system will warn if the total exceeds 100% but will not block entry.
                  Each share must be explicitly approved. Shares can be marked as disputed during the process.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <Select value={shareClaimId} onValueChange={setShareClaimId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-80 h-8 text-xs">
                  <SelectValue placeholder="Select claim" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectItem value="none">Select a claim…</SelectItem>
                  {claims.map((c: InheritanceClaim) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c as any).partnerName ?? "Partner"} · {(c as any).projectName ?? "Project"} · {c.claimType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {activeShareClaimId && canEdit && (
                <Button
                  size="sm"
                  onClick={() => setShowShareForm(true)}
                  className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Propose Share
                </Button>
              )}
              {sharesLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
            </div>

            {!activeShareClaimId ? (
              <EmptyBox icon={Scale} label="Select a claim above to manage share allocations." />
            ) : (
              <>
                {/* Share total bar */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Share Allocation Progress</p>
                    <div className="flex items-center gap-4 text-xs">
                      <span>Proposed: <span className="font-mono text-amber-400">{totalProposedPct.toFixed(2)}%</span></span>
                      <span>Approved: <span className="font-mono text-emerald-400">{totalApprovedPct.toFixed(2)}%</span></span>
                      {totalProposedPct > 100 && (
                        <span className="text-red-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Exceeds 100%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-600 transition-all"
                      style={{ width: `${Math.min(100, totalApprovedPct)}%` }}
                    />
                    <div
                      className="h-full bg-amber-600 transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, totalProposedPct - totalApprovedPct))}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-600">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />Approved</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-600 inline-block" />Proposed</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-700 inline-block" />Unallocated</span>
                    {totalProposedPct < 100 && (
                      <span className="text-slate-500 ml-auto">
                        {(100 - totalProposedPct).toFixed(2)}% remaining
                      </span>
                    )}
                  </div>
                </div>

                {/* New share form */}
                {showShareForm && canEdit && (
                  <div className="bg-slate-900/40 border border-blue-700/40 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-300">Propose Share Allocation</p>
                      <button onClick={() => setShowShareForm(false)}><X className="w-4 h-4 text-slate-500 hover:text-slate-300" /></button>
                    </div>

                    <div className="bg-amber-950/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      Enter the percentage manually. The system will not compute or suggest any value.
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Claimant *">
                        <Select value={shareClaimantId} onValueChange={setShareClaimantId}>
                          <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                            <SelectValue placeholder="Select claimant" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                            {shareClaimDetail && (
                              // Load claimants for this claim's partner–project pair
                              <>
                                {shares.map((s: any) => s.claimantId)}
                                {/* Claimants loaded from detail when this claim is also selected */}
                                {claims
                                  .filter((c: InheritanceClaim) => c.id === activeShareClaimId)
                                  .slice(0, 1)
                                  .flatMap(() => [])
                                }
                              </>
                            )}
                            {/* If this is the claim open in detail, use claimantList */}
                            {selectedClaimId === activeShareClaimId
                              ? claimantList.map((c: any) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.claimantName} ({c.relationship})
                                  </SelectItem>
                                ))
                              : (
                                <SelectItem value="" disabled>
                                  Open claim in Claims tab first to load claimants
                                </SelectItem>
                              )}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Proposed Share % *">
                        <Input
                          type="number"
                          value={sharePct}
                          onChange={(e) => setSharePct(e.target.value)}
                          placeholder="e.g. 33.33"
                          min="0.01"
                          max="100"
                          step="0.01"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                        />
                      </Field>
                    </div>

                    <Field label="Notes (optional)">
                      <Input
                        value={shareNotes}
                        onChange={(e) => setShareNotes(e.target.value)}
                        placeholder="Basis for this allocation…"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                      />
                    </Field>

                    {shareError && (
                      <p className="text-red-400 text-xs flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" />{shareError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCreateShare} disabled={createShareMut.isPending} className="bg-blue-700 hover:bg-blue-600 text-white text-xs">
                        {createShareMut.isPending && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                        Record Proposal
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowShareForm(false)} className="text-slate-400 text-xs">Cancel</Button>
                    </div>
                  </div>
                )}

                {/* Shares table */}
                {shares.length === 0 ? (
                  <EmptyBox icon={Scale} label="No share proposals yet. Propose shares manually for each claimant." />
                ) : (
                  <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/60">
                          <th className="text-left px-4 py-2.5 text-xs text-slate-500">Claimant</th>
                          <th className="text-left px-3 py-2.5 text-xs text-slate-500">Relationship</th>
                          <th className="text-right px-4 py-2.5 text-xs text-slate-500">Proposed %</th>
                          <th className="text-center px-3 py-2.5 text-xs text-slate-500">Status</th>
                          <th className="text-left px-3 py-2.5 text-xs text-slate-500">Notes</th>
                          {canEdit && <th className="w-24 px-3" />}
                        </tr>
                      </thead>
                      <tbody>
                        {shares.map((s: any) => (
                          <tr key={s.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                            <td className="px-4 py-3 text-slate-300 text-sm">{s.claimantName ?? "—"}</td>
                            <td className="px-3 py-3 text-xs text-slate-500">{s.relationship ?? "—"}</td>
                            <td className="px-4 py-3 text-right">
                              {editingShareId === s.id ? (
                                <div className="flex items-center gap-1.5 justify-end">
                                  <Input
                                    type="number"
                                    value={editSharePct}
                                    onChange={(e) => setEditSharePct(e.target.value)}
                                    className="w-20 h-6 text-xs bg-slate-800 border-slate-600 text-slate-200"
                                  />
                                  <button onClick={() => handleSaveShareEdit(s.id)} className="text-emerald-400 hover:text-emerald-300">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setEditingShareId(null)} className="text-slate-500 hover:text-slate-300">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="font-mono font-semibold text-white">
                                  {parseFloat(s.proposedSharePct).toFixed(4)}%
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${SHARE_STATUS_COLORS[s.status as ShareStatus]}`}>
                                {s.status}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-xs text-slate-500 max-w-[180px] truncate">
                              {s.shareNotes ?? "—"}
                            </td>
                            {canEdit && (
                              <td className="px-3 py-3">
                                <div className="flex gap-1 justify-end flex-wrap">
                                  {s.status === "proposed" && (
                                    <>
                                      <button
                                        onClick={() => handleShareStatus(s.id, "approved")}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-800/30 hover:bg-emerald-900/50"
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => handleShareStatus(s.id, "disputed")}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-800/30 hover:bg-red-900/50"
                                      >
                                        Dispute
                                      </button>
                                    </>
                                  )}
                                  {s.status === "approved" && (
                                    <button
                                      onClick={() => handleShareStatus(s.id, "proposed")}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700"
                                    >
                                      Revoke
                                    </button>
                                  )}
                                  {s.status === "disputed" && (
                                    <button
                                      onClick={() => handleShareStatus(s.id, "proposed")}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
                                    >
                                      Reset
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setEditingShareId(s.id);
                                      setEditSharePct(String(parseFloat(s.proposedSharePct)));
                                      setEditShareNotes(s.shareNotes ?? "");
                                    }}
                                    className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  {isAdmin && (
                                    <button
                                      onClick={() => handleDeleteShare(s.id)}
                                      className="p-1 rounded hover:bg-red-900/20 text-slate-500 hover:text-red-400"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-700 bg-slate-900/60">
                          <td colSpan={2} className="px-4 py-2.5 text-xs text-slate-500">Totals</td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`font-mono font-bold text-sm ${totalProposedPct > 100 ? "text-red-400" : "text-white"}`}>
                              {totalProposedPct.toFixed(4)}%
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs text-emerald-400 font-mono">{totalApprovedPct.toFixed(2)}% approved</td>
                          <td colSpan={canEdit ? 2 : 1} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════
         * TAB: DOCUMENTS
         * ══════════════════════════════════════════════ */}
        {tab === "documents" && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <Select value={docClaimId} onValueChange={setDocClaimId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-200 w-80 h-8 text-xs">
                  <SelectValue placeholder="Select claim" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                  <SelectItem value="none">Select a claim…</SelectItem>
                  {claims.map((c: InheritanceClaim) => (
                    <SelectItem key={c.id} value={c.id}>
                      {(c as any).partnerName ?? "Partner"} · {(c as any).projectName ?? "Project"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {activeDocClaimId && canEdit && (
                <Button
                  size="sm"
                  onClick={() => setShowDocForm(true)}
                  className="bg-blue-700 hover:bg-blue-600 text-white text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Register Document
                </Button>
              )}
              {docsLoading && <RefreshCw className="w-4 h-4 animate-spin text-slate-500" />}
            </div>

            {/* Placeholder-first info */}
            <div className="bg-slate-900/40 border border-slate-700 rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-slate-400">
              <Upload className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-slate-300 font-medium mb-0.5">Placeholder-first document workflow</p>
                Register a document record now (title + type + claimant) and fill in the actual file path once available.
                Verification can only be performed by an admin or developer after the file reference is set.
              </div>
            </div>

            {!activeDocClaimId ? (
              <EmptyBox icon={FileText} label="Select a claim above to manage documents." />
            ) : (
              <>
                {/* New document form */}
                {showDocForm && canEdit && (
                  <div className="bg-slate-900/40 border border-blue-700/40 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-300">Register Document Placeholder</p>
                      <button onClick={() => setShowDocForm(false)}><X className="w-4 h-4 text-slate-500 hover:text-slate-300" /></button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Document Type *">
                        <Select value={docType} onValueChange={setDocType}>
                          <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                            {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                              <SelectItem key={v} value={v}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Title *">
                        <Input
                          value={docTitle}
                          onChange={(e) => setDocTitle(e.target.value)}
                          placeholder="e.g. Death Certificate – Ram Singh"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Linked Claimant (optional)">
                        <Select value={docClaimantId} onValueChange={setDocClaimantId}>
                          <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200">
                            <SelectValue placeholder="No specific claimant" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                            <SelectItem value="">No specific claimant</SelectItem>
                            {selectedClaimId === activeDocClaimId
                              ? claimantList.map((c: any) => (
                                  <SelectItem key={c.id} value={c.id}>{c.claimantName}</SelectItem>
                                ))
                              : null}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="File Path / Reference (optional — can add later)">
                        <Input
                          value={docFilePath}
                          onChange={(e) => setDocFilePath(e.target.value)}
                          placeholder="e.g. /documents/death_cert_2024.pdf"
                          className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 text-xs"
                        />
                      </Field>
                    </div>

                    <Field label="Description (optional)">
                      <Textarea
                        value={docDesc}
                        onChange={(e) => setDocDesc(e.target.value)}
                        placeholder="Context about this document…"
                        className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600 resize-none h-12 text-xs"
                      />
                    </Field>

                    {docError && (
                      <p className="text-red-400 text-xs flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" />{docError}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCreateDoc} disabled={createDocMut.isPending} className="bg-blue-700 hover:bg-blue-600 text-white text-xs">
                        {createDocMut.isPending && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                        Register
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setShowDocForm(false)} className="text-slate-400 text-xs">Cancel</Button>
                    </div>
                  </div>
                )}

                {documents.length === 0 ? (
                  <EmptyBox icon={FileText} label="No documents registered. Register placeholder records for each required document." />
                ) : (
                  <div className="space-y-2">
                    {documents.map((doc: InheritanceDocument) => (
                      <div key={doc.id} className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className="p-1.5 bg-slate-800 rounded border border-slate-700 mt-0.5">
                              <FileText className="w-4 h-4 text-slate-400" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                <p className="text-sm font-medium text-white">{doc.documentTitle}</p>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                                  {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                                </span>
                                <DocVerBadge status={doc.verificationStatus} />
                                {!doc.fileObjectPath && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400 border border-amber-800/30">
                                    No file yet
                                  </span>
                                )}
                              </div>
                              {doc.description && <p className="text-xs text-slate-500">{doc.description}</p>}
                              {doc.fileObjectPath && (
                                <p className="text-xs text-blue-400 font-mono mt-0.5 truncate max-w-sm">{doc.fileObjectPath}</p>
                              )}
                              {doc.verificationStatus === "verified" && doc.verifiedByName && (
                                <p className="text-xs text-emerald-500 mt-0.5">
                                  Verified by {doc.verifiedByName} · {doc.verifiedAt ? new Date(doc.verifiedAt).toLocaleDateString("en-IN") : ""}
                                </p>
                              )}
                              {doc.verificationNotes && (
                                <p className="text-xs text-slate-500 italic mt-0.5">{doc.verificationNotes}</p>
                              )}
                            </div>
                          </div>

                          {canEdit && (
                            <div className="flex gap-1.5 shrink-0">
                              {doc.verificationStatus === "pending" && (
                                <>
                                  {verifyingDocId === doc.id ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={verifyNotes}
                                        onChange={(e) => setVerifyNotes(e.target.value)}
                                        placeholder="Verification notes (optional)"
                                        className="w-48 h-6 text-xs bg-slate-800 border-slate-600 text-slate-200"
                                      />
                                      <button
                                        onClick={() => handleVerifyDoc(doc.id, "verified")}
                                        className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 hover:bg-emerald-900/50"
                                      >
                                        Verify
                                      </button>
                                      <button
                                        onClick={() => handleVerifyDoc(doc.id, "rejected")}
                                        className="text-[10px] px-2 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-700/40 hover:bg-red-900/50"
                                      >
                                        Reject
                                      </button>
                                      <button onClick={() => setVerifyingDocId(null)}>
                                        <X className="w-3.5 h-3.5 text-slate-500" />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setVerifyingDocId(doc.id)}
                                      className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-300 hover:bg-slate-800"
                                    >
                                      Verify / Reject
                                    </button>
                                  )}
                                </>
                              )}
                              {doc.verificationStatus !== "pending" && (
                                <button
                                  onClick={async () => {
                                    await updateDocMut.mutateAsync({
                                      id: activeDocClaimId!,
                                      docId: doc.id,
                                      data: { verificationStatus: "pending" },
                                    });
                                    qc.invalidateQueries({ queryKey: getListInheritanceDocumentsQueryKey(activeDocClaimId!) });
                                  }}
                                  className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-300"
                                >
                                  Reset
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  onClick={() => handleDeleteDoc(doc.id)}
                                  className="p-1 rounded hover:bg-red-900/20 text-slate-500 hover:text-red-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Document summary */}
                {documents.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-900/40 border border-slate-800 rounded-xl text-xs">
                    <div className="flex items-center gap-4">
                      <span className="text-slate-500">Total: <span className="text-white font-mono">{documents.length}</span></span>
                      <span className="text-emerald-400">{documents.filter((d) => d.verificationStatus === "verified").length} verified</span>
                      <span className="text-amber-400">{documents.filter((d) => d.verificationStatus === "pending").length} pending</span>
                      <span className="text-red-400">{documents.filter((d) => d.verificationStatus === "rejected").length} rejected</span>
                    </div>
                    {documents.every((d) => d.verificationStatus === "verified") && (
                      <span className="text-emerald-400 flex items-center gap-1 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" /> All documents verified
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
