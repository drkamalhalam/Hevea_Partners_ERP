import { useGetOwnershipFreeze, getGetOwnershipFreezeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Lock,
  CheckCircle2,
  XCircle,
  CalendarDays,
  User,
  FileText,
  ShieldAlert,
} from "lucide-react";

interface Props {
  projectId: string;
}

const STATUS_LABELS: Record<string, string> = {
  frozen: "Ownership Frozen",
  transfer_pending: "Transfer In Progress",
  inheritance_pending: "Inheritance Settlement In Progress",
};

const STATUS_COLORS: Record<string, string> = {
  frozen: "bg-red-100 text-red-800 border-red-200",
  transfer_pending: "bg-amber-100 text-amber-800 border-amber-200",
  inheritance_pending: "bg-amber-100 text-amber-800 border-amber-200",
};

const OPERATION_LABELS: Record<string, string> = {
  share_transfer: "Share Transfer",
  inheritance_workflow: "Inheritance Settlement Workflow",
  direct_ownership_change: "Direct Ownership Change",
  ownership_dilution: "Ownership Dilution / Restructuring",
  new_partner_entry: "New Partner Entry",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function OwnershipFreezePanel({ projectId }: Props) {
  const { data: freeze, isLoading, error } = useGetOwnershipFreeze(projectId, {
    query: { retry: false, queryKey: getGetOwnershipFreezeQueryKey(projectId) },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (error || !freeze) {
    return null;
  }

  return (
    <Card className="border-red-200 bg-red-50/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-red-600 flex-shrink-0" />
            <CardTitle className="font-serif text-base">Ownership Freeze</CardTitle>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border font-medium ${STATUS_COLORS[freeze.status] ?? "bg-gray-100 text-gray-800 border-gray-200"}`}
          >
            {STATUS_LABELS[freeze.status] ?? freeze.status}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 ml-6">
          The ownership structure of this project is permanently frozen. No direct ownership
          changes are permitted.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Freeze metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
            <CalendarDays className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Frozen On</p>
              <p className="font-medium">{formatDate(freeze.frozenAt)}</p>
            </div>
          </div>
          {freeze.frozenByName && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-background border">
              <User className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Frozen By</p>
                <p className="font-medium">{freeze.frozenByName}</p>
              </div>
            </div>
          )}
          {freeze.notes && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-background border sm:col-span-2">
              <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm text-muted-foreground">{freeze.notes}</p>
              </div>
            </div>
          )}
        </div>

        {/* Governance permissions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Allowed */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
            <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Permitted Operations
            </p>
            <ul className="space-y-1.5">
              {freeze.allowedOperations.map((op) => (
                <li key={op} className="flex items-center gap-2 text-sm text-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  {OPERATION_LABELS[op] ?? op}
                </li>
              ))}
            </ul>
          </div>

          {/* Restricted */}
          <div className="rounded-lg border border-red-200 bg-red-50/40 p-3">
            <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> Restricted Operations
            </p>
            <ul className="space-y-1.5">
              {freeze.restrictedOperations.map((op) => (
                <li key={op} className="flex items-center gap-2 text-sm text-red-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                  {OPERATION_LABELS[op] ?? op}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Governance notice */}
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50/30 text-xs text-amber-800">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Ownership calculations and share percentages are not yet recorded. This freeze
            governs the <strong>structure</strong> only — any future ownership modules will
            inherit this frozen state.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
