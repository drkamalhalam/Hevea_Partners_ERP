import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPaymentReceivers,
  useCreatePaymentReceiver,
  useUpdatePaymentReceiver,
  useDeactivatePaymentReceiver,
  useListProjects,
  useListUsers,
  getListPaymentReceiversQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { Plus, CreditCard, Star, Pencil, XCircle } from "lucide-react";

const TYPE_ICONS: Record<string, string> = { upi: "UPI", bank: "BANK", cash: "CASH", other: "OTHER" };
const TYPE_COLORS: Record<string, string> = {
  upi: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  bank: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  cash: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  other: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

const BLANK_FORM = {
  projectId: "",
  ownerUserId: "",
  ownerName: "",
  ownerRole: "developer",
  accountName: "",
  paymentType: "upi",
  accountIdentifier: "",
  bankIfsc: "",
  bankName: "",
  allowedPaymentModes: "both",
  isDefault: false,
  notes: "",
};

export default function PaymentReceivers() {
  const { selectedProjectId } = useProjectFilter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM, projectId: selectedProjectId ?? "" });

  const { data: accounts = [], isLoading } = useListPaymentReceivers({
    projectId: selectedProjectId ?? undefined,
    activeOnly: "false",
  });
  const { data: projects = [] } = useListProjects();
  const { data: users = [] } = useListUsers({});

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPaymentReceiversQueryKey() });

  const createMut = useCreatePaymentReceiver({
    mutation: {
      onSuccess: () => { invalidate(); setShowForm(false); toast({ title: "Account created" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });
  const updateMut = useUpdatePaymentReceiver({
    mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) },
  });
  const deactivateMut = useDeactivatePaymentReceiver({
    mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) },
  });

  const handleUserSelect = (userId: string) => {
    const user = (users as any[]).find(u => u.id === userId);
    setForm(f => ({ ...f, ownerUserId: userId, ownerName: user?.displayName ?? "", ownerRole: user?.role ?? f.ownerRole }));
  };

  const handleCreate = () => {
    if (!form.projectId || !form.ownerName || !form.accountName) {
      toast({ variant: "destructive", title: "Fill all required fields" });
      return;
    }
    createMut.mutate({ data: {
      projectId: form.projectId,
      ownerUserId: form.ownerUserId || undefined,
      ownerName: form.ownerName,
      ownerRole: form.ownerRole,
      accountName: form.accountName,
      paymentType: form.paymentType as any,
      accountIdentifier: form.accountIdentifier || undefined,
      bankIfsc: form.bankIfsc || undefined,
      bankName: form.bankName || undefined,
      allowedPaymentModes: form.allowedPaymentModes as any,
      isDefault: form.isDefault,
      notes: form.notes || undefined,
    } });
  };

  const active = (accounts as any[]).filter(a => a.isActive);
  const inactive = (accounts as any[]).filter(a => !a.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Payment Receiver Accounts</h1>
          <p className="text-sm text-gray-400 mt-1">Approved accounts that can receive sale payments</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 gap-2" onClick={() => { setForm({ ...BLANK_FORM, projectId: selectedProjectId ?? "" }); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Add Account
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-800 rounded-xl animate-pulse" />)}</div>
      ) : active.length === 0 ? (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="flex flex-col items-center py-16 text-gray-400 gap-3">
            <CreditCard className="w-12 h-12 opacity-30" />
            <p className="text-lg font-medium">No payment accounts configured</p>
            <p className="text-sm">Add approved accounts for sellers to choose from</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((acc: any) => (
            <Card key={acc.id} className="bg-gray-800 border-gray-700 hover:border-gray-600 transition-all">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold">{acc.accountName}</span>
                      {acc.isDefault && <Badge className="text-xs border bg-yellow-500/20 text-yellow-300 border-yellow-500/30 gap-1"><Star className="w-3 h-3" />Default</Badge>}
                      <Badge className={`text-xs border ${TYPE_COLORS[acc.paymentType] ?? ""}`}>{TYPE_ICONS[acc.paymentType] ?? acc.paymentType}</Badge>
                    </div>
                    <div className="mt-1.5 text-sm text-gray-300 space-y-0.5">
                      <div><span className="text-gray-500">Owner:</span> {acc.ownerName} <span className="text-gray-500">({acc.ownerRole})</span></div>
                      {acc.accountIdentifier && <div className="font-mono text-blue-300">{acc.accountIdentifier}</div>}
                      {acc.bankName && <div className="text-gray-400">{acc.bankName} {acc.bankIfsc && `· IFSC: ${acc.bankIfsc}`}</div>}
                      <div><span className="text-gray-500">Modes:</span> {(acc.allowedPaymentModes ?? "").replace(/_/g, " ")}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!acc.isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-yellow-400 hover:bg-yellow-500/10 p-1.5 h-auto"
                        title="Set as default"
                        onClick={() => updateMut.mutate({ id: acc.id, data: { isDefault: true } })}
                      >
                        <Star className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:bg-red-500/10 p-1.5 h-auto"
                      title="Deactivate"
                      onClick={() => deactivateMut.mutate(acc.id)}
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {inactive.length > 0 && (
        <Card className="bg-gray-800/50 border-gray-700/50">
          <CardHeader><CardTitle className="text-gray-500 text-sm">Deactivated Accounts ({inactive.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {inactive.map((acc: any) => (
              <div key={acc.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50 text-sm">
                <div>
                  <span className="text-gray-400 line-through">{acc.accountName}</span>
                  <span className="text-gray-600 ml-2">({acc.ownerName})</span>
                </div>
                <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white text-xs h-auto py-1"
                  onClick={() => updateMut.mutate({ id: acc.id, data: { isActive: true } })}>
                  Reactivate
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add account dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Payment Receiver Account</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-gray-300">Project *</Label>
              <Select value={form.projectId} onValueChange={v => setForm(f => ({ ...f, projectId: v }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {(projects as any[]).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-300">Owner User</Label>
              <Select value={form.ownerUserId} onValueChange={handleUserSelect}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {(users as any[]).map(u => <SelectItem key={u.id} value={u.id}>{u.displayName} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select>
              {!form.ownerUserId && (
                <Input className="bg-gray-800 border-gray-700 text-white mt-2" placeholder="Or type owner name" value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-gray-300">Account Name *</Label>
                <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="e.g. Ravi UPI" value={form.accountName} onChange={e => setForm(f => ({ ...f, accountName: e.target.value }))} />
              </div>
              <div>
                <Label className="text-gray-300">Payment Type</Label>
                <Select value={form.paymentType} onValueChange={v => setForm(f => ({ ...f, paymentType: v }))}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.paymentType !== "cash" && (
              <div>
                <Label className="text-gray-300">Account Identifier</Label>
                <Input className="bg-gray-800 border-gray-700 text-white mt-1 font-mono" placeholder={form.paymentType === "upi" ? "user@upi" : "Account number"} value={form.accountIdentifier} onChange={e => setForm(f => ({ ...f, accountIdentifier: e.target.value }))} />
              </div>
            )}
            {form.paymentType === "bank" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-300">Bank Name</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="SBI" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-gray-300">IFSC</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white mt-1 font-mono" placeholder="SBIN0001234" value={form.bankIfsc} onChange={e => setForm(f => ({ ...f, bankIfsc: e.target.value }))} />
                </div>
              </div>
            )}
            <div>
              <Label className="text-gray-300">Allowed Payment Modes</Label>
              <Select value={form.allowedPaymentModes} onValueChange={v => setForm(f => ({ ...f, allowedPaymentModes: v }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online_only">Online Only</SelectItem>
                  <SelectItem value="cash_only">Cash Only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isDefault} onCheckedChange={v => setForm(f => ({ ...f, isDefault: v }))} />
              <Label className="text-gray-300">Set as default account for this project</Label>
            </div>
            <div>
              <Label className="text-gray-300">Notes</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="Optional" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleCreate} disabled={createMut.isPending}>
                {createMut.isPending ? "Adding..." : "Add Account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
