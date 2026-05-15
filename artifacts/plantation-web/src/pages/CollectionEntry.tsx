import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCollectionEntry,
  useGetMyProductionAssignment,
  useListCollectionEntries,
  getListCollectionEntriesQueryKey,
  getGetCollectionSummaryQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle2, Loader2, Leaf, Clock } from "lucide-react";

export default function CollectionEntry() {
  const qc = useQueryClient();
  const [sheetCount, setSheetCount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [success, setSuccess] = useState<number | null>(null);
  const [error, setError] = useState("");

  const assignmentQuery = useGetMyProductionAssignment({
    query: { queryKey: ["myProductionAssignment"] },
  });
  const assignments: any[] = (assignmentQuery.data as any) ?? [];
  const primaryAssignment = assignments[0] ?? null;
  const projectId = primaryAssignment?.projectId ?? null;

  const today = format(new Date(), "yyyy-MM-dd");

  const todayEntriesQuery = useListCollectionEntries(
    { projectId: projectId ?? undefined, dateFrom: today, dateTo: today },
    {
      query: {
        queryKey: ["collectionEntriesToday", projectId, today],
        enabled: !!projectId,
      },
    },
  );
  const todayEntries: any[] = (todayEntriesQuery.data as any) ?? [];
  const myTodayEntries = todayEntries.filter((e: any) => !e.deletedAt);
  const todayTotal = myTodayEntries.reduce(
    (sum: number, e: any) => sum + (e.sheetCount ?? 0),
    0,
  );

  const createMut = useCreateCollectionEntry();

  function handleNumPad(val: string) {
    if (val === "DEL") {
      setSheetCount((prev) => prev.slice(0, -1));
    } else if (val === "CLR") {
      setSheetCount("");
    } else {
      if (sheetCount.length >= 5) return;
      setSheetCount((prev) => prev + val);
    }
  }

  async function handleSave() {
    const count = parseInt(sheetCount, 10);
    if (!count || count <= 0) {
      setError("Please enter a valid sheet count.");
      return;
    }
    setError("");
    try {
      await createMut.mutateAsync({ data: { sheetCount: count, remarks: remarks || undefined } });
      setSuccess(count);
      setSheetCount("");
      setRemarks("");
      qc.invalidateQueries({ queryKey: getListCollectionEntriesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCollectionSummaryQueryKey(projectId!) });
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to save entry.");
    }
  }

  if (assignmentQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading assignment…
      </div>
    );
  }

  if (!primaryAssignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <Leaf className="w-14 h-14 text-slate-600" />
        <h2 className="text-slate-300 text-xl font-semibold">Not Assigned</h2>
        <p className="text-slate-500 text-sm max-w-xs">
          You are not assigned to any production project. Contact your supervisor.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 flex flex-col gap-6 min-h-screen">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-900/30 border border-emerald-700/40 rounded-full px-4 py-1.5 mb-4">
          <Leaf className="w-4 h-4 text-emerald-400" />
          <span className="text-emerald-300 text-sm font-medium">{primaryAssignment.projectName ?? "Project"}</span>
        </div>
        <h1 className="text-slate-100 text-3xl font-bold tracking-tight">Collection Entry</h1>
        <p className="text-slate-400 text-sm mt-1 flex items-center justify-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {format(new Date(), "EEEE, d MMM yyyy")}
        </p>
      </div>

      {/* Today's total banner */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 text-center">
        <p className="text-slate-400 text-sm mb-1">Today's Total</p>
        <p className="text-4xl font-bold text-emerald-400">{todayTotal.toLocaleString()}</p>
        <p className="text-slate-500 text-xs mt-1">sheets collected today</p>
      </div>

      {/* Success message */}
      {success !== null && (
        <div className="bg-emerald-900/40 border border-emerald-600/50 rounded-2xl p-5 flex items-center gap-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" />
          <div>
            <p className="text-emerald-300 text-xl font-bold">Collected: {success} sheets</p>
            <p className="text-emerald-500 text-sm">Saved successfully</p>
          </div>
        </div>
      )}

      {/* Big numeric display */}
      <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-6 text-center">
        <p className="text-slate-500 text-sm mb-2">Number of Sheets</p>
        <div className="text-6xl font-bold text-slate-100 tracking-widest min-h-[80px] flex items-center justify-center">
          {sheetCount || <span className="text-slate-700">0</span>}
        </div>
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "DEL"].map((key) => (
          <button
            key={key}
            onClick={() => handleNumPad(key)}
            className={`rounded-2xl p-5 text-2xl font-bold transition-all active:scale-95 select-none
              ${key === "DEL" ? "bg-red-900/40 text-red-300 border border-red-800/60 hover:bg-red-900/60" :
                key === "CLR" ? "bg-slate-700/50 text-slate-400 border border-slate-600/60 hover:bg-slate-700/80" :
                "bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700"}`}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Optional remark */}
      <div>
        <label className="text-slate-400 text-sm mb-2 block">Remarks (optional)</label>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          placeholder="Any notes about this collection…"
          className="w-full rounded-xl bg-slate-900/60 border border-slate-700 text-slate-200 placeholder:text-slate-600 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={createMut.isPending || !sheetCount}
        className="w-full py-5 rounded-2xl text-xl font-bold transition-all active:scale-[0.98]
          disabled:opacity-40 disabled:cursor-not-allowed
          bg-emerald-700 hover:bg-emerald-600 text-white flex items-center justify-center gap-3"
      >
        {createMut.isPending ? (
          <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</>
        ) : (
          <><CheckCircle2 className="w-6 h-6" /> Save</>
        )}
      </button>
    </div>
  );
}
