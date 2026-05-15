import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  useGetActivePaymentSettings,
  useListPaymentSettings,
  useCreatePaymentSettings,
  useUpdatePaymentSettings,
  useActivatePaymentSettings,
  useDeactivatePaymentSettings,
  useGetPaymentSettingsAudit,
  getGetActivePaymentSettingsQueryKey,
  getListPaymentSettingsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import {
  Settings, CheckCircle, XCircle, Plus, Edit3,
  Eye, EyeOff, QrCode, Clock, ShieldCheck, Building,
  CreditCard, Smartphone, Phone, Mail, Globe, AlertCircle
} from "lucide-react";

// ── Validation helpers ────────────────────────────────────────────────────────
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

function validateIfsc(v: string) {
  if (!v) return null;
  return IFSC_RE.test(v) ? null : "Invalid IFSC (e.g. SBIN0001234)";
}
function validateUpi(v: string) {
  if (!v) return null;
  return UPI_RE.test(v) ? null : "Invalid UPI ID (e.g. business@upi)";
}

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd MMM yyyy, HH:mm"); } catch { return v; }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface FormState {
  displayName: string;
  businessName: string;
  accountHolderName: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  ifscCode: string;
  upiId: string;
  merchantName: string;
  razorpayKeyId: string;
  razorpaySecret: string;
  paymentCallbackUrl: string;
  supportPhone: string;
  supportEmail: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  displayName: "Main Payment Account",
  businessName: "", accountHolderName: "",
  bankName: "", branchName: "", accountNumber: "", ifscCode: "",
  upiId: "", merchantName: "",
  razorpayKeyId: "", razorpaySecret: "",
  paymentCallbackUrl: "", supportPhone: "", supportEmail: "", notes: "",
};

function fromAccount(acc: any): FormState {
  return {
    displayName: acc.displayName ?? "Main Payment Account",
    businessName: acc.businessName ?? "",
    accountHolderName: acc.accountHolderName ?? "",
    bankName: acc.bankName ?? "",
    branchName: acc.branchName ?? "",
    accountNumber: acc.accountNumber ?? "",
    ifscCode: acc.ifscCode ?? "",
    upiId: acc.upiId ?? "",
    merchantName: acc.merchantName ?? "",
    razorpayKeyId: acc.razorpayKeyId ?? "",
    razorpaySecret: "",
    paymentCallbackUrl: acc.paymentCallbackUrl ?? "",
    supportPhone: acc.supportPhone ?? "",
    supportEmail: acc.supportEmail ?? "",
    notes: acc.notes ?? "",
  };
}

// ── UPI QR Preview ────────────────────────────────────────────────────────────
function UpiPreview({ upiId, merchantName }: { upiId: string; merchantName: string }) {
  if (!upiId || !UPI_RE.test(upiId)) return null;
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName || "Merchant")}&cu=INR`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&ecc=M&margin=1&data=${encodeURIComponent(upiUrl)}`;
  return (
    <div className="flex items-center gap-4 bg-gray-900 rounded-xl p-4 mt-3">
      <div className="bg-white rounded-lg p-2 flex-shrink-0">
        <img src={qrSrc} alt="UPI QR" className="w-20 h-20" />
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide">Live QR Preview</p>
        <p className="text-white font-mono text-sm font-semibold mt-1">{upiId}</p>
        {merchantName && <p className="text-gray-400 text-xs">{merchantName}</p>}
      </div>
    </div>
  );
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
function AuditLog({ accountId }: { accountId: string }) {
  const { data: entries = [] } = useGetPaymentSettingsAudit(accountId);

  if ((entries as any[]).length === 0) {
    return <p className="text-gray-500 text-sm text-center py-8">No audit entries yet</p>;
  }

  return (
    <div className="space-y-2">
      {(entries as any[]).map((entry) => (
        <div key={entry.id} className="flex gap-3 p-3 bg-gray-900 rounded-xl text-sm">
          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
            entry.action === "activated" ? "bg-emerald-500"
            : entry.action === "deactivated" ? "bg-red-500"
            : entry.action === "created" ? "bg-blue-500"
            : "bg-amber-500"
          }`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-medium capitalize">{entry.action}</span>
              <span className="text-gray-500 text-xs">by {entry.changedByName || "System"}</span>
              {entry.ipAddress && <span className="text-gray-600 text-xs font-mono">{entry.ipAddress}</span>}
            </div>
            <p className="text-gray-500 text-xs mt-0.5">{fmt(entry.changedAt)}</p>
            {entry.changes && Object.keys(entry.changes).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(entry.changes as Record<string, { old: string; new: string }>).map(([field, change]) => (
                  <div key={field} className="text-xs">
                    <span className="text-gray-400 capitalize">{field}:</span>{" "}
                    <span className="text-red-400 line-through">{change.old || "(empty)"}</span>{" "}
                    →{" "}
                    <span className="text-emerald-400">{change.new || "(empty)"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Account Form ──────────────────────────────────────────────────────────────
function AccountForm({
  initial,
  editingId,
  hasRazorpaySecret,
  onSave,
  onCancel,
  isPending,
}: {
  initial: FormState;
  editingId: string | null;
  hasRazorpaySecret?: boolean;
  onSave: (data: FormState) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [showSecret, setShowSecret] = useState(false);

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  const ifscError = validateIfsc(form.ifscCode.toUpperCase());
  const upiError = validateUpi(form.upiId);
  const hasError = !!(ifscError || upiError);

  function handleSave() {
    const cleaned = { ...form, ifscCode: form.ifscCode.toUpperCase() };
    onSave(cleaned);
  }

  const Field = ({
    label, field, placeholder, type = "text", hint, error, icon: Icon,
  }: {
    label: string;
    field: keyof FormState;
    placeholder?: string;
    type?: string;
    hint?: string;
    error?: string | null;
    icon?: any;
  }) => (
    <div>
      <Label className="text-gray-300 text-sm flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-gray-500" />}
        {label}
      </Label>
      <Input
        className={`bg-gray-800 border-gray-700 text-white mt-1.5 h-10 ${error ? "border-red-500" : ""}`}
        type={type}
        placeholder={placeholder}
        value={form[field]}
        onChange={e => set(field, e.target.value)}
      />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
      {hint && !error && <p className="text-gray-500 text-xs mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Display Name */}
      <Field label="Account Label" field="displayName" placeholder="e.g. Main Payment Account" />

      {/* Business & Bank */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3 flex items-center gap-1.5">
          <Building className="w-3.5 h-3.5" /> Business & Bank Details
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Business Name" field="businessName" placeholder="Hevea Partners LLP" />
          <Field label="Account Holder Name" field="accountHolderName" placeholder="Full name on account" />
          <Field label="Bank Name" field="bankName" placeholder="State Bank of India" />
          <Field label="Branch Name" field="branchName" placeholder="Agartala Main Branch" />
          <Field label="Account Number" field="accountNumber" placeholder="Enter account number" />
          <div>
            <Label className="text-gray-300 text-sm">IFSC Code</Label>
            <Input
              className={`bg-gray-800 border-gray-700 text-white mt-1.5 h-10 font-mono uppercase ${ifscError ? "border-red-500" : ""}`}
              placeholder="SBIN0001234"
              value={form.ifscCode}
              onChange={e => set("ifscCode", e.target.value.toUpperCase())}
              maxLength={11}
            />
            {ifscError && <p className="text-red-400 text-xs mt-1">{ifscError}</p>}
            {!ifscError && form.ifscCode && <p className="text-gray-500 text-xs mt-1">Valid IFSC format</p>}
          </div>
        </div>
      </div>

      {/* UPI */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3 flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5" /> UPI Details
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-gray-300 text-sm">UPI ID (VPA)</Label>
            <Input
              className={`bg-gray-800 border-gray-700 text-white mt-1.5 h-10 font-mono ${upiError ? "border-red-500" : ""}`}
              placeholder="business@upi"
              value={form.upiId}
              onChange={e => set("upiId", e.target.value.trim())}
            />
            {upiError && <p className="text-red-400 text-xs mt-1">{upiError}</p>}
          </div>
          <Field label="Merchant Name (shown on QR)" field="merchantName" placeholder="Hevea Partners" />
        </div>
        <UpiPreview upiId={form.upiId} merchantName={form.merchantName} />
      </div>

      {/* Razorpay */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3 flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5" /> Razorpay Integration (optional)
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Razorpay Key ID" field="razorpayKeyId" placeholder="rzp_live_..." />
          <div>
            <Label className="text-gray-300 text-sm">Razorpay Secret Key</Label>
            {hasRazorpaySecret && !form.razorpaySecret && (
              <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 mt-1.5 flex items-center justify-between">
                <span className="font-mono text-gray-500 text-sm">••••••••••••••••••••</span>
                <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs">Saved</Badge>
              </div>
            )}
            <div className="relative mt-1.5">
              <Input
                className="bg-gray-800 border-gray-700 text-white h-10 pr-10"
                type={showSecret ? "text" : "password"}
                placeholder={hasRazorpaySecret ? "Enter new secret to change" : "rzp_secret_..."}
                value={form.razorpaySecret}
                onChange={e => set("razorpaySecret", e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-2.5 text-gray-400 hover:text-white"
                onClick={() => setShowSecret(s => !s)}
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-1">Stored encrypted — never visible after saving</p>
          </div>
        </div>
      </div>

      {/* Contact & Callback */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3 flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5" /> Contact & Callbacks
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Support Phone" field="supportPhone" placeholder="+91 98765 43210" icon={Phone} />
          <Field label="Support Email" field="supportEmail" placeholder="payments@company.com" icon={Mail} />
          <div className="sm:col-span-2">
            <Field label="Payment Callback URL" field="paymentCallbackUrl" placeholder="https://your-domain.com/api/payment-callback" icon={Globe} hint="Razorpay will POST payment confirmations here" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <Field label="Notes (internal)" field="notes" placeholder="Any internal notes about this account" />

      <div className="flex gap-3 pt-2 border-t border-gray-700">
        <Button variant="outline" className="border-gray-600 text-gray-300" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 font-semibold"
          onClick={handleSave}
          disabled={isPending || hasError}
        >
          {isPending ? "Saving..." : editingId ? "Update Account" : "Create Account"}
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PaymentSettings() {
  const { role } = useRole();
  const qc = useQueryClient();
  const { toast } = useToast();

  const canAdmin = ["admin", "developer"].includes(role ?? "");

  const { data: active, isLoading: loadingActive } = useGetActivePaymentSettings();
  const { data: allAccounts = [], isLoading: loadingAll } = useListPaymentSettings();

  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [auditId, setAuditId] = useState<string | null>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetActivePaymentSettingsQueryKey() });
    qc.invalidateQueries({ queryKey: getListPaymentSettingsQueryKey() });
  };

  const createMut = useCreatePaymentSettings({
    mutation: {
      onSuccess: () => { invalidateAll(); setShowForm(false); toast({ title: "Payment account created" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Failed to create" }),
    },
  });
  const updateMut = useUpdatePaymentSettings({
    mutation: {
      onSuccess: () => { invalidateAll(); setShowForm(false); setEditingAccount(null); toast({ title: "Settings updated" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Failed to update" }),
    },
  });
  const activateMut = useActivatePaymentSettings({
    mutation: {
      onSuccess: () => { invalidateAll(); toast({ title: "Account activated — now receiving payments" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });
  const deactivateMut = useDeactivatePaymentSettings({
    mutation: {
      onSuccess: () => { invalidateAll(); toast({ title: "Account deactivated" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });

  function handleSave(data: FormState) {
    const body: any = {
      displayName: data.displayName,
      businessName: data.businessName || undefined,
      accountHolderName: data.accountHolderName || undefined,
      bankName: data.bankName || undefined,
      branchName: data.branchName || undefined,
      accountNumber: data.accountNumber || undefined,
      ifscCode: data.ifscCode || undefined,
      upiId: data.upiId || undefined,
      merchantName: data.merchantName || undefined,
      razorpayKeyId: data.razorpayKeyId || undefined,
      razorpaySecret: data.razorpaySecret || undefined,
      paymentCallbackUrl: data.paymentCallbackUrl || undefined,
      supportPhone: data.supportPhone || undefined,
      supportEmail: data.supportEmail || undefined,
      notes: data.notes || undefined,
    };
    if (editingAccount) {
      updateMut.mutate({ id: editingAccount.id, data: body });
    } else {
      createMut.mutate({ data: body });
    }
  }

  function openEdit(acc: any) {
    setEditingAccount(acc);
    setShowForm(true);
  }

  function openCreate() {
    setEditingAccount(null);
    setShowForm(false);
    setTimeout(() => { setShowForm(true); }, 10);
  }

  const isLoading = loadingActive || loadingAll;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-gray-400" />
            Payment Settings
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Configure the central payment receiving account for all buyer transactions
          </p>
        </div>
        {canAdmin && (
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={openCreate}
          >
            <Plus className="w-4 h-4 mr-2" /> Add Account
          </Button>
        )}
      </div>

      {/* Active Account Banner */}
      {!isLoading && (
        <div className={`rounded-2xl p-5 border ${
          active
            ? "bg-emerald-900/20 border-emerald-500/30"
            : "bg-gray-800 border-amber-500/30"
        }`}>
          {active ? (
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Active Payment Account</span>
                </div>
                <p className="text-white font-bold text-lg">{(active as any).displayName}</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 mt-3 text-sm">
                  {(active as any).upiId && (
                    <div>
                      <span className="text-gray-500">UPI ID</span>
                      <p className="text-white font-mono">{(active as any).upiId}</p>
                    </div>
                  )}
                  {(active as any).bankName && (
                    <div>
                      <span className="text-gray-500">Bank</span>
                      <p className="text-white">{(active as any).bankName}</p>
                    </div>
                  )}
                  {(active as any).accountHolderName && (
                    <div>
                      <span className="text-gray-500">Account Holder</span>
                      <p className="text-white">{(active as any).accountHolderName}</p>
                    </div>
                  )}
                  {(active as any).ifscCode && (
                    <div>
                      <span className="text-gray-500">IFSC</span>
                      <p className="text-white font-mono">{(active as any).ifscCode}</p>
                    </div>
                  )}
                  {(active as any).supportPhone && (
                    <div>
                      <span className="text-gray-500">Support</span>
                      <p className="text-white">{(active as any).supportPhone}</p>
                    </div>
                  )}
                  {(active as any).razorpayKeyId && (
                    <div>
                      <span className="text-gray-500">Razorpay</span>
                      <p className="text-white font-mono text-xs">{(active as any).razorpayKeyId}</p>
                    </div>
                  )}
                </div>
              </div>
              {(active as any).upiId && UPI_RE.test((active as any).upiId) && (
                <div className="bg-white rounded-xl p-3 flex-shrink-0">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&ecc=M&data=${encodeURIComponent(`upi://pay?pa=${encodeURIComponent((active as any).upiId)}&pn=${encodeURIComponent((active as any).merchantName || (active as any).displayName)}&cu=INR`)}`}
                    alt="UPI QR"
                    className="w-24 h-24"
                  />
                </div>
              )}
              {canAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gray-600 text-gray-300"
                  onClick={() => openEdit(active)}
                >
                  <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-amber-300 font-semibold">No Active Payment Account</p>
                <p className="text-gray-400 text-sm">
                  Buyers cannot make UPI payments until you configure and activate a payment account.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs: All Accounts | Audit */}
      <Tabs defaultValue="accounts">
        <TabsList className="bg-gray-800 border border-gray-700">
          <TabsTrigger value="accounts" className="data-[state=active]:bg-gray-700">
            All Accounts
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-gray-700" disabled={!active}>
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* ── All Accounts ─────────────────────────────────────── */}
        <TabsContent value="accounts" className="mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <div key={i} className="h-24 bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
          ) : (allAccounts as any[]).length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No payment accounts configured</p>
              <p className="text-sm mt-1">Add one using the button above</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(allAccounts as any[]).map((acc) => (
                <Card key={acc.id} className={`bg-gray-800 border ${acc.isActive ? "border-emerald-500/40" : "border-gray-700"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-semibold">{acc.displayName}</p>
                          <Badge className={acc.isActive
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-gray-600/20 text-gray-400 border border-gray-600/30"
                          }>
                            {acc.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {acc.hasRazorpaySecret && (
                            <Badge className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs">
                              <ShieldCheck className="w-3 h-3 mr-1" /> Razorpay
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
                          {acc.upiId && (
                            <span className="text-gray-400">UPI: <span className="text-white font-mono">{acc.upiId}</span></span>
                          )}
                          {acc.bankName && (
                            <span className="text-gray-400">Bank: <span className="text-white">{acc.bankName}</span></span>
                          )}
                          {acc.accountHolderName && (
                            <span className="text-gray-400">Holder: <span className="text-white">{acc.accountHolderName}</span></span>
                          )}
                        </div>
                        <p className="text-gray-600 text-xs mt-1">Updated {fmt(acc.updatedAt)} by {acc.updatedByName || "—"}</p>
                      </div>
                      {canAdmin && (
                        <div className="flex gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gray-600 text-gray-300 hover:text-white"
                            onClick={() => setAuditId(acc.id === auditId ? null : acc.id)}
                          >
                            <Clock className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-gray-600 text-gray-300 hover:text-white"
                            onClick={() => openEdit(acc)}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>
                          {acc.isActive ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                              onClick={() => deactivateMut.mutate({ id: acc.id })}
                              disabled={deactivateMut.isPending}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Deactivate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => activateMut.mutate({ id: acc.id })}
                              disabled={activateMut.isPending}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Activate
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {auditId === acc.id && (
                      <div className="mt-4 pt-4 border-t border-gray-700">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Audit Log</p>
                        <AuditLog accountId={acc.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Audit Log ────────────────────────────────────────── */}
        <TabsContent value="audit" className="mt-4">
          {active ? (
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  Audit Log — {(active as any).displayName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AuditLog accountId={(active as any).id} />
              </CardContent>
            </Card>
          ) : (
            <p className="text-gray-500 text-center py-8">No active account selected</p>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Edit / Create Dialog ──────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingAccount(null); } }}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {editingAccount ? `Edit — ${editingAccount.displayName}` : "Add Payment Account"}
            </DialogTitle>
          </DialogHeader>
          <AccountForm
            initial={editingAccount ? fromAccount(editingAccount) : EMPTY_FORM}
            editingId={editingAccount?.id ?? null}
            hasRazorpaySecret={editingAccount?.hasRazorpaySecret}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingAccount(null); }}
            isPending={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
