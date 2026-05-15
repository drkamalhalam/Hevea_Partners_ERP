import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProductionAssignments,
  useCreateProductionAssignment,
  useDeactivateProductionAssignment,
  useListProjects,
  useListObservationAssignments,
  useCreateObservationAssignment,
  useCloseObservationAssignment,
  getListProductionAssignmentsQueryKey,
  getListObservationAssignmentsQueryKey,
} from "@workspace/api-client-react";
import { Users, Plus, X, Eye, UserCheck, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function EmployeeAssignments() {
  const qc = useQueryClient();
  const [filterProject, setFilterProject] = useState("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showObsDialog, setShowObsDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"assignments" | "observers">("assignments");
  const [error, setError] = useState("");

  // Assign form
  const [aEmployeeId, setAEmployeeId] = useState("");
  const [aProjectId, setAProjectId] = useState("");
  const [aRole, setARole] = useState("collector");
  const [aNotes, setANotes] = useState("");

  // Observer form
  const [oProjectId, setOProjectId] = useState("");
  const [oObserverUserId, setOObserverUserId] = useState("");
  const [oStart, setOStart] = useState("");
  const [oEnd, setOEnd] = useState("");
  const [oNotes, setONotes] = useState("");

  const projectsQuery = useListProjects({ query: { queryKey: ["projects"] } });
  const projects: any[] = (projectsQuery.data as any) ?? [];

  const assignmentsQuery = useListProductionAssignments(
    { projectId: filterProject || undefined, activeOnly: "false" },
    {
      query: { queryKey: ["productionAssignments", filterProject, "all"] },
    },
  );
  const assignments: any[] = (assignmentsQuery.data as any) ?? [];

  const obsQuery = useListObservationAssignments(
    { projectId: filterProject || undefined },
    {
      query: { queryKey: ["observationAssignments", filterProject] },
    },
  );
  const obsAssignments: any[] = (obsQuery.data as any) ?? [];

  const createMut = useCreateProductionAssignment();
  const deactivateMut = useDeactivateProductionAssignment();
  const createObsMut = useCreateObservationAssignment();
  const closeObsMut = useCloseObservationAssignment();

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListProductionAssignmentsQueryKey() });
    qc.invalidateQueries({ queryKey: getListObservationAssignmentsQueryKey() });
  }

  async function handleAssign() {
    if (!aEmployeeId || !aProjectId) {
      setError("Employee ID and Project are required.");
      return;
    }
    setError("");
    try {
      await createMut.mutateAsync({
        data: { employeeId: aEmployeeId, projectId: aProjectId, role: aRole, notes: aNotes || undefined },
      });
      invalidate();
      setShowAssignDialog(false);
      setAEmployeeId(""); setAProjectId(""); setARole("collector"); setANotes("");
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to assign.");
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await deactivateMut.mutateAsync({ id });
      invalidate();
    } catch { /* ignore */ }
  }

  async function handleCreateObs() {
    if (!oProjectId || !oObserverUserId || !oStart) {
      setError("Project, Observer ID, and Start time are required.");
      return;
    }
    setError("");
    try {
      await createObsMut.mutateAsync({
        data: { projectId: oProjectId, observerUserId: oObserverUserId, startDatetime: oStart, endDatetime: oEnd || undefined, notes: oNotes || undefined },
      });
      invalidate();
      setShowObsDialog(false);
      setOProjectId(""); setOObserverUserId(""); setOStart(""); setOEnd(""); setONotes("");
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to create observation.");
    }
  }

  async function handleCloseObs(id: string) {
    try {
      await closeObsMut.mutateAsync({ id });
      invalidate();
    } catch { /* ignore */ }
  }

  function fmtDt(dt: string | null | undefined) {
    if (!dt) return "—";
    try { return format(new Date(dt), "d MMM yyyy HH:mm"); } catch { return dt; }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-slate-100 text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" /> Employee Assignments
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage collector assignments and observer sessions</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setShowObsDialog(true); setError(""); }}
            variant="outline" className="border-slate-700 text-slate-300 hover:border-slate-500 gap-1.5">
            <Eye className="w-4 h-4" /> Add Observer
          </Button>
          <Button size="sm" onClick={() => { setShowAssignDialog(true); setError(""); }}
            className="bg-blue-700 hover:bg-blue-600 text-white gap-1.5">
            <Plus className="w-4 h-4" /> Assign Employee
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterProject} onValueChange={setFilterProject}>
          <SelectTrigger className="w-48 bg-slate-900 border-slate-700 text-slate-300">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Projects</SelectItem>
            {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex rounded-lg border border-slate-700 overflow-hidden">
          {(["assignments", "observers"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${activeTab === tab ? "bg-blue-700 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Assignments tab */}
      {activeTab === "assignments" && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
          {assignmentsQuery.isLoading ? (
            <div className="flex items-center gap-3 py-10 justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : assignments.length === 0 ? (
            <div className="py-12 text-center">
              <UserCheck className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No assignments found. Assign employees to projects to get started.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Employee ID</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Project</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Role</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Assigned</th>
                  <th className="text-left px-5 py-3 text-slate-500 font-medium">Status</th>
                  <th className="w-12 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a: any) => (
                  <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                    <td className="px-5 py-3">
                      <p className="text-slate-200 font-medium">{a.employeeName ?? "—"}</p>
                      <p className="text-slate-600 text-xs font-mono">{a.employeeId.slice(0, 8)}…</p>
                    </td>
                    <td className="px-5 py-3 text-slate-300">{a.projectName ?? a.projectId.slice(0, 8)}</td>
                    <td className="px-5 py-3 text-slate-400 capitalize">{a.role}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{a.assignedDate}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${a.isActive ? "bg-emerald-900/40 text-emerald-300" : "bg-slate-700/40 text-slate-500"}`}>
                        {a.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {a.isActive && (
                        <button
                          onClick={() => handleDeactivate(a.id)}
                          className="text-slate-600 hover:text-red-400 transition-colors p-1"
                          title="Deactivate"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Observers tab */}
      {activeTab === "observers" && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
          {obsQuery.isLoading ? (
            <div className="flex items-center gap-3 py-10 justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading…
            </div>
          ) : obsAssignments.length === 0 ? (
            <div className="py-12 text-center">
              <Eye className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No observation assignments found.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {obsAssignments.map((obs: any) => {
                const isOpen = !obs.endDatetime || new Date(obs.endDatetime) > new Date();
                return (
                  <div key={obs.id} className="flex items-start justify-between px-5 py-4 gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck className="w-4 h-4 text-blue-400" />
                        <p className="text-slate-200 font-medium text-sm">{obs.observerDisplayName ?? obs.observerName ?? "—"}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isOpen ? "bg-blue-900/40 text-blue-300" : "bg-slate-700/40 text-slate-500"}`}>
                          {isOpen ? "Active" : "Closed"}
                        </span>
                      </div>
                      <p className="text-slate-500 text-xs">{obs.projectName ?? "—"}</p>
                      <p className="text-slate-600 text-xs mt-1">
                        {fmtDt(obs.startDatetime)} → {obs.endDatetime ? fmtDt(obs.endDatetime) : "Open"}
                      </p>
                      {obs.notes && <p className="text-slate-600 text-xs mt-1 italic">{obs.notes}</p>}
                    </div>
                    {isOpen && (
                      <Button size="sm" variant="outline" onClick={() => handleCloseObs(obs.id)}
                        className="border-slate-700 text-slate-400 hover:border-red-600 hover:text-red-400 shrink-0">
                        Close
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Assign employee dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Assign Employee to Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}
            <div>
              <Label className="text-slate-300 mb-1 block">Employee User ID</Label>
              <Input value={aEmployeeId} onChange={e => setAEmployeeId(e.target.value)}
                placeholder="Paste user UUID from Admin panel"
                className="bg-slate-900/60 border-slate-700 text-slate-100 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Project</Label>
              <Select value={aProjectId} onValueChange={setAProjectId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Role</Label>
              <Select value={aRole} onValueChange={setARole}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collector">Collector</SelectItem>
                  <SelectItem value="store_keeper">Store Keeper</SelectItem>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Notes (optional)</Label>
              <Input value={aNotes} onChange={e => setANotes(e.target.value)}
                placeholder="Any notes about this assignment"
                className="bg-slate-900/60 border-slate-700 text-slate-100" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setShowAssignDialog(false)} className="text-slate-400">Cancel</Button>
              <Button onClick={handleAssign} disabled={createMut.isPending} className="bg-blue-700 hover:bg-blue-600 text-white">
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Assign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Observer dialog */}
      <Dialog open={showObsDialog} onOpenChange={setShowObsDialog}>
        <DialogContent className="bg-slate-950 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Add Observer Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}
            <div>
              <Label className="text-slate-300 mb-1 block">Project</Label>
              <Select value={oProjectId} onValueChange={setOProjectId}>
                <SelectTrigger className="bg-slate-900/60 border-slate-700 text-slate-300">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Observer User ID</Label>
              <Input value={oObserverUserId} onChange={e => setOObserverUserId(e.target.value)}
                placeholder="Paste user UUID from Admin panel"
                className="bg-slate-900/60 border-slate-700 text-slate-100 font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 mb-1 block">Start</Label>
                <Input type="datetime-local" value={oStart} onChange={e => setOStart(e.target.value)}
                  className="bg-slate-900/60 border-slate-700 text-slate-100" />
              </div>
              <div>
                <Label className="text-slate-300 mb-1 block">End (optional)</Label>
                <Input type="datetime-local" value={oEnd} onChange={e => setOEnd(e.target.value)}
                  className="bg-slate-900/60 border-slate-700 text-slate-100" />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 mb-1 block">Notes</Label>
              <Input value={oNotes} onChange={e => setONotes(e.target.value)}
                placeholder="Purpose of observation"
                className="bg-slate-900/60 border-slate-700 text-slate-100" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setShowObsDialog(false)} className="text-slate-400">Cancel</Button>
              <Button onClick={handleCreateObs} disabled={createObsMut.isPending} className="bg-blue-700 hover:bg-blue-600 text-white">
                {createObsMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
