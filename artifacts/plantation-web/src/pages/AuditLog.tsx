import { useState } from "react";
import {
  useListAuditLogs,
  useGetRecordAuditTimeline,
  useGetMyActivity,
  useListProjects,
} from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ClipboardList,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  tableName: string;
  recordId: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  module: string | null;
  actionType: string | null;
  projectId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODULES = [
  "contributions",
  "expenditures",
  "ownership_transfers",
  "agreements",
  "sales",
  "governance",
  "inheritance",
];

const OPERATION_COLORS: Record<string, string> = {
  INSERT: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  UPDATE: "bg-blue-900/40 text-blue-300 border-blue-800",
  DELETE: "bg-red-900/40 text-red-300 border-red-800",
};

function formatActionType(actionType: string | null, operation: string): string {
  if (actionType) {
    return actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return operation;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatModule(m: string | null): string {
  if (!m) return "—";
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── AuditTable ────────────────────────────────────────────────────────────────

function AuditTable({
  entries,
  emptyLabel,
}: {
  entries: AuditLogEntry[];
  emptyLabel?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        {emptyLabel ?? "No audit entries found."}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-gray-800 hover:bg-transparent">
          <TableHead className="text-gray-400 text-xs">Timestamp</TableHead>
          <TableHead className="text-gray-400 text-xs">Actor</TableHead>
          <TableHead className="text-gray-400 text-xs">Action</TableHead>
          <TableHead className="text-gray-400 text-xs">Module</TableHead>
          <TableHead className="text-gray-400 text-xs">Record</TableHead>
          <TableHead className="text-gray-400 text-xs">Op</TableHead>
          <TableHead className="text-gray-400 text-xs w-8"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.id;
          return (
            <>
              <TableRow
                key={entry.id}
                className="border-gray-800 hover:bg-gray-900/50 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                <TableCell className="text-xs text-gray-300 whitespace-nowrap">
                  {formatDate(entry.createdAt)}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-gray-200 font-medium">
                      {entry.userName ?? "System"}
                    </span>
                    {entry.userRole && (
                      <span className="text-gray-500 capitalize text-[10px]">
                        {entry.userRole.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-gray-200">
                  {formatActionType(entry.actionType, entry.operation)}
                </TableCell>
                <TableCell className="text-xs text-gray-400">
                  {formatModule(entry.module)}
                </TableCell>
                <TableCell className="text-xs font-mono text-gray-500 max-w-[120px] truncate">
                  {entry.recordId.slice(0, 8)}…
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${OPERATION_COLORS[entry.operation] ?? ""}`}
                  >
                    {entry.operation}
                  </Badge>
                </TableCell>
                <TableCell className="text-gray-600 text-xs">
                  {isExpanded ? "▲" : "▼"}
                </TableCell>
              </TableRow>

              {isExpanded && (
                <TableRow
                  key={`${entry.id}-detail`}
                  className="border-gray-800 bg-gray-950/60"
                >
                  <TableCell colSpan={7} className="px-4 py-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide text-[10px]">
                          Full Record ID
                        </p>
                        <p className="font-mono text-gray-300 break-all">{entry.recordId}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide text-[10px]">
                          Table
                        </p>
                        <p className="font-mono text-gray-300">{entry.tableName}</p>
                      </div>
                      {entry.projectId && (
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide text-[10px]">
                            Project ID
                          </p>
                          <p className="font-mono text-gray-300 break-all">{entry.projectId}</p>
                        </div>
                      )}
                      {entry.oldData && (
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide text-[10px]">
                            Before
                          </p>
                          <pre className="text-gray-300 bg-gray-900 p-2 rounded text-[10px] overflow-auto max-h-32">
                            {JSON.stringify(entry.oldData, null, 2)}
                          </pre>
                        </div>
                      )}
                      {entry.newData && (
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide text-[10px]">
                            After
                          </p>
                          <pre className="text-gray-300 bg-gray-900 p-2 rounded text-[10px] overflow-auto max-h-32">
                            {JSON.stringify(entry.newData, null, 2)}
                          </pre>
                        </div>
                      )}
                      {entry.ipAddress && (
                        <div>
                          <p className="text-gray-500 mb-1 font-medium uppercase tracking-wide text-[10px]">
                            IP Address
                          </p>
                          <p className="font-mono text-gray-300">{entry.ipAddress}</p>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({
  offset,
  limit,
  total,
  onPrev,
  onNext,
}: {
  offset: number;
  limit: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex items-center justify-between py-3 px-1 text-xs text-gray-400">
      <span>
        {total === 0
          ? "No results"
          : `Showing ${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {page} of {totalPages || 1}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 border-gray-700"
          disabled={offset === 0}
          onClick={onPrev}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 border-gray-700"
          disabled={offset + limit >= total}
          onClick={onNext}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Full Log Tab ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function FullLogTab() {
  const { data: projectsData } = useListProjects();
  const projects = (Array.isArray(projectsData) ? projectsData : []) as Project[];

  const [module, setModule] = useState("");
  const [actionType, setActionType] = useState("");
  const [projectId, setProjectId] = useState("");
  const [operation, setOperation] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const [applied, setApplied] = useState<Record<string, string | number>>({
    limit: PAGE_SIZE,
    offset: 0,
  });

  const { data, isLoading, isFetching, refetch } = useListAuditLogs(applied as never);
  const raw = data as { entries?: AuditLogEntry[]; total?: number } | undefined;
  const entries = raw?.entries ?? [];
  const total = raw?.total ?? 0;

  function applyFilters() {
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: 0 };
    if (module) params.module = module;
    if (actionType) params.actionType = actionType;
    if (projectId) params.projectId = projectId;
    if (operation) params.operation = operation;
    if (from) params.from = from;
    if (to) params.to = to;
    setOffset(0);
    setApplied(params);
  }

  function clearFilters() {
    setModule("");
    setActionType("");
    setProjectId("");
    setOperation("");
    setFrom("");
    setTo("");
    setOffset(0);
    setApplied({ limit: PAGE_SIZE, offset: 0 });
  }

  function goNext() {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    setApplied((p) => ({ ...p, offset: next }));
  }

  function goPrev() {
    const prev = Math.max(0, offset - PAGE_SIZE);
    setOffset(prev);
    setApplied((p) => ({ ...p, offset: prev }));
  }

  return (
    <div className="space-y-4">
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-sm text-gray-200 flex items-center gap-2">
            <Search className="w-4 h-4" />
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Module</Label>
              <Select value={module} onValueChange={setModule}>
                <SelectTrigger className="h-8 text-xs bg-gray-950 border-gray-700">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Modules</SelectItem>
                  {MODULES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatModule(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Operation</Label>
              <Select value={operation} onValueChange={setOperation}>
                <SelectTrigger className="h-8 text-xs bg-gray-950 border-gray-700">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="INSERT">INSERT</SelectItem>
                  <SelectItem value="UPDATE">UPDATE</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8 text-xs bg-gray-950 border-gray-700">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Action type</Label>
              <Input
                className="h-8 text-xs bg-gray-950 border-gray-700"
                placeholder="e.g. contribution_verified"
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-400">From</Label>
              <Input
                type="date"
                className="h-8 text-xs bg-gray-950 border-gray-700"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-400">To</Label>
              <Input
                type="date"
                className="h-8 text-xs bg-gray-950 border-gray-700"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-700 hover:bg-emerald-600"
              onClick={applyFilters}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-gray-700"
              onClick={clearFilters}
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs ml-auto text-gray-400"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : (
            <>
              <ScrollArea className="max-h-[560px]">
                <AuditTable
                  entries={entries}
                  emptyLabel="No audit entries match the current filters."
                />
              </ScrollArea>
              <Separator className="bg-gray-800" />
              <div className="px-4">
                <Pagination
                  offset={offset}
                  limit={PAGE_SIZE}
                  total={total}
                  onPrev={goPrev}
                  onNext={goNext}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Record Timeline Tab ───────────────────────────────────────────────────────

function RecordTimelineTab() {
  const [tableName, setTableName] = useState("contributions");
  const [recordId, setRecordId] = useState("");
  const [submitted, setSubmitted] = useState<{
    tableName: string;
    recordId: string;
  } | null>(null);

  const { data, isLoading } = useGetRecordAuditTimeline(
    submitted?.tableName ?? "",
    submitted?.recordId ?? "",
    { query: { enabled: !!submitted, queryKey: ["/api/audit/record-timeline", submitted?.tableName, submitted?.recordId] } },
  );

  const raw = data as { entries?: AuditLogEntry[] } | undefined;
  const entries = raw?.entries ?? [];

  return (
    <div className="space-y-4">
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-sm text-gray-200">
            Look up a record's history
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Enter the table name and UUID of any record to view its full audit
            timeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-400">Table name</Label>
              <Select value={tableName} onValueChange={setTableName}>
                <SelectTrigger className="h-8 text-xs bg-gray-950 border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contributions">contributions</SelectItem>
                  <SelectItem value="expenditures">expenditures</SelectItem>
                  <SelectItem value="ownership_transfers">
                    ownership_transfers
                  </SelectItem>
                  <SelectItem value="agreements">agreements</SelectItem>
                  <SelectItem value="agreement_generations">
                    agreement_generations
                  </SelectItem>
                  <SelectItem value="sales_transactions">
                    sales_transactions
                  </SelectItem>
                  <SelectItem value="inheritance_claims">
                    inheritance_claims
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs text-gray-400">Record UUID</Label>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs bg-gray-950 border-gray-700 font-mono"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={recordId}
                  onChange={(e) => setRecordId(e.target.value.trim())}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-700 hover:bg-emerald-600 shrink-0"
                  onClick={() =>
                    setSubmitted(recordId ? { tableName, recordId } : null)
                  }
                  disabled={!recordId}
                >
                  <Search className="w-3.5 h-3.5 mr-1" />
                  Look up
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {submitted && (
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm text-gray-200">
              Timeline for{" "}
              <span className="font-mono text-emerald-400">
                {submitted.tableName}
              </span>{" "}
              /{" "}
              <span className="font-mono text-emerald-400">
                {submitted.recordId.slice(0, 8)}…
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                Loading…
              </div>
            ) : (
              <ScrollArea className="max-h-[500px]">
                <AuditTable
                  entries={entries}
                  emptyLabel="No audit entries found for this record. It may predate the audit logging engine."
                />
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── My Activity Tab ───────────────────────────────────────────────────────────

function MyActivityTab() {
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading } = useGetMyActivity({ limit, offset } as never);
  const raw = data as { entries?: AuditLogEntry[]; total?: number } | undefined;
  const entries = raw?.entries ?? [];
  const total = raw?.total ?? 0;

  return (
    <div className="space-y-4">
      <Card className="bg-gray-900 border-gray-800">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-sm text-gray-200 flex items-center gap-2">
            <User className="w-4 h-4" />
            Your Recent Activity
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            All actions you have performed that are tracked by the audit engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">
              Loading…
            </div>
          ) : (
            <>
              <ScrollArea className="max-h-[560px]">
                <AuditTable
                  entries={entries}
                  emptyLabel="No recorded activity yet. Actions you take on contributions, expenditures, and transfers will appear here."
                />
              </ScrollArea>
              <Separator className="bg-gray-800" />
              <div className="px-4">
                <Pagination
                  offset={offset}
                  limit={limit}
                  total={total}
                  onPrev={() => setOffset((o) => Math.max(0, o - limit))}
                  onNext={() => setOffset((o) => o + limit)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLog() {
  const { isAdmin, role } = useRole();
  const isAdminOrDev = isAdmin || role === "developer";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-900/40 border border-emerald-800 shrink-0">
          <ClipboardList className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-100">Audit Log</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Immutable record of all system actions — contributions, expenditures,
            transfers, agreements, and more.
          </p>
        </div>
      </div>

      <Tabs defaultValue={isAdminOrDev ? "full-log" : "my-activity"}>
        <TabsList className="bg-gray-900 border border-gray-800">
          {isAdminOrDev && (
            <TabsTrigger value="full-log" className="text-xs">
              Full Activity Log
            </TabsTrigger>
          )}
          <TabsTrigger value="record-timeline" className="text-xs">
            Record Timeline
          </TabsTrigger>
          <TabsTrigger value="my-activity" className="text-xs">
            My Activity
          </TabsTrigger>
        </TabsList>

        {isAdminOrDev && (
          <TabsContent value="full-log" className="mt-4">
            <FullLogTab />
          </TabsContent>
        )}

        <TabsContent value="record-timeline" className="mt-4">
          <RecordTimelineTab />
        </TabsContent>

        <TabsContent value="my-activity" className="mt-4">
          <MyActivityTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
