import { cn } from "@/lib/utils";

export type LifecycleStatus = "prematurity" | "mature_production" | "closed";

const CONFIG: Record<
  LifecycleStatus,
  { label: string; className: string }
> = {
  prematurity: {
    label: "Prematurity",
    className: "bg-sky-100 text-sky-800 border-sky-200",
  },
  mature_production: {
    label: "Mature Production",
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  closed: {
    label: "Closed",
    className: "bg-gray-100 text-gray-600 border-gray-200",
  },
};

interface LifecycleBadgeProps {
  status: LifecycleStatus | string;
  size?: "sm" | "md";
  className?: string;
}

export default function LifecycleBadge({
  status,
  size = "md",
  className,
}: LifecycleBadgeProps) {
  const cfg = CONFIG[status as LifecycleStatus] ?? {
    label: status,
    className: "bg-gray-100 text-gray-600 border-gray-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        size === "sm"
          ? "text-xs px-2 py-0.5"
          : "text-sm px-3 py-1",
        cfg.className,
        className,
      )}
    >
      {cfg.label}
    </span>
  );
}
