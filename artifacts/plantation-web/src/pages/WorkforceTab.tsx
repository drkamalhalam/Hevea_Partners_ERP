import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWorkforceAssignments,
  useCreateWorkforceAssignment,
  useDeactivateWorkforceAssignment,
  getListWorkforceAssignmentsQueryKey,
} from "@workspace/api-client-react";
import {
  Plus,
  X,
  Eye,
  UserCheck,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  HardHat,
  PhoneCall,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PersonMasterSelector, type PersonSummary } from "@/components/PersonMasterSelector";
import { useRole } from "@/contexts/RoleContext";

const EMPLOYEE_ROLES = [
  { value: "collector", label: "Collector" },
  { value: "store_keeper", label: "Store Keeper" },
  { value: "supervisor", label: "Supervisor" },
  { value: "field_worker", label: "Field Worker" },
  { value: "manager", label: "Manager" },
  { value: "governance_staff", label: "Governance Staff" },
];

const OBSERVER_TYPES = [
  { value: "routine", label: "Routine" },
  { value: "surprise", label: "Surprise" },
  { value: "audit", label: "Audit" },
  { value: "verification", label: "Verification" },
];

type AssignmentType = "employee" | "observer" | "supervisor";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "d MMM yyyy"); } catch { return d; }
}

interface Props {
  projectId: string;
}

export default function WorkforceTab({ projectId }: Props) {
  const qc = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const [activeTab, setActiveTab] = useState<AssignmentType>("employee");
  const [showDialog, setShowDialog] = useState(false);
  const [dialogType, setDialogType] = useState<AssignmentType>("employee");
  const [error, setError] = useState("");

  const [selectedPerson, setSelectedPerson] = useState<PersonSummary | null>(null);
  const [dRoleType, setDRoleType] = useState("collector");
  const [dStartDate, setDStartDate] = useState("");
  const [dEndDate, setDEndDate] = useState("");
  const [dNotes, setDNotes] = useState("");
  const [dObsType, setDObsType] = useState("routine");

  const workforceQ = useListWorkforceAssignments(
    { projectId, assignmentType: activeTab },
    { query: { queryKey: ["workforce-tab", projectId, activeTab] } },
  );
  const assignments: any[] = (workforceQ.data as any) ?? [];
  const active = assignments.filter((a: any) => a.isActive);
  const inactive = assignments.filter((a: any) => !a.isActive);

  const createMut = useCreateWorkforceAssignment();
  const deactivateMut = useDeactivateWorkforceAssignment();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListWorkforceAssignmentsQueryKey() });
  }

  function openDialog(type: AssignmentType) {
    setDialogType(type);
    setSelectedPerson(null);
    setDRoleType("collector");
    setDStartDate("");
    setDEndDate("");
    setDNotes("");
    setDObsType("routine");
    setError("");
    setShowDialog(true);
  }

  async function handleSubmit() {
    if (!selectedPerson) { setError("Select a person from the registry."); return; }
    setError("");
    try {
      await createMut.mutateAsync({
        data: {
          personId: selectedPerson.id,
          projectId,
          roleType: dRoleType,
          assignmentType: dialogType,
          startDate: dStartDate || undefined,
          endDate: dEndDate || undefined,
          notes: dNotes || undefined,
          observationType: dialogType === "observer" ? (dObsType as any) : undefined,
        },
      });
      invalidate();
      setShowDialog(false);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed.");
    }
  }

  async function handleDeactivate(id: string) {
    try { await deactivateMut.mutateAsync({ id }); invalidate(); } catch { /* ignore */ }
  }

  const tabs: { type: AssignmentType; label: string; icon: typeof UserCheck }[] = [
    { type: "employee", label: "Employees", icon: UserCheck },
    { type: "observer", label: "Observers", icon: Eye },
    { type: "supervisor", label: "Supervisors", icon: HardHat },
  ];

  return (
    <div className="space-y-4">
      {/* ── Tab bar + add button ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex rounded-lg border border-slate-700 overflow-hidden">
          {tabs.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === type
                  ? "bg-blue-700 text-white"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
              {activeTab === type && active.length > 0 && (
                <span className="ml-1 bg-white/20 text-white text-[10px] rounded-full px-1.5 py-0.5 leading-none">
                  {active.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openDialog(activeTab)}
            className="border-slate-700 text-slate-300 hover:border-blue-600 hover:text-blue-300 gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Add {activeTab}
          </Button>
        )}
      </div>

      {/* ── Active assignments ───────────────────────────────────────────── */}
      {workforceQ.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : active.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-slate-800 rounded-xl">
          <Users className="w-8 h-8 text-slate-700 mx-auto mb-2" />
          <p className="text-slate-500 text-sm">No active {activeTab}s assigned to this project.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden">
          {active.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-3 gap-4 bg-slate-900/30 hover:bg-slate-900/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-slate-100 text-sm font-medium">{a.personNameSnapshot ?? "—"}</p>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-slate-800/50 text-slate-400 border-slate-700">
                    {a.roleType.replace(/_/g, " ")}
                  </Badge>
                  {a.observationType && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-900/30 text-purple-300 border-purple-800/40 capitalize">
                      {a.observationType}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                  {a.personMobile && (
                    <span className="flex items-center gap-1">
                      <PhoneCall className="w-3 h-3" /> {a.personMobile}
                    </span>
                  )}
                  {a.personAadhaarLast4 && (
                    <span className="font-mono">••••{a.personAadhaarLast4}</span>
                  )}
                  <span>Since {fmtDate(a.startDate)}</span>
                  {a.endDate && <span>→ {fmtDate(a.endDate)}</span>}
                </div>
                {a.notes && <p className="text-slate-600 text-xs mt-0.5 italic">{a.notes}</p>}
              </div>
              {isAdmin && (
                <button
                  onClick={() => handleDeactivate(a.id)}
                  disabled={deactivateMut.isPending}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1 shrink-0"
                  title="End assignment"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Historical ─────────────────────────────────────────────────────── */}
      {inactive.length > 0 && (
        <details className="group">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300 transition-colors select-none">
            {inactive.length} historical assignment{inactive.length !== 1 ? "s" : ""}
          </summary>
          <div className="mt-2 divide-y divide-slate-800/40 border border-slate-800/60 rounded-xl overflow-hidden">
            {inactive.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 opacity-50">
                <p className="text-slate-400 text-xs flex-1">{a.personNameSnapshot ?? "—"}</p>
                <span className="text-slate-600 text-[10px]">{a.roleType.replace(/_/g, " ")}</span>
                <span className="text-slate-700 text-[10px]">{fmtDate(a.startDate)} – {fmtDate(a.endDate)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Assignment dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 capitalize">
              {dialogType === "employee" && <UserCheck className="w-4 h-4 text-blue-400" />}
              {dialogType === "observer" && <Eye className="w-4 h-4 text-purple-400" />}
              {dialogType === "supervisor" && <HardHat className="w-4 h-4 text-emerald-400" />}
              Assign {dialogType}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <div className="[&_.bg-indigo-50]:bg-slate-900/60 [&_.border-indigo-200]:border-slate-700 [&_.text-indigo-900]:text-slate-100 [&_.text-indigo-700]:text-blue-300 [&_.text-indigo-600]:text-blue-400 [&_.bg-white]:bg-slate-900 [&_.text-slate-900]:text-slate-100 [&_.text-slate-700]:text-slate-300 [&_.text-slate-500]:text-slate-500 [&_.border-indigo-300]:border-slate-600 [&_.bg-indigo-100]:bg-slate-800 [&_.border]:border-slate-700">
              <PersonMasterSelector
                selectedPerson={selectedPerson}
                onSelect={setSelectedPerson}
                label="Select Person from Registry"
              />
            </div>

            {dialogType !== "observer" ? (
              <div>
                <Label className="text-slate-300 mb-1.5 block">Role</Label>
                <Select value={dRoleType} onValueChange={setDRoleType}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label className="text-slate-300 mb-1.5 block">Observation Type</Label>
                <Select value={dObsType} onValueChange={setDObsType}>
                  <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBSERVER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 mb-1.5 block">Start Date</Label>
                <Input
                  type="date"
                  value={dStartDate}
                  onChange={(e) => setDStartDate(e.target.value)}
                  className="bg-slate-900/60 border-slate-700 text-slate-100"
                />
              </div>
              <div>
                <Label className="text-slate-300 mb-1.5 block">End Date (optional)</Label>
                <Input
                  type="date"
                  value={dEndDate}
                  onChange={(e) => setDEndDate(e.target.value)}
                  className="bg-slate-900/60 border-slate-700 text-slate-100"
                />
              </div>
            </div>

            <div>
              <Label className="text-slate-300 mb-1.5 block">Notes (optional)</Label>
              <Textarea
                value={dNotes}
                onChange={(e) => setDNotes(e.target.value)}
                placeholder="Any notes about this assignment…"
                rows={2}
                className="bg-slate-900/60 border-slate-700 text-slate-100 resize-none text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="ghost" onClick={() => setShowDialog(false)} className="text-slate-400">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMut.isPending || !selectedPerson}
                className="bg-blue-700 hover:bg-blue-600 text-white"
              >
                {createMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-1.5" />
                )}
                Assign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
