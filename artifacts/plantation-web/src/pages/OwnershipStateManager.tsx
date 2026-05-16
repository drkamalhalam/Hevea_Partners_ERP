/**
 * OwnershipStateManager.tsx
 *
 * Per-(project, partner) ownership state manager.
 * Shows transferable / locked / disputed / reserved breakdown for each
 * partner in a selected project. Allows admin/developer to:
 *   - Initialise or update a partner's state record (upsert)
 *   - Mark a % as disputed
 *   - Resolve an active dispute
 *   - Lock / unlock %
 */

import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListProjects,
  useListPartners,
  useListPartnerOwnershipStates,
  useUpsertPartnerOwnershipState,
  useMarkOwnershipDisputed,
  useResolveOwnershipDispute,
  useLockOwnershipPercentage,
  useUnlockOwnershipPercentage,
} from "@workspace/api-client-react";
import type { PartnerOwnershipState } from "@workspace/api-client-react";
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
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  ShieldAlert,
  Lock,
  Unlock,
  CheckCircle2,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function pct(v: string | null | undefined) {
  if (!v) return "0.00000000";
  return parseFloat(v).toFixed(8);
}

function StateBar({ state }: { state: PartnerOwnershipState }) {
  const total = parseFloat(state.totalPercentage) || 0;
  if (total === 0) return <span className="text-muted-foreground text-xs">0%</span>;
  const transferable = parseFloat(state.transferablePercentage) || 0;
  const locked = parseFloat(state.lockedPercentage) || 0;
  const disputed = parseFloat(state.disputedPercentage) || 0;
  const reserved = parseFloat(state.reservedPercentage) || 0;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-sm text-xs">
      {transferable > 0 && (
        <div
          className="bg-emerald-600 flex items-center justify-center text-white"
          style={{ width: `${(transferable / total) * 100}%` }}
          title={`Transferable: ${pct(state.transferablePercentage)}%`}
        />
      )}
      {reserved > 0 && (
        <div
          className="bg-amber-500 flex items-center justify-center text-white"
          style={{ width: `${(reserved / total) * 100}%` }}
          title={`Reserved: ${pct(state.reservedPercentage)}%`}
        />
      )}
      {locked > 0 && (
        <div
          className="bg-slate-500 flex items-center justify-center text-white"
          style={{ width: `${(locked / total) * 100}%` }}
          title={`Locked: ${pct(state.lockedPercentage)}%`}
        />
      )}
      {disputed > 0 && (
        <div
          className="bg-red-600 flex items-center justify-center text-white"
          style={{ width: `${(disputed / total) * 100}%` }}
          title={`Disputed: ${pct(state.disputedPercentage)}%`}
        />
      )}
    </div>
  );
}

export default function OwnershipStateManager() {
  const { role } = useRole();
  const isAdminDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [projectId, setProjectId] = useState("");
  const [selectedState, setSelectedState] = useState<PartnerOwnershipState | null>(null);
  const [dialog, setDialog] = useState<"upsert" | "dispute" | "resolve" | "lock" | "unlock" | null>(null);
  const [err, setErr] = useState("");

  // Upsert form
  const [uPartnerId, setUPartnerId] = useState("");
  const [uTotal, setUTotal] = useState("");
  const [uTransferable, setUTransferable] = useState("");
  const [uLocked, setULocked] = useState("0");
  const [uDisputed, setUDisputed] = useState("0");
  const [uReserved, setUReserved] = useState("0");
  const [uNotes, setUNotes] = useState("");

  // Dispute form
  const [dPct, setDPct] = useState("");
  const [dReason, setDReason] = useState("");
  const [dRef, setDRef] = useState("");

  // Resolve form
  const [rPct, setRPct] = useState("");
  const [rResolution, setRResolution] = useState("");

  // Lock form
  const [lPct, setLPct] = useState("");
  const [lReason, setLReason] = useState("");

  // Unlock form
  const [ulPct, setUlPct] = useState("");
  const [ulReason, setUlReason] = useState("");

  const { data: projectsData } = useListProjects();
  const projects = (projectsData as any) ?? [];

  const { data: partnersData } = useListPartners(projectId ? { projectId } : undefined);
  const partners: any[] = (partnersData as any)?.partners ?? [];

  const statesQuery = useListPartnerOwnershipStates(projectId, {
    query: { enabled: !!projectId, queryKey: ["listPartnerOwnershipStates", projectId] },
  });
  const states: PartnerOwnershipState[] = (statesQuery.data as any) ?? [];

  const upsertMut = useUpsertPartnerOwnershipState();
  const disputeMut = useMarkOwnershipDisputed();
  const resolveMut = useResolveOwnershipDispute();
  const lockMut = useLockOwnershipPercentage();
  const unlockMut = useUnlockOwnershipPercentage();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["listPartnerOwnershipStates"] });
  }

  function openUpsert(s?: PartnerOwnershipState) {
    if (s) {
      setUPartnerId(s.partnerId);
      setUTotal(s.totalPercentage);
      setUTransferable(s.transferablePercentage);
      setULocked(s.lockedPercentage);
      setUDisputed(s.disputedPercentage);
      setUReserved(s.reservedPercentage);
      setUNotes(s.notes ?? "");
    } else {
      setUPartnerId(""); setUTotal(""); setUTransferable("");
      setULocked("0"); setUDisputed("0"); setUReserved("0"); setUNotes("");
    }
    setErr(""); setDialog("upsert");
  }

  function handleUpsert() {
    if (!uPartnerId || !uTotal || !uTransferable) { setErr("Partner, total %, and transferable % are required"); return; }
    upsertMut.mutate(
      {
        projectId,
        data: {
          partnerId: uPartnerId,
          totalPercentage: parseFloat(uTotal),
          transferablePercentage: parseFloat(uTransferable),
          lockedPercentage: parseFloat(uLocked) || 0,
          disputedPercentage: parseFloat(uDisputed) || 0,
          reservedPercentage: parseFloat(uReserved) || 0,
          notes: uNotes || null,
        },
      },
      {
        onSuccess: () => { toast({ title: "Ownership state saved" }); invalidate(); setDialog(null); },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed to save"),
      },
    );
  }

  function handleDispute() {
    if (!selectedState || !dPct || !dReason) { setErr("Disputed % and reason are required"); return; }
    disputeMut.mutate(
      {
        projectId,
        partnerId: selectedState.partnerId,
        data: { disputedPercentage: parseFloat(dPct), disputeReason: dReason, disputeReference: dRef || null },
      },
      {
        onSuccess: () => { toast({ title: "Ownership marked as disputed" }); invalidate(); setDialog(null); },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed"),
      },
    );
  }

  function handleResolve() {
    if (!selectedState || !rPct || !rResolution) { setErr("Released % and resolution are required"); return; }
    resolveMut.mutate(
      {
        projectId,
        partnerId: selectedState.partnerId,
        data: { releasedPercentage: parseFloat(rPct), resolution: rResolution },
      },
      {
        onSuccess: () => { toast({ title: "Dispute resolved" }); invalidate(); setDialog(null); },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed"),
      },
    );
  }

  function handleLock() {
    if (!selectedState || !lPct || !lReason) { setErr("Lock % and reason are required"); return; }
    lockMut.mutate(
      {
        projectId,
        partnerId: selectedState.partnerId,
        data: { lockPercentage: parseFloat(lPct), lockReason: lReason },
      },
      {
        onSuccess: () => { toast({ title: "Ownership locked" }); invalidate(); setDialog(null); },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed"),
      },
    );
  }

  function handleUnlock() {
    if (!selectedState || !ulPct || !ulReason) { setErr("Unlock % and reason are required"); return; }
    unlockMut.mutate(
      {
        projectId,
        partnerId: selectedState.partnerId,
        data: { unlockPercentage: parseFloat(ulPct), reason: ulReason },
      },
      {
        onSuccess: () => { toast({ title: "Ownership unlocked" }); invalidate(); setDialog(null); },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed"),
      },
    );
  }

  const PROJECT_LIST = Array.isArray(projects) ? projects : (projects?.projects ?? []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Ownership State Manager</h1>
          <p className="text-muted-foreground text-sm">
            View and manage each partner's ownership state — transferable, locked, disputed, or reserved.
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {[
          { color: "bg-emerald-600", label: "Transferable" },
          { color: "bg-amber-500", label: "Reserved" },
          { color: "bg-slate-500", label: "Locked" },
          { color: "bg-red-600", label: "Disputed" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${color}`} />
            {label}
          </span>
        ))}
      </div>

      {/* Project picker */}
      <div className="flex items-end gap-3">
        <div className="w-72">
          <Label>Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger><SelectValue placeholder="Select project…" /></SelectTrigger>
            <SelectContent>
              {PROJECT_LIST.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {projectId && isAdminDev && (
          <Button onClick={() => openUpsert()} variant="outline" size="sm">
            <PlusCircle className="h-4 w-4 mr-1" /> Init / Update Partner State
          </Button>
        )}
        {projectId && (
          <Button variant="ghost" size="sm" onClick={() => statesQuery.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        )}
      </div>

      {/* State table */}
      {projectId && (
        statesQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : states.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No ownership state records found for this project.
              {isAdminDev && " Use 'Init / Update Partner State' to create the first record."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {states.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle className="text-base font-semibold">{s.partnerName}</CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground font-mono">Total: {pct(s.totalPercentage)}%</span>
                      {parseFloat(s.disputedPercentage) > 0 && (
                        <Badge variant="destructive" className="text-xs">Disputed</Badge>
                      )}
                      {parseFloat(s.lockedPercentage) > 0 && (
                        <Badge variant="secondary" className="text-xs">Locked</Badge>
                      )}
                      {parseFloat(s.reservedPercentage) > 0 && (
                        <Badge className="text-xs bg-amber-500">Reserved</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <StateBar state={s} />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="rounded bg-emerald-50 dark:bg-emerald-950 p-2">
                      <p className="text-muted-foreground">Transferable</p>
                      <p className="font-mono font-semibold">{pct(s.transferablePercentage)}%</p>
                    </div>
                    <div className="rounded bg-amber-50 dark:bg-amber-950 p-2">
                      <p className="text-muted-foreground">Reserved</p>
                      <p className="font-mono font-semibold">{pct(s.reservedPercentage)}%</p>
                    </div>
                    <div className="rounded bg-slate-50 dark:bg-slate-900 p-2">
                      <p className="text-muted-foreground">Locked</p>
                      <p className="font-mono font-semibold">{pct(s.lockedPercentage)}%</p>
                      {s.lockReason && <p className="text-muted-foreground mt-0.5 truncate">{s.lockReason}</p>}
                    </div>
                    <div className="rounded bg-red-50 dark:bg-red-950 p-2">
                      <p className="text-muted-foreground">Disputed</p>
                      <p className="font-mono font-semibold">{pct(s.disputedPercentage)}%</p>
                      {s.disputeReason && <p className="text-muted-foreground mt-0.5 truncate">{s.disputeReason}</p>}
                    </div>
                  </div>
                  {s.notes && (
                    <p className="text-xs text-muted-foreground border-l-2 pl-2">{s.notes}</p>
                  )}
                  {isAdminDev && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => { setSelectedState(s); openUpsert(s); }}>
                        Edit
                      </Button>
                      {parseFloat(s.transferablePercentage) > 0 && (
                        <>
                          <Button variant="outline" size="sm" className="text-red-600 border-red-300"
                            onClick={() => { setSelectedState(s); setDPct(""); setDReason(""); setDRef(""); setErr(""); setDialog("dispute"); }}>
                            <AlertCircle className="h-3 w-3 mr-1" /> Mark Disputed
                          </Button>
                          {isAdmin && (
                            <Button variant="outline" size="sm" className="text-slate-600"
                              onClick={() => { setSelectedState(s); setLPct(""); setLReason(""); setErr(""); setDialog("lock"); }}>
                              <Lock className="h-3 w-3 mr-1" /> Lock
                            </Button>
                          )}
                        </>
                      )}
                      {parseFloat(s.disputedPercentage) > 0 && (
                        <Button variant="outline" size="sm" className="text-emerald-600 border-emerald-300"
                          onClick={() => { setSelectedState(s); setRPct(""); setRResolution(""); setErr(""); setDialog("resolve"); }}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve Dispute
                        </Button>
                      )}
                      {isAdmin && parseFloat(s.lockedPercentage) > 0 && (
                        <Button variant="outline" size="sm" className="text-blue-600 border-blue-300"
                          onClick={() => { setSelectedState(s); setUlPct(""); setUlReason(""); setErr(""); setDialog("unlock"); }}>
                          <Unlock className="h-3 w-3 mr-1" /> Unlock
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Upsert dialog */}
      <Dialog open={dialog === "upsert"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Initialise / Update Ownership State</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Partner</Label>
              <Select value={uPartnerId} onValueChange={setUPartnerId}>
                <SelectTrigger><SelectValue placeholder="Select partner…" /></SelectTrigger>
                <SelectContent>
                  {partners.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {[
              { label: "Total %", val: uTotal, set: setUTotal },
              { label: "Transferable %", val: uTransferable, set: setUTransferable },
              { label: "Locked %", val: uLocked, set: setULocked },
              { label: "Disputed %", val: uDisputed, set: setUDisputed },
              { label: "Reserved %", val: uReserved, set: setUReserved },
            ].map(({ label, val, set }) => (
              <div key={label}>
                <Label>{label}</Label>
                <Input type="number" step="0.00000001" value={val} onChange={(e) => set(e.target.value)} />
              </div>
            ))}
            <div>
              <Label>Notes</Label>
              <Textarea value={uNotes} onChange={(e) => setUNotes(e.target.value)} rows={2} />
            </div>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" onClick={handleUpsert} disabled={upsertMut.isPending}>
              {upsertMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dispute dialog */}
      <Dialog open={dialog === "dispute"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark Ownership as Disputed</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            For: <strong>{selectedState?.partnerName}</strong> &mdash; currently {pct(selectedState?.transferablePercentage)}% transferable
          </p>
          <div className="space-y-3">
            <div><Label>Disputed %</Label><Input type="number" step="0.00000001" value={dPct} onChange={(e) => setDPct(e.target.value)} /></div>
            <div><Label>Dispute Reason</Label><Textarea value={dReason} onChange={(e) => setDReason(e.target.value)} rows={2} /></div>
            <div><Label>Reference (optional)</Label><Input value={dRef} onChange={(e) => setDRef(e.target.value)} placeholder="Case ID, GD number…" /></div>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" variant="destructive" onClick={handleDispute} disabled={disputeMut.isPending}>
              {disputeMut.isPending ? "Marking…" : "Mark as Disputed"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resolve dispute dialog */}
      <Dialog open={dialog === "resolve"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Resolve Ownership Dispute</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            For: <strong>{selectedState?.partnerName}</strong> &mdash; {pct(selectedState?.disputedPercentage)}% currently disputed
          </p>
          <div className="space-y-3">
            <div><Label>Released % (returned to transferable)</Label><Input type="number" step="0.00000001" value={rPct} onChange={(e) => setRPct(e.target.value)} /></div>
            <div><Label>Resolution Notes</Label><Textarea value={rResolution} onChange={(e) => setRResolution(e.target.value)} rows={2} /></div>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" onClick={handleResolve} disabled={resolveMut.isPending}>
              {resolveMut.isPending ? "Resolving…" : "Resolve Dispute"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lock dialog */}
      <Dialog open={dialog === "lock"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Lock Ownership Percentage</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            For: <strong>{selectedState?.partnerName}</strong> &mdash; {pct(selectedState?.transferablePercentage)}% transferable
          </p>
          <div className="space-y-3">
            <div><Label>Lock %</Label><Input type="number" step="0.00000001" value={lPct} onChange={(e) => setLPct(e.target.value)} /></div>
            <div><Label>Lock Reason</Label><Textarea value={lReason} onChange={(e) => setLReason(e.target.value)} rows={2} /></div>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" onClick={handleLock} disabled={lockMut.isPending}>
              {lockMut.isPending ? "Locking…" : "Lock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unlock dialog */}
      <Dialog open={dialog === "unlock"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Unlock Ownership Percentage</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            For: <strong>{selectedState?.partnerName}</strong> &mdash; {pct(selectedState?.lockedPercentage)}% locked
          </p>
          <div className="space-y-3">
            <div><Label>Unlock %</Label><Input type="number" step="0.00000001" value={ulPct} onChange={(e) => setUlPct(e.target.value)} /></div>
            <div><Label>Reason</Label><Textarea value={ulReason} onChange={(e) => setUlReason(e.target.value)} rows={2} /></div>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" onClick={handleUnlock} disabled={unlockMut.isPending}>
              {unlockMut.isPending ? "Unlocking…" : "Unlock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
