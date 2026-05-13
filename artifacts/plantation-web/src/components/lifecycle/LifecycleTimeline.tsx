import { CheckCircle2, Circle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LifecycleStatus } from "./LifecycleBadge";

const PHASES: { key: LifecycleStatus; label: string; description: string }[] =
  [
    {
      key: "prematurity",
      label: "Prematurity",
      description: "Trees planted & growing",
    },
    {
      key: "mature_production",
      label: "Mature Production",
      description: "Active tapping & harvesting",
    },
    {
      key: "closed",
      label: "Closed",
      description: "Project concluded",
    },
  ];

const ORDER: LifecycleStatus[] = [
  "prematurity",
  "mature_production",
  "closed",
];

interface LifecycleTimelineProps {
  currentStatus: LifecycleStatus | string;
  transitionDate?: Record<string, string>;
}

export default function LifecycleTimeline({
  currentStatus,
  transitionDate = {},
}: LifecycleTimelineProps) {
  const currentIdx = ORDER.indexOf(currentStatus as LifecycleStatus);

  return (
    <div className="relative">
      <div className="flex items-start justify-between gap-0">
        {PHASES.map((phase, idx) => {
          const isPast = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;
          const isLast = idx === PHASES.length - 1;

          return (
            <div key={phase.key} className="flex-1 flex flex-col items-center">
              <div className="flex items-center w-full">
                <div
                  className={cn(
                    "h-0.5 flex-1",
                    idx === 0 ? "invisible" : "",
                    isPast || isCurrent ? "bg-emerald-500" : "bg-gray-200",
                  )}
                />
                <div
                  className={cn(
                    "relative z-10 flex items-center justify-center w-9 h-9 rounded-full border-2 shrink-0",
                    isPast &&
                      "bg-emerald-500 border-emerald-500 text-white",
                    isCurrent &&
                      "bg-white border-emerald-500 text-emerald-600 shadow-sm ring-4 ring-emerald-50",
                    isFuture && "bg-white border-gray-200 text-gray-300",
                  )}
                >
                  {isPast ? (
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  ) : isCurrent ? (
                    <Circle className="w-4 h-4 fill-emerald-500 text-emerald-500" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-gray-300" />
                  )}
                </div>
                <div
                  className={cn(
                    "h-0.5 flex-1",
                    isLast ? "invisible" : "",
                    isPast ? "bg-emerald-500" : "bg-gray-200",
                  )}
                />
              </div>

              <div className="mt-2 text-center px-1">
                <p
                  className={cn(
                    "text-xs font-semibold",
                    isCurrent
                      ? "text-emerald-700"
                      : isPast
                        ? "text-gray-600"
                        : "text-gray-300",
                  )}
                >
                  {phase.label}
                </p>
                <p
                  className={cn(
                    "text-xs mt-0.5",
                    isCurrent
                      ? "text-emerald-600"
                      : isPast
                        ? "text-gray-400"
                        : "text-gray-200",
                  )}
                >
                  {phase.description}
                </p>
                {transitionDate[phase.key] && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(transitionDate[phase.key]).toLocaleDateString(
                      "en-IN",
                      { day: "numeric", month: "short", year: "numeric" },
                    )}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
