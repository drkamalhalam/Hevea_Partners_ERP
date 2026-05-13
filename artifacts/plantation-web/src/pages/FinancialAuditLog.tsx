import { useState } from "react";
import {
  useListFinancialAccessLogs,
  getListFinancialAccessLogsQueryKey,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Shield,
  ShieldAlert,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Server,
  Database,
  FileText,
} from "lucide-react";

// ── constants ─────────────────────────────────────────────────────────────────

const RESOURCE_LABELS: Record<string, string> = {
  lca_configs: "LCA Configs",
  lca_config: "LCA Config (single)",
  lca_schedule: "LCA Schedule",
  lca_ledger: "LCA Ledger",
  lca_summary: "LCA Summary",
  lca_payments: "LCA Payments",
  lca_full_ledger: "LCA Full Ledger",
  lca_governance: "LCA Governance",
  lca_receivable: "LCA Receivable",
  landowner_account_summary: "Landowner Account Summary",
  landowner_ledger_entries: "Landowner Ledger",
  landowner_profitability: "Landowner Profitability",
  agreement_accounting_profile: "Agreement Accounting Profile",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/15 text-red-400 border-red-500/30",
  developer: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  landowner: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  investor: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  employee: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  operational_staff: "bg-green-500/15 text-green-400 border-green-500/30",
};

function resourceIcon(resource: string) {
  if (resource.startsWith("lca")) return <Database className="h-3.5 w-3.5 text-orange-400" />;
  if (resource.startsWith("landowner")) return <FileText className="h-3.5 w-3.5 text-amber-400" />;
  if (resource.startsWith("agreement")) return <FileText className="h-3.5 w-3.5 text-blue-400" />;
  return <Eye className="h-3.5 w-3.5 text-gray-400" />;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  });
}

// ── component ─────────────────────────────────────────────────────────────────

const LIMIT = 50;
const RESOURCE_OPTIONS = ["", ...Object.keys(RESOURCE_LABELS)];

export default function FinancialAuditLog() {
  const { role } = useRole();
  const isDeveloper = role === "developer";
  const [offset, setOffset] = useState(0);
  const [resourceFilter, setResourceFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");

  if (role !== "admin" && role !== "developer") {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 min-h-[300px]">
        <ShieldAlert className="h-12 w-12 text-red-400" />
        <h2 className="text-xl font-semibold text-white">Access Denied</h2>
        <p className="text-gray-400 text-sm text-center max-w-xs">
          The financial access audit log is restricted to admin and developer roles.
        </p>
      </div>
    );
  }

  const { data, isLoading, refetch, isFetching } = useListFinancialAccessLogs(
    {
      resource: resourceFilter || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
      limit: LIMIT,
      offset,
    },
    {
      query: {
        queryKey: getListFinancialAccessLogsQueryKey({
          resource: resourceFilter || undefined,
          from: fromFilter || undefined,
          to: toFilter || undefined,
          limit: LIMIT,
          offset,
        }),
      },
    },
  );

  const entries = data?.entries ?? [];
  const hasMore = entries.length === LIMIT;

  function resetFilters() {
    setResourceFilter("");
    setFromFilter("");
    setToFilter("");
    setOffset(0);
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-400" />
            Financial Access Audit Log
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {isDeveloper
              ? "Showing the last 7 days of financial data access events."
              : "Complete history of all financial data access events across the platform."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-gray-400 mb-1 block">Resource</Label>
              <Select
                value={resourceFilter}
                onValueChange={(v) => { setResourceFilter(v === "all" ? "" : v); setOffset(0); }}
              >
                <SelectTrigger className="bg-gray-700 border-gray-600 text-white h-8 text-sm">
                  <SelectValue placeholder="All resources" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="all" className="text-gray-300">All resources</SelectItem>
                  {Object.entries(RESOURCE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val} className="text-gray-300 text-sm">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-400 mb-1 block">From date</Label>
              <Input
                type="datetime-local"
                value={fromFilter}
                onChange={(e) => { setFromFilter(e.target.value); setOffset(0); }}
                className="bg-gray-700 border-gray-600 text-white h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-400 mb-1 block">To date</Label>
              <Input
                type="datetime-local"
                value={toFilter}
                onChange={(e) => { setToFilter(e.target.value); setOffset(0); }}
                className="bg-gray-700 border-gray-600 text-white h-8 text-sm"
              />
            </div>
          </div>
          {(resourceFilter || fromFilter || toFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="mt-2 text-gray-400 hover:text-white h-7 text-xs"
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-gray-400 font-normal flex items-center gap-2">
            <Server className="h-4 w-4" />
            {isLoading ? "Loading…" : `${entries.length} entries`}
            {entries.length === LIMIT && (
              <span className="text-xs text-gray-500">(showing {LIMIT} per page)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-700 rounded animate-pulse" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              No audit log entries found for the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-700 hover:bg-transparent">
                    <TableHead className="text-gray-400 text-xs">Time</TableHead>
                    <TableHead className="text-gray-400 text-xs">Role</TableHead>
                    <TableHead className="text-gray-400 text-xs">Resource</TableHead>
                    <TableHead className="text-gray-400 text-xs">Action</TableHead>
                    <TableHead className="text-gray-400 text-xs hidden md:table-cell">Project</TableHead>
                    <TableHead className="text-gray-400 text-xs hidden lg:table-cell">IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} className="border-gray-700 hover:bg-gray-750">
                      <TableCell className="text-gray-300 text-xs whitespace-nowrap py-2">
                        {formatTime(entry.accessedAt)}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          className={`text-xs border ${ROLE_COLORS[entry.userRole] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"}`}
                        >
                          {entry.userRole}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1.5">
                          {resourceIcon(entry.resource)}
                          <span className="text-gray-300 text-xs">
                            {RESOURCE_LABELS[entry.resource] ?? entry.resource}
                          </span>
                          {entry.resourceId && (
                            <span className="text-gray-600 text-xs font-mono hidden xl:inline">
                              {entry.resourceId.slice(0, 8)}…
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge className="bg-gray-700 text-gray-300 border-gray-600 text-xs">
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs py-2 hidden md:table-cell font-mono">
                        {entry.projectId ? `${entry.projectId.slice(0, 8)}…` : "—"}
                      </TableCell>
                      <TableCell className="text-gray-500 text-xs py-2 hidden lg:table-cell font-mono">
                        {entry.ipAddress ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {(offset > 0 || hasMore) && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1 h-8"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Previous
          </Button>
          <span className="text-xs text-gray-500">
            Showing {offset + 1}–{offset + entries.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + LIMIT)}
            disabled={!hasMore}
            className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1 h-8"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Security note */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-4 py-3">
        <p className="text-xs text-blue-400/80 leading-relaxed">
          <span className="font-semibold">Security note:</span> This log records every access to
          sensitive financial data (LCA, landowner accounting, profitability analytics). All entries
          are write-once and cannot be modified or deleted through the application. Developers see
          only the last 7 days; admins see the full history.
        </p>
      </div>
    </div>
  );
}
