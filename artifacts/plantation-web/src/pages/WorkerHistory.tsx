import { useMemo } from "react";
import { format, subDays, parseISO } from "date-fns";
import {
  useListCollectionEntries,
  useListStoreEntries,
  useGetMyProductionAssignment,
  useGetCollectionSummary,
  getGetCollectionSummaryQueryKey,
} from "@workspace/api-client-react";
import { Loader2, Leaf, Package, Calendar, TrendingUp } from "lucide-react";

export default function WorkerHistory() {
  const assignmentQuery = useGetMyProductionAssignment({
    query: { queryKey: ["myProductionAssignment"] },
  });
  const assignments: any[] = (assignmentQuery.data as any) ?? [];
  const primaryAssignment = assignments[0] ?? null;
  const projectId = primaryAssignment?.projectId ?? null;

  const today = format(new Date(), "yyyy-MM-dd");
  const sevenDaysAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");

  const collQuery = useListCollectionEntries(
    { projectId: projectId ?? undefined, dateFrom: sevenDaysAgo, dateTo: today },
    {
      query: {
        queryKey: ["workerCollectionHistory", projectId, sevenDaysAgo, today],
        enabled: !!projectId,
      },
    },
  );
  const storeQuery = useListStoreEntries(
    { projectId: projectId ?? undefined, dateFrom: sevenDaysAgo, dateTo: today },
    {
      query: {
        queryKey: ["workerStoreHistory", projectId, sevenDaysAgo, today],
        enabled: !!projectId,
      },
    },
  );
  const summaryQuery = useGetCollectionSummary(projectId ?? "", {
    query: {
      queryKey: getGetCollectionSummaryQueryKey(projectId ?? ""),
      enabled: !!projectId,
    },
  });

  const collEntries: any[] = useMemo(
    () => ((collQuery.data as any) ?? []).filter((e: any) => !e.deletedAt),
    [collQuery.data],
  );
  const storeEntries: any[] = useMemo(
    () => ((storeQuery.data as any) ?? []).filter((e: any) => !e.deletedAt),
    [storeQuery.data],
  );
  const summary: any = summaryQuery.data ?? {};

  // Group by date
  const dates = Array.from({ length: 7 }, (_, i) =>
    format(subDays(new Date(), 6 - i), "yyyy-MM-dd"),
  );

  const byDate = useMemo(() => {
    const map: Record<string, { coll: any[]; store: any[] }> = {};
    for (const d of dates) map[d] = { coll: [], store: [] };
    for (const e of collEntries) {
      if (map[e.entryDate]) map[e.entryDate].coll.push(e);
    }
    for (const e of storeEntries) {
      if (map[e.entryDate]) map[e.entryDate].store.push(e);
    }
    return map;
  }, [collEntries, storeEntries]);

  const todayCollTotal = byDate[today]?.coll.reduce((s: number, e: any) => s + e.sheetCount, 0) ?? 0;
  const weekCollTotal = collEntries.reduce((s: number, e: any) => s + e.sheetCount, 0);

  if (assignmentQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading…
      </div>
    );
  }

  if (!primaryAssignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
        <Calendar className="w-14 h-14 text-slate-600" />
        <h2 className="text-slate-300 text-xl font-semibold">No Assignment Found</h2>
        <p className="text-slate-500 text-sm">Contact your supervisor to be assigned to a project.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-slate-100 text-2xl font-bold">My Production History</h1>
        <p className="text-slate-400 text-sm mt-1">{primaryAssignment.projectName} · Last 7 Days</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
          <Leaf className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-emerald-300">{todayCollTotal}</p>
          <p className="text-slate-500 text-xs">Today</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
          <TrendingUp className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-blue-300">{weekCollTotal}</p>
          <p className="text-slate-500 text-xs">This Week</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
          <Package className="w-5 h-5 text-amber-400 mx-auto mb-1" />
          <p className="text-2xl font-bold text-amber-300">{summary.pendingOutsideStore ?? "—"}</p>
          <p className="text-slate-500 text-xs">Pending</p>
        </div>
      </div>

      {/* Daily entries */}
      <div className="space-y-4">
        <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Last 7 Days — My Entries</p>
        {[...dates].reverse().map((date) => {
          const { coll, store } = byDate[date];
          const collTotal = coll.reduce((s: number, e: any) => s + e.sheetCount, 0);
          const storeTotal = store.reduce((s: number, e: any) => s + e.sheetCount, 0);
          const isToday = date === today;
          const hasAny = coll.length > 0 || store.length > 0;

          return (
            <div
              key={date}
              className={`rounded-xl border overflow-hidden ${isToday ? "border-emerald-700/50 bg-emerald-950/20" : "border-slate-800 bg-slate-900/40"}`}
            >
              {/* Date header */}
              <div className={`flex items-center justify-between px-4 py-3 ${isToday ? "bg-emerald-900/20" : "bg-slate-800/40"}`}>
                <div>
                  <span className={`text-sm font-semibold ${isToday ? "text-emerald-300" : "text-slate-300"}`}>
                    {format(parseISO(date), "EEEE, d MMM")}
                  </span>
                  {isToday && <span className="ml-2 text-xs bg-emerald-700/50 text-emerald-300 rounded-full px-2 py-0.5">Today</span>}
                </div>
                {hasAny && (
                  <div className="flex gap-3 text-xs">
                    {collTotal > 0 && <span className="text-emerald-400 font-medium">+{collTotal} coll.</span>}
                    {storeTotal > 0 && <span className="text-blue-400 font-medium">+{storeTotal} stored</span>}
                  </div>
                )}
              </div>

              {/* Entries */}
              {hasAny ? (
                <div className="divide-y divide-slate-800/50">
                  {coll.map((e: any) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Leaf className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-slate-300 text-sm">Collection</span>
                        <span className="text-slate-600 text-xs">{e.entryTime}</span>
                      </div>
                      <span className="text-emerald-300 font-bold text-sm">{e.sheetCount} sheets</span>
                    </div>
                  ))}
                  {store.map((e: any) => (
                    <div key={e.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="text-slate-300 text-sm">Store Entry</span>
                        <span className="text-slate-600 text-xs">{e.entryTime}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-blue-300 font-bold text-sm">{e.sheetCount} sheets</span>
                        {e.weightKg && <p className="text-slate-500 text-xs">{e.weightKg} kg</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-3">
                  <p className="text-slate-600 text-sm">No entries</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
