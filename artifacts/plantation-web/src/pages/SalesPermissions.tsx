import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  useListSalesPermissions,
  useCreateSalesPermission,
  useRevokeSalesPermission,
  useListProjects,
  useListUsers,
  getListSalesPermissionsQueryKey,
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
import { Plus, ShieldCheck, UserX } from "lucide-react";

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd MMM yyyy"); } catch { return v; }
}

const ROLE_COLORS: Record<string, string> = {
  developer: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  landowner: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  employee: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  operational_staff: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

export default function SalesPermissions() {
  const { selectedProjectId } = useProjectFilter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);

  const [form, setForm] = useState({
    projectId: selectedProjectId ?? "",
    userId: "",
    userName: "",
    roleType: "employee",
    canSell: true,
    canReceivePayment: false,
    allowedPaymentModes: "both",
    notes: "",
  });

  const { data: perms = [], isLoading } = useListSalesPermissions({
    projectId: selectedProjectId ?? undefined,
    activeOnly: "false",
  });
  const { data: projects = [] } = useListProjects();
  const { data: users = [] } = useListUsers({});

  const invalidate = () => qc.invalidateQueries({ queryKey: getListSalesPermissionsQueryKey() });

  const createMut = useCreateSalesPermission({
    mutation: {
      onSuccess: () => { invalidate(); setShowForm(false); toast({ title: "Permission granted" }); },
      onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }),
    },
  });
  const revokeMut = useRevokeSalesPermission({
    mutation: { onSuccess: invalidate, onError: (e: any) => toast({ variant: "destructive", title: e?.response?.data?.error ?? "Error" }) },
  });

  const handleUserSelect = (userId: string) => {
    const user = (users as any[]).find(u => u.id === userId);
    setForm(f => ({ ...f, userId, userName: user?.displayName ?? "", roleType: user?.role ?? f.roleType }));
  };

  const handleCreate = () => {
    if (!form.projectId || !form.userName) {
      toast({ variant: "destructive", title: "Fill all required fields" });
      return;
    }
    createMut.mutate({ data: {
      projectId: form.projectId,
      userId: form.userId,
      userName: form.userName,
      roleType: form.roleType as any,
      canSell: form.canSell,
      canReceivePayment: form.canReceivePayment,
      allowedPaymentModes: form.allowedPaymentModes as any,
      notes: form.notes || undefined,
    } });
  };

  const active = (perms as any[]).filter(p => p.isActive);
  const revoked = (perms as any[]).filter(p => !p.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Sales Permissions</h1>
          <p className="text-sm text-gray-400 mt-1">Control who can create sales orders per project</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700 gap-2" onClick={() => { setForm({ projectId: selectedProjectId ?? "", userId: "", userName: "", roleType: "employee", canSell: true, canReceivePayment: false, allowedPaymentModes: "both", notes: "" }); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Grant Permission
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-gray-800 rounded-xl animate-pulse" />)}</div>
      ) : active.length === 0 ? (
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="flex flex-col items-center py-16 text-gray-400 gap-3">
            <ShieldCheck className="w-12 h-12 opacity-30" />
            <p className="text-lg font-medium">No sales permissions configured</p>
            <p className="text-sm">Grant permissions to allow users to create sales</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.map((p: any) => (
            <Card key={p.id} className="bg-gray-800 border-gray-700 hover:border-gray-600 transition-all">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-semibold">{p.userName}</span>
                      <Badge className={`text-xs border capitalize ${ROLE_COLORS[p.roleType] ?? "bg-gray-700 text-gray-300"}`}>{p.roleType.replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="mt-1.5 text-sm text-gray-400">{p.projectName}</div>
                    <div className="flex gap-3 mt-2 flex-wrap">
                      <span className={`text-xs flex items-center gap-1 ${p.canSell ? "text-emerald-300" : "text-gray-500"}`}>
                        <span className={`w-2 h-2 rounded-full ${p.canSell ? "bg-emerald-400" : "bg-gray-600"}`} />
                        Can Sell
                      </span>
                      <span className={`text-xs flex items-center gap-1 ${p.canReceivePayment ? "text-blue-300" : "text-gray-500"}`}>
                        <span className={`w-2 h-2 rounded-full ${p.canReceivePayment ? "bg-blue-400" : "bg-gray-600"}`} />
                        Can Receive Payment
                      </span>
                      <span className="text-xs text-gray-500">Modes: {(p.allowedPaymentModes ?? "").replace(/_/g, " ")}</span>
                    </div>
                    {p.notes && <div className="mt-1 text-xs text-gray-500">{p.notes}</div>}
                    <div className="mt-1 text-xs text-gray-600">Granted: {fmt(p.createdAt)} by {p.grantedByName}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:bg-red-500/10 gap-1.5"
                    onClick={() => revokeMut.mutate(p.id)}
                    disabled={revokeMut.isPending}
                  >
                    <UserX className="w-4 h-4" /> Revoke
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {revoked.length > 0 && (
        <div>
          <Button variant="ghost" className="text-gray-500 text-sm" onClick={() => setShowRevoked(v => !v)}>
            {showRevoked ? "Hide" : "Show"} {revoked.length} revoked permission{revoked.length > 1 ? "s" : ""}
          </Button>
          {showRevoked && (
            <Card className="bg-gray-800/50 border-gray-700/50 mt-2">
              <CardContent className="divide-y divide-gray-700/50">
                {revoked.map((p: any) => (
                  <div key={p.id} className="py-3 flex items-center justify-between">
                    <div>
                      <span className="text-gray-500 line-through">{p.userName}</span>
                      <span className="text-gray-600 ml-2 text-sm">({p.projectName})</span>
                    </div>
                    <span className="text-xs text-gray-600">Revoked</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Grant permission dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md">
          <DialogHeader><DialogTitle>Grant Sales Permission</DialogTitle></DialogHeader>
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
              <Label className="text-gray-300">User *</Label>
              <Select value={form.userId} onValueChange={handleUserSelect}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {(users as any[]).map(u => <SelectItem key={u.id} value={u.id}>{u.displayName} ({u.role})</SelectItem>)}
                </SelectContent>
              </Select>
              {!form.userId && (
                <Input className="bg-gray-800 border-gray-700 text-white mt-2" placeholder="Or type user name" value={form.userName} onChange={e => setForm(f => ({ ...f, userName: e.target.value }))} />
              )}
            </div>
            <div>
              <Label className="text-gray-300">Role Type</Label>
              <Select value={form.roleType} onValueChange={v => setForm(f => ({ ...f, roleType: v }))}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="developer">Developer</SelectItem>
                  <SelectItem value="landowner">Landowner</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="operational_staff">Operational Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <div className="space-y-3 bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <Label className="text-gray-300">Can Create Sales</Label>
                <Switch checked={form.canSell} onCheckedChange={v => setForm(f => ({ ...f, canSell: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-gray-300">Can Receive Payment</Label>
                <Switch checked={form.canReceivePayment} onCheckedChange={v => setForm(f => ({ ...f, canReceivePayment: v }))} />
              </div>
            </div>
            <div>
              <Label className="text-gray-300">Notes</Label>
              <Input className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="Optional" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 border-gray-600" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleCreate} disabled={createMut.isPending}>
                {createMut.isPending ? "Granting..." : "Grant Permission"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
