import { useState } from "react";
import { useGetProjectAuditTrail } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History, ChevronDown, ChevronUp } from "lucide-react";

const sourceLabels: Record<string, { label: string; color: string }> = {
  project_audit_trail: { label: "Structural", color: "bg-violet-100 text-violet-800 border-violet-200" },
  project_lifecycle_history: { label: "Lifecycle", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  governance_overrides: { label: "Governance Override", color: "bg-amber-100 text-amber-800 border-amber-200" },
};

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function ProjectAuditTrailCard({ projectId }: { projectId: string }) {
  const [limit, setLimit] = useState(20);
  const { data, isLoading } = useGetProjectAuditTrail(projectId, { limit, offset: 0 });
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const events = (data as any)?.events ?? [];
  const total = (data as any)?.total ?? 0;

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="font-serif flex items-center gap-2">
          <History className="w-4 h-4" /> Audit Trail
          <span className="text-xs font-normal text-muted-foreground">({total} events)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No audit events yet.</p>
        ) : (
          <ol className="relative border-l border-muted-foreground/20 ml-3 space-y-4">
            {events.map((e: any) => {
              const tag = sourceLabels[e.source] ?? { label: e.source, color: "bg-slate-100 text-slate-700 border-slate-200" };
              const isOpen = openIds.has(e.id);
              const hasDetails = e.beforeData || e.afterData || e.metadata || e.reason;
              return (
                <li key={e.id} className="ml-4">
                  <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-background bg-muted-foreground/40" />
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${tag.color}`}>{tag.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{e.eventType}</span>
                      </div>
                      <div className="text-sm font-medium mt-1">{e.title}</div>
                      {e.description && <div className="text-xs text-muted-foreground mt-0.5">{e.description}</div>}
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {fmtDate(e.occurredAt)}
                        {e.actorName && <> · {e.actorName}{e.actorRole ? ` (${e.actorRole})` : ""}</>}
                        {e.governanceOverrideId && (
                          <> · <Badge variant="outline" className="text-[9px] py-0 px-1.5">override</Badge></>
                        )}
                      </div>
                    </div>
                    {hasDetails && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => toggle(e.id)}>
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                  {isOpen && hasDetails && (
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                      {e.beforeData && (
                        <div className="border rounded p-2 bg-rose-50/50">
                          <div className="font-semibold text-rose-700 mb-1">Before</div>
                          <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">{JSON.stringify(e.beforeData, null, 2)}</pre>
                        </div>
                      )}
                      {e.afterData && (
                        <div className="border rounded p-2 bg-emerald-50/50">
                          <div className="font-semibold text-emerald-700 mb-1">After</div>
                          <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">{JSON.stringify(e.afterData, null, 2)}</pre>
                        </div>
                      )}
                      {e.reason && (
                        <div className="border rounded p-2 bg-muted/30 md:col-span-2">
                          <div className="font-semibold text-muted-foreground mb-1">Reason</div>
                          <div>{e.reason}</div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {events.length < total && (
          <div className="mt-4 text-center">
            <Button type="button" variant="outline" size="sm" onClick={() => setLimit((l) => l + 20)}>
              Load more
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
