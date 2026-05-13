import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Clock } from "lucide-react";

export type GovernanceStatus = "complete" | "pending" | "incomplete" | "attention_required";

const STATUS_CONFIG: Record<
  GovernanceStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  incomplete: {
    label: "Incomplete",
    icon: XCircle,
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  attention_required: {
    label: "Attention Required",
    icon: AlertTriangle,
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

interface Props {
  status: GovernanceStatus;
  className?: string;
  size?: "sm" | "xs";
}

export function GovernanceStatusBadge({ status, className, size = "sm" }: Props) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "xs" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
        config.className,
        className
      )}
    >
      <Icon className={size === "xs" ? "w-2.5 h-2.5 flex-shrink-0" : "w-3 h-3 flex-shrink-0"} />
      {config.label}
    </span>
  );
}
