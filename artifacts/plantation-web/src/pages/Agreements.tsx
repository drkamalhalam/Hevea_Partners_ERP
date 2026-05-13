import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListAgreements,
  useCreateAgreement,
  useListProjects,
  useListPartners,
  useListPendingActivationAgreements,
  getListAgreementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  FileText,
  ExternalLink,
  Search,
  CheckCircle2,
  Clock,
  FileEdit,
  Archive,
  AlertTriangle,
  CalendarClock,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";

// ── Status helpers ────────────────────────────────────────────────────────────

type StatusCategory =
  | "all"
  | "active"
  | "pending_activation"
  | "draft"
  | "archived"
  | "expired";

interface StatusConfig {
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  draft: {
    label: "Draft",
    textClass: "text-gray-700",
    bgClass: "bg-gray-100",
    borderClass: "border-gray-200",
  },
  pending_activation: {
    label: "Pending Activation",
    textClass: "text-amber-700",
    bgClass: "bg-amber-50",
    borderClass: "border-amber-200",
  },
  active: {
    label: "Active",
    textClass: "text-emerald-700",
    bgClass: "bg-emerald-50",
    borderClass: "border-emerald-200",
  },
  terminated: {
    label: "Terminated",
    textClass: "text-red-700",
    bgClass: "bg-red-50",
    borderClass: "border-red-200",
  },
  matured: {
    label: "Matured",
    textClass: "text-blue-700",
    bgClass: "bg-blue-50",
    borderClass: "border-blue-200",
  },
};

function getStatusConfig(status: string): StatusConfig {
  return (
    STATUS_CONFIG[status] ?? {
      label: status,
      textClass: "text-gray-600",
      bgClass: "bg-gray-100",
      borderClass: "border-gray-200",
    }
  );
}

function computeExpiryDate(
  executionDate: string,
  termYears: number
): Date | null {
  const d = new Date(executionDate);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear() + termYears, d.getMonth(), d.getDate());
}

function isExpiredAgreement(a: {
  status: string;
  executionDate: string;
  termYears: number;
}): boolean {
  if (a.status !== "active") return false;
  const expiry = computeExpiryDate(a.executionDate, a.termYears);
  if (!expiry) return false;
  return expiry < new Date();
}

function formatExpiryDate(executionDate: string, termYears: number): string {
  const d = computeExpiryDate(executionDate, termYears);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Create-agreement form schema ──────────────────────────────────────────────

const formSchema = z.object({
  projectId: z.string().uuid("Select a project"),
  landOwnerId: z.string().uuid("Select a landowner"),
  projectDeveloperId: z.string().uuid("Select a developer"),
  executionDate: z.string().min(1, "Required"),
  executionPlace: z.string().min(2, "Required"),
  termYears: z.coerce.number().int().positive(),
  landArea: z.coerce.number().positive(),
  landAreaUnit: z.string().min(1),
  landNotionalValue: z.coerce.number().positive(),
  landValuePerUnit: z.coerce.number().positive(),
  landContributionAdjustment: z.coerce.number().min(0),
  yearlyEscalation: z.coerce.number().min(0),
  revenueModel: z.enum(["contribution", "fifty_percent_revenue"]),
  northBoundary: z.string().optional(),
  southBoundary: z.string().optional(),
  eastBoundary: z.string().optional(),
  westBoundary: z.string().optional(),
  gpsLat: z.coerce.number().optional(),
  gpsLng: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// ── KPI card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  count: number;
  icon: React.ReactNode;
  active: boolean;
  colorClass: string;
  onClick: () => void;
}

function KpiCard({
  label,
  count,
  icon,
  active,
  colorClass,
  onClick,
}: KpiCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border p-4 transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring",
        active
          ? "ring-2 ring-primary border-primary/30 shadow-md"
          : "border-border bg-card hover:border-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            {label}
          </p>
          <p className={cn("text-3xl font-bold tabular-nums", colorClass)}>
            {count}
          </p>
        </div>
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          {icon}
        </div>
      </div>
    </button>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  expired,
}: {
  status: string;
  expired?: boolean;
}) {
  if (expired) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
        <AlertTriangle className="w-3 h-3" />
        Expired
      </span>
    );
  }
  const cfg = getStatusConfig(status);
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        cfg.bgClass,
        cfg.textClass,
        cfg.borderClass
      )}
    >
      {cfg.label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Agreements() {
  const { data: agreements, isLoading } = useListAgreements();
  const { data: projects } = useListProjects();
  const { data: partners } = useListPartners();
  const { data: pendingActivation } = useListPendingActivationAgreements();
  const createAgreement = useCreateAgreement();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { role, canAccessAllProjects } = useRole();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusCategory>("all");
  const [projectFilter, setProjectFilter] = useState<string>("__all__");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: "",
      landOwnerId: "",
      projectDeveloperId: "",
      executionDate: "",
      executionPlace: "Ambassa, Dhalai",
      termYears: 35,
      landArea: 0,
      landAreaUnit: "kani",
      landNotionalValue: 0,
      landValuePerUnit: 30000,
      landContributionAdjustment: 5000,
      yearlyEscalation: 5,
      revenueModel: "contribution",
    },
  });

  function onSubmit(values: FormValues) {
    createAgreement.mutate(
      { data: values as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListAgreementsQueryKey(),
          });
          toast({ title: "Agreement created" });
          setOpen(false);
          form.reset();
        },
        onError: () =>
          toast({
            title: "Failed to create agreement",
            variant: "destructive",
          }),
      }
    );
  }

  const landowners = partners?.filter((p) => p.role === "landowner") ?? [];
  const developers =
    partners?.filter((p) => p.role === "project_developer") ?? [];

  // ── Analytics buckets ───────────────────────────────────────────────────────

  const analytics = useMemo(() => {
    const list = agreements ?? [];
    return {
      total: list.length,
      active: list.filter(
        (a) => a.status === "active" && !isExpiredAgreement(a)
      ).length,
      pending: list.filter((a) => a.status === "pending_activation").length,
      draft: list.filter((a) => a.status === "draft").length,
      archived: list.filter(
        (a) => a.status === "terminated" || a.status === "matured"
      ).length,
      expired: list.filter((a) => isExpiredAgreement(a)).length,
    };
  }, [agreements]);

  // ── Filtered list ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const list = agreements ?? [];
    const q = search.trim().toLowerCase();

    return list.filter((a) => {
      // Search
      if (q) {
        const haystack = [
          a.projectName,
          a.landOwnerName,
          a.projectDeveloperName,
          a.executionPlace,
          a.status,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Project filter
      if (projectFilter !== "__all__" && a.projectId !== projectFilter)
        return false;

      // Status filter
      if (statusFilter === "all") return true;
      if (statusFilter === "expired") return isExpiredAgreement(a);
      if (statusFilter === "active")
        return a.status === "active" && !isExpiredAgreement(a);
      if (statusFilter === "pending_activation")
        return a.status === "pending_activation";
      if (statusFilter === "draft") return a.status === "draft";
      if (statusFilter === "archived")
        return a.status === "terminated" || a.status === "matured";
      return true;
    });
  }, [agreements, search, statusFilter, projectFilter]);

  // Unique projects in returned agreements (for dropdown)
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    (agreements ?? []).forEach((a) => {
      if (a.projectId) map.set(a.projectId, a.projectName ?? a.projectId);
    });
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1])
    );
  }, [agreements]);

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setProjectFilter("__all__");
  }

  const hasActiveFilters =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    projectFilter !== "__all__";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Partnership Agreements
          </h1>
          <p className="text-muted-foreground mt-1">
            {canAccessAllProjects
              ? "All plantation partnership deeds across projects"
              : "Your accessible plantation partnership deeds"}
          </p>
        </div>
        {(role === "admin" || role === "developer") && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid="button-create-agreement"
                className="gap-2 shrink-0"
              >
                <Plus className="w-4 h-4" />
                New Agreement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-serif">
                  Create Partnership Agreement
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Fill in the details to create a new partnership agreement.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="projectId"
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel>Project</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-project">
                                <SelectValue placeholder="Select project" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {projects?.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="landOwnerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Landowner</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-landowner">
                                <SelectValue placeholder="Select landowner" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {landowners.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="projectDeveloperId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Developer</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-developer">
                                <SelectValue placeholder="Select developer" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {developers.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="executionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Execution Date</FormLabel>
                          <FormControl>
                            <Input
                              type="date"
                              data-testid="input-execution-date"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="executionPlace"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Execution Place</FormLabel>
                          <FormControl>
                            <Input
                              data-testid="input-execution-place"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="termYears"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Term (Years)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              data-testid="input-agreement-term"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="landArea"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Land Area</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.1"
                              data-testid="input-agreement-land-area"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="landAreaUnit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Unit</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-agreement-unit">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="kani">Kani</SelectItem>
                              <SelectItem value="acre">Acre</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="landNotionalValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Land Notional Value (INR)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              data-testid="input-notional-value"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="landValuePerUnit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Value Per Unit (INR)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              data-testid="input-value-per-unit"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="landContributionAdjustment"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>LCA (INR/unit/yr)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              data-testid="input-lca"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="yearlyEscalation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Yearly Escalation (%)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.1"
                              data-testid="input-escalation"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="revenueModel"
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel>Revenue Model</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-revenue-model">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="contribution">
                                Contribution Model
                              </SelectItem>
                              <SelectItem value="fifty_percent_revenue">
                                50% Revenue Model
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="northBoundary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>North Boundary</FormLabel>
                          <FormControl>
                            <Input data-testid="input-north" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="southBoundary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>South Boundary</FormLabel>
                          <FormControl>
                            <Input data-testid="input-south" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="eastBoundary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>East Boundary</FormLabel>
                          <FormControl>
                            <Input data-testid="input-east" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="westBoundary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>West Boundary</FormLabel>
                          <FormControl>
                            <Input data-testid="input-west" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      data-testid="button-submit-agreement"
                      disabled={createAgreement.isPending}
                    >
                      {createAgreement.isPending
                        ? "Creating…"
                        : "Create Agreement"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Analytics KPI row */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="All Agreements"
            count={analytics.total}
            icon={<FileText className="w-4 h-4" />}
            active={statusFilter === "all"}
            colorClass="text-foreground"
            onClick={() => setStatusFilter("all")}
          />
          <KpiCard
            label="Active"
            count={analytics.active}
            icon={<CheckCircle2 className="w-4 h-4" />}
            active={statusFilter === "active"}
            colorClass="text-emerald-700"
            onClick={() => setStatusFilter("active")}
          />
          <KpiCard
            label="Pending Activation"
            count={analytics.pending}
            icon={<Clock className="w-4 h-4" />}
            active={statusFilter === "pending_activation"}
            colorClass="text-amber-600"
            onClick={() => setStatusFilter("pending_activation")}
          />
          <KpiCard
            label="Draft"
            count={analytics.draft}
            icon={<FileEdit className="w-4 h-4" />}
            active={statusFilter === "draft"}
            colorClass="text-gray-600"
            onClick={() => setStatusFilter("draft")}
          />
          <KpiCard
            label="Archived"
            count={analytics.archived}
            icon={<Archive className="w-4 h-4" />}
            active={statusFilter === "archived"}
            colorClass="text-slate-600"
            onClick={() => setStatusFilter("archived")}
          />
          <KpiCard
            label="Expired"
            count={analytics.expired}
            icon={<AlertTriangle className="w-4 h-4" />}
            active={statusFilter === "expired"}
            colorClass="text-orange-600"
            onClick={() => setStatusFilter("expired")}
          />
        </div>
      )}

      {/* Search + filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by project, landowner, or developer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-agreements"
              />
            </div>
            {projectOptions.length > 0 && (
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger
                  className="w-full sm:w-56"
                  data-testid="select-project-filter"
                >
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All projects</SelectItem>
                  {projectOptions.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="gap-1.5 text-muted-foreground hover:text-foreground shrink-0"
              >
                <X className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>
          {/* Active status pill */}
          {statusFilter !== "all" && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Showing:</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                {statusFilter === "active" && "Active agreements"}
                {statusFilter === "pending_activation" &&
                  "Pending activation"}
                {statusFilter === "draft" && "Drafts"}
                {statusFilter === "archived" && "Archived / terminated"}
                {statusFilter === "expired" && "Expired agreements"}
                <button
                  onClick={() => setStatusFilter("all")}
                  className="hover:text-primary/70"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="px-6 py-4 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Agreement Register
              </CardTitle>
              <span className="text-sm text-muted-foreground tabular-nums">
                {filtered.length} of {analytics.total} agreement
                {analytics.total !== 1 ? "s" : ""}
              </span>
            </div>
          </CardHeader>

          {filtered.length === 0 ? (
            <CardContent className="py-16 text-center">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="font-medium text-muted-foreground">
                {hasActiveFilters
                  ? "No agreements match your filters."
                  : "No agreements yet."}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={clearFilters}
                  className="mt-1"
                >
                  Clear filters
                </Button>
              )}
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-6 py-3 font-medium">Project</th>
                    <th className="text-left px-4 py-3 font-medium">Parties</th>
                    <th className="text-right px-4 py-3 font-medium">
                      Area
                    </th>
                    <th className="text-right px-4 py-3 font-medium">
                      Notional Value
                    </th>
                    <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">
                      Revenue Model
                    </th>
                    <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                      Executed
                    </th>
                    <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">
                      Expiry
                    </th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-right px-6 py-3 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((a) => {
                    const expired = isExpiredAgreement(a);
                    return (
                      <tr
                        key={a.id}
                        data-testid={`row-agreement-${a.id}`}
                        className={cn(
                          "hover:bg-muted/30 transition-colors group",
                          expired && "bg-orange-50/40"
                        )}
                      >
                        <td className="px-6 py-3.5">
                          <div className="font-serif font-semibold text-foreground leading-tight">
                            {a.projectName}
                          </div>
                          {a.executionPlace && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {a.executionPlace}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-xs space-y-0.5">
                            <div>
                              <span className="text-muted-foreground">LO: </span>
                              <span className="font-medium text-foreground">
                                {a.landOwnerName}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Dev: </span>
                              <span className="font-medium text-foreground">
                                {a.projectDeveloperName}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                          <span className="font-medium">
                            {a.landArea != null
                              ? Number(a.landArea).toLocaleString("en-IN", {
                                  maximumFractionDigits: 2,
                                })
                              : "—"}
                          </span>{" "}
                          <span className="text-muted-foreground text-xs uppercase">
                            {a.landAreaUnit}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                          <span className="font-medium">
                            ₹
                            {a.landNotionalValue != null
                              ? Number(a.landNotionalValue).toLocaleString(
                                  "en-IN"
                                )
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                            {a.revenueModel?.replace(/_/g, " ") ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 hidden md:table-cell text-muted-foreground whitespace-nowrap">
                          {a.executionDate ?? "—"}
                        </td>
                        <td className="px-4 py-3.5 hidden xl:table-cell whitespace-nowrap">
                          {a.termYears && a.executionDate ? (
                            <div className="flex items-center gap-1.5">
                              <CalendarClock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <span
                                className={cn(
                                  "text-xs",
                                  expired
                                    ? "text-orange-600 font-medium"
                                    : "text-muted-foreground"
                                )}
                              >
                                {formatExpiryDate(
                                  a.executionDate,
                                  a.termYears
                                )}
                                {expired && " (exp)"}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge status={a.status} expired={expired} />
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <Link href={`/agreements/${a.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 opacity-70 group-hover:opacity-100"
                              data-testid={`button-view-agreement-${a.id}`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Pending OTP panel — shown when there are pending activation agreements */}
      {!isLoading &&
        (pendingActivation?.length ?? 0) > 0 &&
        statusFilter !== "pending_activation" && (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      {pendingActivation?.length} agreement
                      {pendingActivation!.length !== 1 ? "s" : ""} awaiting OTP
                      verification
                    </p>
                    <p className="text-xs text-amber-700">
                      Activation workflows are in progress and require party
                      sign-off.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0"
                  onClick={() => setStatusFilter("pending_activation")}
                >
                  View all
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
