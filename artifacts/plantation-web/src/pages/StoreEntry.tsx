import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateStoreEntry,
  useGetMyProductionAssignment,
  useGetCollectionSummary,
  getGetCollectionSummaryQueryKey,
  getListStoreEntriesQueryKey,
} from "@workspace/api-client-react";
import { CheckCircle2, Loader2, Package, Clock, AlertTriangle } from "lucide-react";

export default function StoreEntry() {
  const qc = useQueryClient();
  const [sheetCount, setSheetCount] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [scrapWeightKg, setScrapWeightKg] = useState("");
  const [remarks, setRemarks] = useState("");
  const [success, setSuccess] = useState<{ sheets: number; pending: number } | null>(null);
  const [error, setError] = useState("");

  const assignmentQuery = useGetMyProductionAssignment({
    query: { queryKey: ["myProductionAssignment"] },
  });
  const assignments: any[] = (assignmentQuery.data as any) ?? [];
  const primaryAssignment = assignments[0] ?? null;
  const projectId = primaryAssignment?.projectId ?? null;

  const summaryQuery = useGetCollectionSummary(projectId ?? "", {
    query: {
      queryKey: getGetCollectionSummaryQueryKey(projectId ?? ""),
      enabled: !!projectId,
    },
  });
  const summary: any = summaryQuery.data ?? {};
  const pending = summary.pendingOutsideStore ?? 0;

  const createMut = useCreateStoreEntry();

  const sheets = parseInt(sheetCount, 10) || 0;
  const wouldExceed = sheets > pending;

  function handleNumPad(field: "sheets" | "weight" | "scrap", val: string) {
    const setter = field === "sheets" ? setSheetCount : field === "weight" ? setWeightKg : setScrapWeightKg;
    const current = field === "sheets" ? sheetCount : field === "weight" ? weightKg : scrapWeightKg;
    if (val === "DEL") setter(current.slice(0, -1));
    else if (val === "CLR") setter("");
    else if (val === "." && current.includes(".")) return;
    else if (current.length < 8) setter(current + val);
  }

  const [activeField, setActiveField] = useState<"sheets" | "weight" | "scrap">("sheets");
  const displayValue = activeField === "sheets" ? sheetCount : activeField === "weight" ? weightKg : scrapWeightKg;

  async function handleSave() {
    const count = parseInt(sheetCount, 10);
    if (!count || count <= 0) {
      setError("Please enter a valid sheet count.");
      return;
    }
    if (wouldExceed) {
      setError(`Cannot store more than ${pending} pending sheets.`);
      return;
    }
    setError("");
    try {
      const result = await createMut.mutateAsync({
        data: {
          sheetCount: count,
          weightKg: weightKg ? parseFloat(weightKg) : undefined,
          scrapWeightKg: scrapWeightKg ? parseFloat(scrapWeightKg) : undefined,
          remarks: remarks || undefined,
        },
      });
      const newPending = (result as any).pendingOutsideStore ?? pending - count;
      setSuccess({ sheets: count, pending: newPending });
      setSheetCount(""); setWeightKg(""); setScrapWeightKg(""); setRemarks("");
      qc.invalidateQueries({ queryKey: getGetCollectionSummaryQueryKey(projectId!) });
      qc.invalidateQueries({ queryKey: getListStoreEntriesQueryKey() });
      setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Failed to save entry.");
    }
  }

  if (assignmentQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading…
      </div>
    );
  }

  if (!primaryAssignment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <Package className="w-14 h-14 text-slate-600" />
        <h2 className="text-slate-300 text-xl font-semibold">Not Assigned</h2>
        <p className="text-slate-500 text-sm">You are not assigned to any production project.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 flex flex-col gap-5 min-h-screen">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 bg-blue-900/30 border border-blue-700/40 rounded-full px-4 py-1.5 mb-4">
          <Package className="w-4 h-4 text-blue-400" />
          <span className="text-blue-300 text-sm font-medium">{primaryAssignment.projectName ?? "Project"}</span>
        </div>
        <h1 className="text-slate-100 text-3xl font-bold tracking-tight">Store Entry</h1>
        <p className="text-slate-400 text-sm mt-1 flex items-center justify-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {format(new Date(), "EEEE, d MMM yyyy")}
        </p>
      </div>

      {/* Pending outside store */}
      <div className={`rounded-2xl p-5 text-center border-2 ${wouldExceed && sheets > 0 ? "bg-red-900/20 border-red-700/60" : "bg-blue-950/30 border-blue-800/40"}`}>
        {summaryQuery.isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" />
        ) : (
          <>
            <p className={`text-sm mb-1 ${wouldExceed && sheets > 0 ? "text-red-400" : "text-slate-400"}`}>
              Pending outside store
            </p>
            <p className={`text-5xl font-bold ${wouldExceed && sheets > 0 ? "text-red-300" : "text-blue-300"}`}>
              {pending.toLocaleString()}
            </p>
            <p className="text-slate-500 text-xs mt-1">sheets ready to store</p>
          </>
        )}
      </div>

      {wouldExceed && sheets > 0 && (
        <div className="flex items-center gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <p className="text-red-300 text-sm">Cannot store {sheets} sheets — only {pending} are pending.</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-900/40 border border-emerald-600/50 rounded-2xl p-5 flex items-center gap-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" />
          <div>
            <p className="text-emerald-300 text-xl font-bold">Stored: {success.sheets} sheets</p>
            <p className="text-emerald-500 text-sm">{success.pending} sheets still pending</p>
          </div>
        </div>
      )}

      {/* Field selector */}
      <div className="grid grid-cols-3 gap-2">
        {(["sheets", "weight", "scrap"] as const).map((f) => {
          const label = f === "sheets" ? "Sheets" : f === "weight" ? "Weight (kg)" : "Scrap (kg)";
          const val = f === "sheets" ? sheetCount : f === "weight" ? weightKg : scrapWeightKg;
          const required = f === "sheets";
          return (
            <button
              key={f}
              onClick={() => setActiveField(f)}
              className={`rounded-xl p-3 text-left border-2 transition-all ${activeField === f ? "border-blue-500 bg-blue-950/40" : "border-slate-700 bg-slate-900/40"}`}
            >
              <p className={`text-xs mb-1 ${required ? "text-blue-400" : "text-slate-500"}`}>{label}{required ? " *" : ""}</p>
              <p className="text-slate-100 text-xl font-bold">{val || "—"}</p>
            </button>
          );
        })}
      </div>

      {/* Big display */}
      <div className="bg-slate-900 border-2 border-slate-700 rounded-2xl p-5 text-center">
        <p className="text-slate-500 text-xs mb-2 uppercase tracking-wide">
          {activeField === "sheets" ? "Sheet Count" : activeField === "weight" ? "Weight (kg)" : "Scrap Weight (kg)"}
        </p>
        <div className="text-5xl font-bold text-slate-100 tracking-widest min-h-[64px] flex items-center justify-center">
          {displayValue || <span className="text-slate-700">0</span>}
        </div>
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", activeField !== "sheets" ? "." : "CLR", "0", "DEL"].map((key) => (
          <button
            key={key}
            onClick={() => handleNumPad(activeField, key === "CLR" ? "CLR" : key)}
            className={`rounded-2xl p-4 text-2xl font-bold transition-all active:scale-95 select-none
              ${key === "DEL" ? "bg-red-900/40 text-red-300 border border-red-800/60 hover:bg-red-900/60" :
                key === "CLR" || key === "." ? "bg-slate-700/50 text-slate-400 border border-slate-600/60 hover:bg-slate-700/80" :
                "bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700"}`}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Remarks */}
      <div>
        <label className="text-slate-400 text-sm mb-2 block">Remarks (optional)</label>
        <textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          placeholder="Notes about this store batch…"
          className="w-full rounded-xl bg-slate-900/60 border border-slate-700 text-slate-200 placeholder:text-slate-600 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={createMut.isPending || !sheetCount || wouldExceed}
        className="w-full py-5 rounded-2xl text-xl font-bold transition-all active:scale-[0.98]
          disabled:opacity-40 disabled:cursor-not-allowed
          bg-blue-700 hover:bg-blue-600 text-white flex items-center justify-center gap-3"
      >
        {createMut.isPending ? (
          <><Loader2 className="w-6 h-6 animate-spin" /> Saving…</>
        ) : (
          <><CheckCircle2 className="w-6 h-6" /> Save to Store</>
        )}
      </button>
    </div>
  );
}
