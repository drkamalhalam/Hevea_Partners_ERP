/**
 * HeldDistributions.tsx
 *
 * Held Distribution Ledger — view, create, and release held amounts.
 *
 * Held distributions arise when a partner's ownership is under dispute
 * or governance lock and the relevant share of a profit/proceeds distribution
 * must be withheld until the situation is resolved.
 */

import { useState } from "react";
import { useRole } from "@/contexts/RoleContext";
import {
  useListHeldDistributions,
  useGetHeldDistributionSummary,
  useCreateHeldDistribution,
  useReleaseHeldDistribution,
  useListProjects,
  useListPartners,
} from "@workspace/api-client-react";
import type { HeldDistributionEntry } from "@workspace/api-client-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlusCircle, RefreshCw, Wallet, ArrowUpRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const INR = (v: string | number | null | undefined) => {
  if (!v) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(v));
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    held: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    released: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    forfeited: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}

const HOLD_TYPES = ["profit_distribution", "sale_proceeds", "lca_credit", "revenue_entitlement", "other"] as const;
const HOLD_REASONS = ["ownership_dispute", "payment_dispute", "governance_lock", "inheritance_pending", "admin_hold"] as const;
const RELEASE_TO = ["original_partner", "dispute_settlement", "alternative_party", "forfeited"] as const;

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function HeldDistributions() {
  const { role } = useRole();
  const isAdminDev = role === "admin" || role === "developer";
  const isAdmin = role === "admin";
  const qc = useQueryClient();
  const { toast } = useToast();

  const [filterProject, setFilterProject] = useState("");
  const [filterPartner, setFilterPartner] = useState("");
  const [filterStatus, setFilterStatus] = useState("held");
  const [showCreate, setShowCreate] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<HeldDistributionEntry | null>(null);
  const [err, setErr] = useState("");

  // Create form
  const [cProjectId, setCProjectId] = useState("");
  const [cPartnerId, setCPartnerId] = useState("");
  const [cHoldType, setCHoldType] = useState<string>("");
  const [cSourceDesc, setCSourceDesc] = useState("");
  const [cSourceType, setCSourceType] = useState("");
  const [cPeriodYear, setCPeriodYear] = useState("");
  const [cAmount, setCAmount] = useState("");
  const [cOwnPct, setCOwnPct] = useState("");
  const [cHoldReason, setCHoldReason] = useState<string>("");
  const [cHoldNotes, setCHoldNotes] = useState("");

  // Release form
  const [rAmount, setRAmount] = useState("");
  const [rTo, setRTo] = useState<string>("");
  const [rNotes, setRNotes] = useState("");
  const [rForfeited, setRForfeited] = useState(false);

  const { data: projectsData } = useListProjects();
  const projects: any[] = Array.isArray(projectsData) ? projectsData : (projectsData as any)?.projects ?? [];
  const { data: partnersData } = useListPartners();
  const partners: any[] = (partnersData as any)?.partners ?? [];

  const listQuery = useListHeldDistributions(
    {
      projectId: filterProject || undefined,
      partnerId: filterPartner || undefined,
      status: (filterStatus || undefined) as any,
    },
    { query: { queryKey: ["listHeldDistributions", filterProject, filterPartner, filterStatus] } },
  );
  const entries: HeldDistributionEntry[] = (listQuery.data as any) ?? [];

  const summaryQuery = useGetHeldDistributionSummary(
    { projectId: filterProject || undefined },
    { query: { queryKey: ["getHeldDistributionSummary", filterProject] } },
  );
  const summary: any[] = (summaryQuery.data as any) ?? [];

  const createMut = useCreateHeldDistribution();
  const releaseMut = useReleaseHeldDistribution();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["listHeldDistributions"] });
    qc.invalidateQueries({ queryKey: ["getHeldDistributionSummary"] });
  }

  function handleCreate() {
    if (!cProjectId || !cPartnerId || !cHoldType || !cSourceDesc || !cAmount || !cHoldReason) {
      setErr("All required fields must be filled"); return;
    }
    createMut.mutate(
      {
        data: {
          projectId: cProjectId,
          partnerId: cPartnerId,
          holdType: cHoldType as any,
          sourceDescription: cSourceDesc,
          sourceType: cSourceType || null,
          periodYear: cPeriodYear ? parseInt(cPeriodYear) : null,
          heldAmount: parseFloat(cAmount),
          ownershipPctAtTime: cOwnPct ? parseFloat(cOwnPct) : null,
          holdReason: cHoldReason as any,
          holdNotes: cHoldNotes || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Held distribution entry created" });
          invalidate(); setShowCreate(false);
        },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed to create"),
      },
    );
  }

  function handleRelease() {
    if (!selectedEntry || !rAmount || !rTo || !rNotes) { setErr("All release fields are required"); return; }
    releaseMut.mutate(
      {
        id: selectedEntry.id,
        data: {
          releasedAmount: parseFloat(rAmount),
          releasedTo: rTo as any,
          releaseNotes: rNotes,
          forfeited: rForfeited,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Distribution released" });
          invalidate(); setShowRelease(false);
        },
        onError: (e: any) => setErr(e?.response?.data?.error ?? "Failed to release"),
      },
    );
  }

  const totalHeld = entries.filter(e => e.status === "held").reduce((s, e) => s + parseFloat(e.heldAmount), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wallet className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Held Distribution Ledger</h1>
            <p className="text-muted-foreground text-sm">
              Track distributions held pending dispute resolution or governance decisions.
            </p>
          </div>
        </div>
        {isAdminDev && (
          <Button onClick={() => { setErr(""); setShowCreate(true); }} size="sm">
            <PlusCircle className="h-4 w-4 mr-1" /> Record Hold
          </Button>
        )}
      </div>

      {/* Summary cards */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {summary.map((s) => (
            <Card key={`${s.projectId}-${s.partnerId}`} className="py-3">
              <CardContent className="px-4 flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{s.partnerName}</p>
                  <p className="text-xs text-muted-foreground">{s.entryCount} held {s.entryCount === 1 ? "entry" : "entries"}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-amber-600">{INR(s.totalHeld)}</p>
                  <p className="text-xs text-muted-foreground">held</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Total pill */}
      {entries.some(e => e.status === "held") && (
        <div className="inline-flex items-center gap-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-full px-4 py-1.5 text-sm">
          <span className="text-muted-foreground">Total currently held:</span>
          <span className="font-bold text-amber-700 dark:text-amber-300">{INR(totalHeld)}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label className="text-xs">Project</Label>
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All projects</SelectItem>
              {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Label className="text-xs">Partner</Label>
          <Select value={filterPartner} onValueChange={setFilterPartner}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All partners" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All partners</SelectItem>
              {partners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs">Status</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="held">Held</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="forfeited">Forfeited</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" className="h-8" onClick={() => listQuery.refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* Table */}
      {listQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No held distribution entries found.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead>Partner</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Held Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id} className="text-sm">
                  <TableCell className="font-medium">{e.partnerName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{humanize(e.holdType)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">{e.sourceDescription}</TableCell>
                  <TableCell className="text-muted-foreground">{e.periodYear ?? "—"}</TableCell>
                  <TableCell className="font-mono font-semibold">{INR(e.heldAmount)}</TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{humanize(e.holdReason)}</span>
                  </TableCell>
                  <TableCell><StatusBadge status={e.status} /></TableCell>
                  {isAdmin && (
                    <TableCell>
                      {e.status === "held" && (
                        <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-300"
                          onClick={() => {
                            setSelectedEntry(e);
                            setRAmount(e.heldAmount); setRTo(""); setRNotes(""); setRForfeited(false); setErr("");
                            setShowRelease(true);
                          }}>
                          <ArrowUpRight className="h-3.5 w-3.5 mr-1" /> Release
                        </Button>
                      )}
                      {e.status !== "held" && e.releasedAt && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(e.releasedAt).toLocaleDateString("en-IN")}
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => !o && setShowCreate(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record Held Distribution</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Project</Label>
                <Select value={cProjectId} onValueChange={setCProjectId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Partner</Label>
                <Select value={cPartnerId} onValueChange={setCPartnerId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {partners.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Hold Type</Label>
                <Select value={cHoldType} onValueChange={setCHoldType}>
                  <SelectTrigger><SelectValue placeholder="Type…" /></SelectTrigger>
                  <SelectContent>
                    {HOLD_TYPES.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hold Reason</Label>
                <Select value={cHoldReason} onValueChange={setCHoldReason}>
                  <SelectTrigger><SelectValue placeholder="Reason…" /></SelectTrigger>
                  <SelectContent>
                    {HOLD_REASONS.map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Source Description</Label>
              <Input value={cSourceDesc} onChange={(e) => setCSourceDesc(e.target.value)}
                placeholder="e.g. FY 2024-25 profit distribution — 50% session #3" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Held Amount (₹)</Label>
                <Input type="number" step="0.01" value={cAmount} onChange={(e) => setCAmount(e.target.value)} />
              </div>
              <div>
                <Label>Period Year</Label>
                <Input type="number" value={cPeriodYear} onChange={(e) => setCPeriodYear(e.target.value)} placeholder="e.g. 2024" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Source Type (optional)</Label>
                <Input value={cSourceType} onChange={(e) => setCSourceType(e.target.value)} placeholder="fifty_pct_session…" />
              </div>
              <div>
                <Label>Ownership % at Time</Label>
                <Input type="number" step="0.00000001" value={cOwnPct} onChange={(e) => setCOwnPct(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Hold Notes (optional)</Label>
              <Textarea value={cHoldNotes} onChange={(e) => setCHoldNotes(e.target.value)} rows={2} />
            </div>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" onClick={handleCreate} disabled={createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Record Hold"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Release dialog */}
      <Dialog open={showRelease} onOpenChange={(o) => !o && setShowRelease(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Release Held Distribution</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Releasing held amount for <strong>{selectedEntry?.partnerName}</strong>.<br />
            Currently held: <strong>{INR(selectedEntry?.heldAmount)}</strong>
          </p>
          <div className="space-y-3">
            <div>
              <Label>Released Amount (₹)</Label>
              <Input type="number" step="0.01" value={rAmount} onChange={(e) => setRAmount(e.target.value)} />
            </div>
            <div>
              <Label>Release To</Label>
              <Select value={rTo} onValueChange={setRTo}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {RELEASE_TO.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Release Notes</Label>
              <Textarea value={rNotes} onChange={(e) => setRNotes(e.target.value)} rows={2} />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={rForfeited} onChange={(e) => setRForfeited(e.target.checked)} />
              Mark as forfeited (instead of released)
            </label>
            {err && <p className="text-destructive text-sm">{err}</p>}
            <Button className="w-full" onClick={handleRelease} disabled={releaseMut.isPending}>
              {releaseMut.isPending ? "Releasing…" : rForfeited ? "Forfeit" : "Release"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
