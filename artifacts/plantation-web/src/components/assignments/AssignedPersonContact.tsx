import { PhoneCall, Briefcase, User, ExternalLink, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const WORK_TYPE_LABELS: Record<string, string> = {
  store_entry: "Store Entry",
  observer: "Observer",
  store_sale_operator: "Store Sale Operator",
  general_responsibility: "General Responsibility",
  collection_entry: "Collection Entry",
};

const STATUS_CLASSES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  completed: "bg-slate-100 text-slate-700 border-slate-200",
  expired: "bg-red-100 text-red-700 border-red-200",
  archived: "bg-orange-100 text-orange-700 border-orange-200",
};

export interface AssignedPersonContactProps {
  personMasterId: string;
  personName?: string | null;
  personMobile?: string | null;
  assignmentType: string;
  assignmentStatus: string;
  assignmentId?: string;
  compact?: boolean;
  className?: string;
}

/**
 * Reusable contact chip for assignment-related issue panels, alerts,
 * and accountability views. Shows name (linked to PersonProfile),
 * mobile, assignment type and status.
 *
 * Renders inline in compact mode (for table cells / alert rows).
 * Renders as a bordered card in default mode (for side panels / detail views).
 */
export function AssignedPersonContact({
  personMasterId,
  personName,
  personMobile,
  assignmentType,
  assignmentStatus,
  assignmentId,
  compact = false,
  className,
}: AssignedPersonContactProps) {
  const typeLabel = WORK_TYPE_LABELS[assignmentType] ?? assignmentType;
  const statusClass = STATUS_CLASSES[assignmentStatus] ?? STATUS_CLASSES.active;

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 flex-wrap", className)}>
        <Link href={`/people/${personMasterId}`}>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline cursor-pointer">
            <User className="w-3 h-3" />
            {personName ?? "Unknown"}
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </span>
        </Link>
        {personMobile && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <PhoneCall className="w-2.5 h-2.5" />
            {personMobile}
          </span>
        )}
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusClass)}>
          {typeLabel}
        </Badge>
      </span>
    );
  }

  return (
    <div className={cn("border rounded-lg p-3 bg-muted/30 space-y-2", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Assigned Person
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className={cn("text-[10px] px-1.5", statusClass)}>
            {assignmentStatus}
          </Badge>
        </div>
      </div>

      <div className="space-y-1">
        <Link href={`/people/${personMasterId}`}>
          <div className="flex items-center gap-1.5 group cursor-pointer">
            <User className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-sm font-medium text-blue-700 group-hover:underline">
              {personName ?? "Unknown Person"}
            </span>
            <ExternalLink className="w-3 h-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>

        {personMobile ? (
          <div className="flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-foreground font-medium">{personMobile}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-muted-foreground opacity-40" />
            <span className="text-xs text-muted-foreground">No mobile on record</span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{typeLabel}</span>
        </div>
      </div>

      {assignmentId && (
        <Link href={`/assign-work`}>
          <div className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline cursor-pointer pt-0.5">
            <ClipboardList className="w-3 h-3" />
            View Assignment
          </div>
        </Link>
      )}
    </div>
  );
}
