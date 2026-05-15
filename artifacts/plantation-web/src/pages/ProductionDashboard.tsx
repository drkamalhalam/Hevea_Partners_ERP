import { useState, useMemo } from "react";
import { format, subDays } from "date-fns";
import {
  useListCollectionEntries,
  useListStoreEntries,
  useGetCollectionSummary,
  useListProductionAssignments,
  useListProjects,
  getGetCollectionSummaryQueryKey,
} from "@workspace/api-client-react";
import { Loader2, Leaf, Package, BarChart3, Users, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

function fmtKg(v: number) {
  return v.toLocaleString("en-IN", { maximumFractionDigits: 1 }) + " kg";
}

export default function ProductionDashboard() {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);

  const projectsQuery = useListProjects({
    query: { queryKey: ["projects"] },
  });
  const projects: any[] = useMemo(
    () => (projectsQuery.data as any) ?? [],
    [projectsQuery.data],
  );

  const today = format(new Date(), "yyyy-MM-dd");
  const sevenDaysAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");

  const projectId = selectedProjectId || projects[0]?.id || null;

  const summaryQuery = useGetCollectionSummary(projectId ?? "", {
    query: {
      queryKey: getGetCollectionSummaryQueryKey(projectId ?? ""),
      enabled: !!projectId,
    },
  });

  const collQuery = useListCollectionEntries(
    { projectId: projectId ?? undefined, dateFrom: sevenDaysAgo, dateTo: today },
    {
      query: {
        queryKey: ["dashCollEntries", projectId, sevenDaysAgo, today],
        enabled: !!projectId,
      },
    },
  );

  const storeQuery = useListStoreEntries(
    { projectId: projectId ?? undefined, dateFrom: sevenDaysAgo, dateTo: today },
    {
      query: {
        queryKey: ["dashStoreEntries", projectId, sevenDaysAgo, today],
        enabled: !!projectId,
      },
    },
  );

  const assignmentsQuery = useListProductionAssignments(
    { projectId: projectId ?? undefined },
    {
      query: {
        queryKey: ["productionAssignments", projectId],
        enabled: !!projectId,
      },
    },
  );

  const summary: any = summaryQuery.data ?? {};
  const collEntries: any[] = useMemo(
    () => ((collQuery.data as any) ?? []).filter((e: any) => !e.deletedAt),
    [collQuery.data],
  );
  const storeEntries: any[] = useMemo(
    () => ((storeQuery.data as any) ?? []).filter((e: any) => !e.deletedAt),
    [storeQuery.data],
  );
  const assignments: any[] = (assignmentsQuery.data as any) ?? [];

  // Per-collector breakdown
  const collectorMap = useMemo(() => {
    const map: Record<string, { name: string; entries: any[]; totalSheets: number }> = {};
    for (const e of collEntries) {
      if (!map[e.employeeId]) {
        map[e.employeeId] = { name: e.employeeName ?? e.employeeId.slice(0, 8), entries: [], totalSheets: 0 };
      }
      map[e.employeeId].entries.push(e);
      map[e.employeeId].totalSheets += e.sheetCount;
    }
    return map;
  }, [collEntries]);

  const collectorRows = Object.entries(collectorMap).sort((a, b) => b[1].totalSheets - a[1].totalSheets);

  const isLoading = summaryQuery.isLoading || collQuery.isLoading || storeQuery.isLoading;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-slate-100 text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-400" />
            Production Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">Last 7 days — all collectors</p>
        </div>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="h-10 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {projects.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 text-slate-400 py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading production data…
        </div>
      ) : !projectId ? (
        <div className="text-center py-12 text-slate-500">No projects found.</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Today Collected", value: summary.todayCollected ?? 0, suffix: "sheets", color: "text-emerald-300", icon: <Leaf className="w-5 h-5 text-emerald-500" /> },
              { label: "Today Stored", value: summary.todayStored ?? 0, suffix: "sheets", color: "text-blue-300", icon: <Package className="w-5 h-5 text-blue-500" /> },
              { label: "Pending Outside", value: summary.pendingOutsideStore ?? 0, suffix: "sheets", color: "text-amber-300", icon: <RefreshCw className="w-5 h-5 text-amber-500" /> },
              { label: "Total Stored Weight", value: summary.totalStoredWeightKg ?? 0, suffix: "kg", color: "text-purple-300", icon: <Package className="w-5 h-5 text-purple-500" /> },
            ].map((stat) => (
              <div key={stat.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">{stat.icon}<span className="text-slate-500 text-xs">{stat.label}</span></div>
                <p className={`text-2xl font-bold ${stat.color}`}>
                  {typeof stat.value === "number"
                    ? stat.suffix === "kg"
                      ? fmtKg(stat.value)
                      : stat.value.toLocaleString("en-IN")
                    : stat.value}
                </p>
                {stat.suffix !== "kg" && <p className="text-slate-600 text-xs">{stat.suffix}</p>}
              </div>
            ))}
          </div>

          {/* Cumulative totals */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wide mb-4">Cumulative (All Time)</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Collected", value: summary.totalCollected ?? 0, color: "text-emerald-400" },
                { label: "Total Stored", value: summary.totalStored ?? 0, color: "text-blue-400" },
                { label: "Stored Weight", value: `${fmtKg(summary.totalStoredWeightKg ?? 0)}`, color: "text-purple-400" },
                { label: "Scrap Weight", value: `${fmtKg(summary.totalScrapWeightKg ?? 0)}`, color: "text-orange-400" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-slate-500 text-xs">{stat.label}</p>
                  <p className={`text-xl font-bold mt-1 ${stat.color}`}>
                    {typeof stat.value === "number" ? stat.value.toLocaleString("en-IN") : stat.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Collector breakdown */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
              <Users className="w-4 h-4 text-slate-400" />
              <h2 className="text-slate-300 font-semibold text-sm">Collector Summary — Last 7 Days</h2>
            </div>
            {collectorRows.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-500 text-sm">No collection entries in the last 7 days.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-5 py-3 text-slate-500 font-medium">Collector</th>
                    <th className="text-right px-5 py-3 text-slate-500 font-medium">Entries</th>
                    <th className="text-right px-5 py-3 text-slate-500 font-medium">Total Sheets</th>
                    <th className="w-10 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {collectorRows.map(([empId, data]) => (
                    <>
                      <tr
                        key={empId}
                        className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer"
                        onClick={() => setExpandedWorker(expandedWorker === empId ? null : empId)}
                      >
                        <td className="px-5 py-3 text-slate-200 font-medium">{data.name}</td>
                        <td className="px-5 py-3 text-slate-400 text-right">{data.entries.length}</td>
                        <td className="px-5 py-3 text-emerald-300 font-bold text-right">{data.totalSheets.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-3 text-slate-600">
                          {expandedWorker === empId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </td>
                      </tr>
                      {expandedWorker === empId && (
                        <tr key={`${empId}-detail`}>
                          <td colSpan={4} className="px-5 py-3 bg-slate-900/60">
                            <div className="space-y-1">
                              {data.entries.map((e: any) => (
                                <div key={e.id} className="flex justify-between text-xs">
                                  <span className="text-slate-500">{e.entryDate} {e.entryTime}</span>
                                  <span className="text-emerald-400">{e.sheetCount} sheets</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Active assignments */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
              <Users className="w-4 h-4 text-slate-400" />
              <h2 className="text-slate-300 font-semibold text-sm">Assigned Employees</h2>
            </div>
            {assignments.length === 0 ? (
              <div className="px-5 py-6 text-center text-slate-500 text-sm">No employees assigned to this project.</div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {assignments.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-slate-200 text-sm font-medium">{a.employeeName ?? "—"}</p>
                      <p className="text-slate-500 text-xs capitalize">{a.role}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${a.isActive ? "bg-emerald-900/40 text-emerald-300" : "bg-slate-700/40 text-slate-500"}`}>
                      {a.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
