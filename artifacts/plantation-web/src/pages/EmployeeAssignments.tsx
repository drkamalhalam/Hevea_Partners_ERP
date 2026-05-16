import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListWorkforceAssignments,
  useCreateWorkforceAssignment,
  useDeactivateWorkforceAssignment,
  useListProjects,
  getListWorkforceAssignmentsQueryKey,
} from "@workspace/api-client-react";
import {
  Users,
  Plus,
  X,
  Eye,
  UserCheck,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  HardHat,
  PhoneCall,
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

const ASSIGNMENT_TYPE_CONFIG = {
  employee: { icon: UserCheck, color: "bg-blue-900/30 text-blue-300 border-blue-800/50" },
  observer: { icon: Eye, color: "bg-purple-900/30 text-purple-300 border-purple-800/50" },
  supervisor: { icon: ShieldCheck, color: "bg-emerald-900/30 text-emerald-300 border-emerald-800/50" },
} as const;

type AssignmentType = "employee" | "observer" | "supervisor";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "d MMM yyyy"); } catch { return d; }
}

export default function EmployeeAssignments() {
  const qc = useQueryClient();
  const { role } = useRole();
  const isAdmin = role === "admin" || role === "developer";

  const [filterProject, setFilterProject] = useState("__all__");
  const [activeTab, setActiveTab] = useState<AssignmentType>("employee");
  const [showDialog, setShowDialog] = useState(false);
  const [dialogType, setDialogType] = useState<AssignmentType>("employee");
  const [error, setError] = useState("");

  // ── Shared dialog state ──────────────────────────────────────────────────
  const [selectedPerson, setSelectedPerson] = useState<PersonSummary | null>(null);
  const [dProjectId, setDProjectId] = useState("");
  const [dRoleType, setDRoleType] = useState("collector");
  const [dStartDate, setDStartDate] = useState("");
  const [dEndDate, setDEndDate] = useState("");
  const [dNotes, setDNotes] = useState("");
  const [dObsType, setDObsType] = useState("routine");

  const projectsQuery = useListProjects({ query: { queryKey: ["projects"] } });
  const projects: any[] = (projectsQuery.data as any) ?? [];

  const workforceQ = useListWorkforceAssignments(
    {
      projectId: filterProject === "__all__" ? undefined : filterProject,
      assignmentType: activeTab,
    },
    { query: { queryKey: ["workforce", filterProject, activeTab] } },
  );
  const assignments: any[] = (workforceQ.data as any) ?? [];

  const createMut = useCreateWorkforceAssignment();
  const deactivateMut = useDeactivateWorkforceAssignment();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListWorkforceAssignmentsQueryKey() });
  }

  function openDialog(type: AssignmentType) {
    setDialogType(type);
    setSelectedPerson(null);
    setDProjectId("");
    setDRoleType("collector");
    setDStartDate("");
    setDEndDate("");
    setDNotes("");
    setDObsType("routine");
    setError("");
    setShowDialog(true);
  }

  async function handleSubmit() {
    if (!selectedPerson) {
      setError("Select a person from the registry.");
      return;
    }
    if (!dProjectId) {
      setError("Select a project.");
      return;
    }
    if (dialogType === "employee" && !dRoleType) {
      setError("Select a role.");
      return;
    }
    setError("");
    try {
      await createMut.mutateAsync({
        data: {
          personId: selectedPerson.id,
          projectId: dProjectId,
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
      setError(e?.response?.data?.error ?? "Failed to create assignment.");
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await deactivateMut.mutateAsync({ id });
      invalidate();
    } catch { /* ignore */ }
  }

  const tabConfig: { type: AssignmentType; label: string; icon: typeof UserCheck }[] = [
    { type: "employee", label: "Employees", icon: UserCheck },
    { type: "observer", label: "Observers", icon: Eye },
    { type: "supervisor", label: "Supervisors", icon: HardHat },
  ];

  const dialogTitle = dialogType === "employee" ? "Assign Employee"
    : dialogType === "observer" ? "Assign Observer"
    : "Assign Supervisor";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-slate-100 text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" /> Workforce Assignments
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Registry-backed workforce assignment — all identities from Person Registry
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog("observer")}
              className="border-purple-700/60 text-purple-300 hover:border-purple-500 gap-1.5"
            >
              <Eye className="w-4 h-4" /> Add Observer
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDialog("supervisor")}
              className="border-emerald-700/60 text-emerald-300 hover:border-emerald-500 gap-1.5"
            >
              <HardHat className="w-4 h-4" /> Add Supervisor
            </Button>
            <Button
              size="sm"
              onClick={() => openDialog("employee")}
              className="bg-blue-700 hover:bg-blue-600 text-white gap-1.5"
            >
              <Plus className="w-4 h-4" /> Assign Employee
            </Button>
          </div>
        )}
      </div>

      {/* ── Filters / Tabs ────────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-52 bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Projects</SelectItem>
            {projects.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden">
          {tabConfig.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === type
                  ? "bg-blue-700 text-white"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Assignment list ───────────────────────────────────────────────── */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        {workforceQ.isLoading ? (
          <div className="flex items-center gap-3 py-12 justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : assignments.length === 0 ? (
          <div className="py-14 text-center">
            <Users className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No {activeTab} assignments found.</p>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDialog(activeTab)}
                className="mt-4 border-slate-700 text-slate-400"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Add {activeTab}
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Person</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Project</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Role</th>
                {activeTab === "observer" && (
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Type</th>
                )}
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Since</th>
                <th className="text-left px-5 py-3 text-slate-500 font-medium">Status</th>
                {isAdmin && <th className="w-12 px-3" />}
              </tr>
            </thead>
            <tbody>
              {assignments.map((a: any) => {
                const cfg = ASSIGNMENT_TYPE_CONFIG[a.assignmentType as AssignmentType] ?? ASSIGNMENT_TYPE_CONFIG.employee;
                return (
                  <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                    <td className="px-5 py-3">
                      <p className="text-slate-100 font-medium">{a.personNameSnapshot ?? "—"}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {a.personMobile && (
                          <span className="text-slate-600 text-xs flex items-center gap-1">
                            <PhoneCall className="w-3 h-3" /> {a.personMobile}
                          </span>
                        )}
                        {a.personAadhaarLast4 && (
                          <span className="text-slate-700 text-xs font-mono">••••{a.personAadhaarLast4}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-300 text-sm">{a.projectName ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                        {a.roleType.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    {activeTab === "observer" && (
                      <td className="px-5 py-3 text-slate-400 text-xs capitalize">
                        {a.observationType ?? "—"}
                      </td>
                    )}
                    <td className="px-5 py-3 text-slate-500 text-xs">{fmtDate(a.startDate)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        a.isActive
                          ? "bg-emerald-900/40 text-emerald-300"
                          : "bg-slate-700/40 text-slate-500"
                      }`}>
                        {a.isActive ? "Active" : "Ended"}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-3">
                        {a.isActive && (
                          <button
                            onClick={() => handleDeactivate(a.id)}
                            disabled={deactivateMut.isPending}
                            className="text-slate-600 hover:text-red-400 transition-colors p-1"
                            title="End assignment"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Assignment dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogType === "employee" && <UserCheck className="w-4 h-4 text-blue-400" />}
              {dialogType === "observer" && <Eye className="w-4 h-4 text-purple-400" />}
              {dialogType === "supervisor" && <HardHat className="w-4 h-4 text-emerald-400" />}
              {dialogTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            {/* Person selector */}
            <div className="[&_.bg-indigo-50]:bg-slate-900/60 [&_.border-indigo-200]:border-slate-700 [&_.text-indigo-900]:text-slate-100 [&_.text-indigo-700]:text-blue-300 [&_.text-indigo-600]:text-blue-400 [&_.bg-white]:bg-slate-900 [&_.text-slate-900]:text-slate-100 [&_.text-slate-700]:text-slate-300 [&_.text-slate-500]:text-slate-500 [&_.border-indigo-300]:border-slate-600 [&_.bg-indigo-100]:bg-slate-800 [&_.border-indigo-300]:border-slate-600 [&_.border]:border-slate-700">
              <PersonMasterSelector
                selectedPerson={selectedPerson}
                onSelect={setSelectedPerson}
                label="Select Person from Registry"
              />
            </div>

            {/* Project */}
            <div>
              <Label className="text-slate-300 mb-1.5 block">Project</Label>
              <Select value={dProjectId} onValueChange={setDProjectId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Role (employees & supervisors) */}
            {dialogType !== "observer" && (
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
            )}

            {/* Observer type */}
            {dialogType === "observer" && (
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

            {/* Dates */}
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

            {/* Notes */}
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
              <Button
                variant="ghost"
                onClick={() => setShowDialog(false)}
                className="text-slate-400"
              >
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
                Create Assignment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
