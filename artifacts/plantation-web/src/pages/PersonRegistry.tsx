import { useState, useCallback } from "react";
import { Link } from "wouter";
import {
  useListPersonMaster,
  useCreatePersonMaster,
  getListPersonMasterQueryKey,
  type PersonMasterSummary,
  type ListPersonMasterParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus,
  Search,
  ShieldCheck,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Phone,
  Mail,
  Users,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  UserCheck,
  Fingerprint,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

// ── Helpers ────────────────────────────────────────────────────────────────

function derivePersonId(id: string, createdAt: string): string {
  const year = new Date(createdAt).getFullYear();
  const hexSlice = id.replace(/-/g, "").slice(0, 5);
  const num = parseInt(hexSlice, 16) % 100000;
  return `PRS-${year}-${String(num).padStart(5, "0")}`;
}

const KYC_CONFIG: Record<string, { label: string; icon: React.ElementType; classes: string }> = {
  verified: { label: "Verified", icon: ShieldCheck, classes: "bg-emerald-100 text-emerald-800" },
  pending: { label: "Pending", icon: Clock, classes: "bg-amber-100 text-amber-800" },
  documents_submitted: { label: "Docs Submitted", icon: CheckCircle2, classes: "bg-blue-100 text-blue-800" },
  flagged: { label: "Flagged", icon: ShieldAlert, classes: "bg-red-100 text-red-800" },
};

function KycBadge({ status }: { status: string }) {
  const cfg = KYC_CONFIG[status] ?? KYC_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.classes}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ── Create form schema ────────────────────────────────────────────────────

const createSchema = z.object({
  fullName: z.string().min(2, "Name must be at least 2 characters"),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  aadhaarNumber: z
    .string()
    .length(12, "Aadhaar number must be exactly 12 digits")
    .regex(/^\d{12}$/, "Aadhaar must be 12 digits")
    .optional()
    .or(z.literal("")),
  mobile: z.string().min(10).optional().or(z.literal("")),
  alternateMobile: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  permanentAddress: z.string().optional(),
  village: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  remarks: z.string().optional(),
});
type CreateFormValues = z.infer<typeof createSchema>;

// ── Wizard steps ──────────────────────────────────────────────────────────

type WizardStep = "search" | "results" | "create";

interface WizardState {
  step: WizardStep;
  searchQuery: string;
  searchAadhaar: string;
  searchMobile: string;
  matches: PersonMasterSummary[];
}

// ── Person card ────────────────────────────────────────────────────────────

function PersonCard({ person }: { person: PersonMasterSummary }) {
  const pid = derivePersonId(person.id, person.createdAt);
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="font-serif text-base leading-tight">
              {person.fullName}
            </CardTitle>
            {person.sOnCOn && (
              <p className="text-xs text-muted-foreground mt-0.5">{person.sOnCOn}</p>
            )}
          </div>
          <KycBadge status={person.kycStatus} />
        </div>
        <p className="text-[10px] font-mono text-muted-foreground/60">{pid}</p>
      </CardHeader>
      <CardContent className="space-y-1.5 pb-3">
        {person.mobile && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="w-3 h-3 flex-shrink-0" />
            {person.mobile}
          </div>
        )}
        {person.email && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{person.email}</span>
          </div>
        )}
        {person.aadhaarLast4 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Fingerprint className="w-3 h-3 flex-shrink-0" />
            XXXX-XXXX-{person.aadhaarLast4}
          </div>
        )}
        {(person.district || person.state) && (
          <p className="text-xs text-muted-foreground">
            {[person.district, person.state].filter(Boolean).join(", ")}
          </p>
        )}
        <div className="pt-1">
          <Link href={`/person-registry/${person.id}`}>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1 text-xs"
              data-testid={`btn-view-person-${person.id}`}
            >
              View Profile <ChevronRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Match card (in wizard step 2) ─────────────────────────────────────────

function MatchCard({
  person,
  onSelect,
}: {
  person: PersonMasterSummary;
  onSelect: (p: PersonMasterSummary) => void;
}) {
  const pid = derivePersonId(person.id, person.createdAt);
  return (
    <div className="border rounded-lg p-3 space-y-1 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{person.fullName}</p>
          {person.sOnCOn && (
            <p className="text-xs text-muted-foreground">{person.sOnCOn}</p>
          )}
          <p className="text-[10px] font-mono text-muted-foreground/60">{pid}</p>
        </div>
        <KycBadge status={person.kycStatus} />
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {person.mobile && <span><Phone className="w-3 h-3 inline mr-1" />{person.mobile}</span>}
        {person.aadhaarLast4 && <span><Fingerprint className="w-3 h-3 inline mr-1" />…{person.aadhaarLast4}</span>}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full mt-2 gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        onClick={() => onSelect(person)}
        data-testid={`btn-use-existing-${person.id}`}
      >
        <UserCheck className="w-3 h-3" /> Use this identity
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function PersonRegistry() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [listSearch, setListSearch] = useState("");
  const debouncedListSearch = useDebounce(listSearch, 400);

  const { data: persons = [], isLoading } = useListPersonMaster(
    debouncedListSearch
      ? { q: debouncedListSearch }
      : {},
  );

  const createPerson = useCreatePersonMaster();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizard, setWizard] = useState<WizardState>({
    step: "search",
    searchQuery: "",
    searchAadhaar: "",
    searchMobile: "",
    matches: [],
  });

  const canSearch =
    wizard.searchQuery.length >= 2 ||
    wizard.searchAadhaar.length >= 4 ||
    wizard.searchMobile.length >= 6;

  const wizardSearchParams: ListPersonMasterParams = canSearch
    ? {
        q: wizard.searchQuery || undefined,
        aadhaar: wizard.searchAadhaar || undefined,
        mobile: wizard.searchMobile || undefined,
      }
    : {};

  const { data: searchResults = [], isLoading: searchLoading } = useListPersonMaster(
    wizardSearchParams,
    {
      query: {
        queryKey: getListPersonMasterQueryKey(wizardSearchParams),
        enabled: wizardOpen && wizard.step === "search" && canSearch,
      },
    },
  );

  const form = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      fullName: wizard.searchQuery,
      sOnCOn: "",
      fatherGuardianName: "",
      dateOfBirth: "",
      aadhaarNumber: wizard.searchAadhaar.replace(/\D/g, "").slice(0, 12),
      mobile: wizard.searchMobile,
      email: "",
      village: "",
      district: "",
      state: "",
      remarks: "",
    },
  });

  const openWizard = useCallback(() => {
    setWizard({ step: "search", searchQuery: "", searchAadhaar: "", searchMobile: "", matches: [] });
    form.reset({
      fullName: "", sOnCOn: "", fatherGuardianName: "", dateOfBirth: "",
      aadhaarNumber: "", mobile: "", email: "", village: "", district: "", state: "", remarks: "",
    });
    setWizardOpen(true);
  }, [form]);

  const goToResults = () => {
    setWizard((w) => ({ ...w, step: "results", matches: searchResults }));
  };

  const goToCreate = () => {
    form.reset({
      fullName: wizard.searchQuery,
      sOnCOn: "",
      fatherGuardianName: "",
      dateOfBirth: "",
      aadhaarNumber: wizard.searchAadhaar.replace(/\D/g, "").slice(0, 12),
      mobile: wizard.searchMobile,
      email: "",
      village: "",
      district: "",
      state: "",
      remarks: "",
    });
    setWizard((w) => ({ ...w, step: "create" }));
  };

  const handleExistingSelected = (person: PersonMasterSummary) => {
    setWizardOpen(false);
    toast({
      title: "Identity linked",
      description: `Selected existing record: ${person.fullName}`,
    });
  };

  function onSubmitCreate(values: CreateFormValues) {
    const payload = {
      ...values,
      aadhaarNumber: values.aadhaarNumber || undefined,
      mobile: values.mobile || undefined,
      email: values.email || undefined,
    };
    createPerson.mutate(
      { data: payload as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPersonMasterQueryKey() });
          toast({ title: "Person identity registered", description: `${values.fullName} has been added to the registry.` });
          setWizardOpen(false);
          form.reset();
        },
        onError: (err: any) => {
          const detail = err?.response?.data;
          if (detail?.error === "duplicate_aadhaar" || detail?.error === "duplicate_mobile") {
            toast({
              title: "Duplicate detected",
              description: detail.message,
              variant: "destructive",
            });
          } else {
            toast({ title: "Failed to register person", variant: "destructive" });
          }
        },
      },
    );
  }

  const pendingCount = persons.filter((p) => p.kycStatus === "pending").length;
  const verifiedCount = persons.filter((p) => p.kycStatus === "verified").length;
  const flaggedCount = persons.filter((p) => p.kycStatus === "flagged").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Person Registry
          </h1>
          <p className="text-muted-foreground mt-1">
            Unified identity registry — canonical source for all individuals in the ERP
          </p>
        </div>
        <Button
          onClick={openWizard}
          className="gap-2"
          data-testid="btn-register-person"
        >
          <UserPlus className="w-4 h-4" />
          Register Person
        </Button>
      </div>

      {/* Stat chips */}
      {!isLoading && persons.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold">{persons.length}</span>
            <span className="text-muted-foreground">registered</span>
          </div>
          {verifiedCount > 0 && (
            <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700">
              <ShieldCheck className="w-3 h-3" />
              {verifiedCount} verified
            </Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700">
              <Clock className="w-3 h-3" />
              {pendingCount} pending KYC
            </Badge>
          )}
          {flaggedCount > 0 && (
            <Badge variant="outline" className="gap-1 border-red-300 text-red-700">
              <AlertTriangle className="w-3 h-3" />
              {flaggedCount} flagged
            </Badge>
          )}
        </div>
      )}

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name, Aadhaar, or mobile…"
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
          data-testid="input-registry-search"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : persons.length === 0 ? (
        <Card className="py-20 text-center">
          <UserPlus className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">
            {listSearch
              ? "No persons match your search."
              : "No persons registered yet. Register the first identity to begin."}
          </p>
          {!listSearch && (
            <Button className="mt-4 gap-2" onClick={openWizard}>
              <UserPlus className="w-4 h-4" /> Register First Person
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {persons.map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}

      {/* ── Wizard Dialog ─────────────────────────────────────────────── */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg">
              {wizard.step === "search" && "Search Existing Registry"}
              {wizard.step === "results" && "Identity Matches Found"}
              {wizard.step === "create" && "Register New Person Identity"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Person registration wizard
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            {(["search", "results", "create"] as WizardStep[]).map((s, idx) => (
              <span key={s} className="flex items-center gap-1">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center font-semibold text-[10px] ${
                    wizard.step === s
                      ? "bg-emerald-600 text-white"
                      : idx < ["search", "results", "create"].indexOf(wizard.step)
                      ? "bg-emerald-200 text-emerald-800"
                      : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {idx + 1}
                </span>
                <span className={wizard.step === s ? "text-foreground font-medium" : ""}>
                  {s === "search" ? "Search" : s === "results" ? "Matches" : "Create"}
                </span>
                {idx < 2 && <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
              </span>
            ))}
          </div>

          {/* ── Step 1: Search ── */}
          {wizard.step === "search" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Search the registry first to avoid creating duplicate identities.
                Enter at least one of the fields below.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Full name</label>
                  <Input
                    placeholder="e.g. Ratan Das"
                    value={wizard.searchQuery}
                    onChange={(e) =>
                      setWizard((w) => ({ ...w, searchQuery: e.target.value }))
                    }
                    data-testid="wizard-search-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Aadhaar number</label>
                  <Input
                    placeholder="12-digit Aadhaar"
                    maxLength={12}
                    value={wizard.searchAadhaar}
                    onChange={(e) =>
                      setWizard((w) => ({
                        ...w,
                        searchAadhaar: e.target.value.replace(/\D/g, ""),
                      }))
                    }
                    data-testid="wizard-search-aadhaar"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Mobile number</label>
                  <Input
                    placeholder="10-digit mobile"
                    value={wizard.searchMobile}
                    onChange={(e) =>
                      setWizard((w) => ({ ...w, searchMobile: e.target.value }))
                    }
                    data-testid="wizard-search-mobile"
                  />
                </div>
              </div>

              {canSearch && (
                <div className="border rounded-lg p-3 bg-muted/20">
                  {searchLoading ? (
                    <p className="text-xs text-muted-foreground animate-pulse">Searching registry…</p>
                  ) : searchResults.length > 0 ? (
                    <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {searchResults.length} possible match{searchResults.length !== 1 ? "es" : ""} found — review before creating
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      No matches found — safe to create a new identity
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setWizardOpen(false)}>
                  Cancel
                </Button>
                {canSearch && searchResults.length > 0 ? (
                  <Button onClick={goToResults} data-testid="btn-view-matches">
                    Review Matches
                  </Button>
                ) : (
                  <Button
                    onClick={goToCreate}
                    disabled={!canSearch && searchResults.length === 0}
                    variant={canSearch ? "default" : "outline"}
                    data-testid="btn-create-new"
                  >
                    {canSearch ? "Create New Identity" : "Skip & Create"}
                  </Button>
                )}
                {!canSearch && (
                  <Button
                    variant="secondary"
                    onClick={goToCreate}
                    data-testid="btn-skip-search"
                  >
                    Skip Search
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Results ── */}
          {wizard.step === "results" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                These identities match your search. Select an existing identity or create a new one if none match.
              </p>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {wizard.matches.map((m) => (
                  <MatchCard key={m.id} person={m} onSelect={handleExistingSelected} />
                ))}
              </div>
              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWizard((w) => ({ ...w, step: "search" }))}
                  className="gap-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Back
                </Button>
                <Button onClick={goToCreate} data-testid="btn-create-anyway">
                  <UserPlus className="w-4 h-4 mr-1" />
                  None match — Create New
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Create ── */}
          {wizard.step === "create" && (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmitCreate)}
                className="space-y-4"
                data-testid="form-create-person"
              >
                <p className="text-xs text-muted-foreground border-l-2 border-emerald-400 pl-2">
                  This creates a permanent identity record. The Aadhaar number is stored encrypted
                  and only the last 4 digits are displayed in the UI.
                </p>

                {/* Name section */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Identity
                  </p>
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name *</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Legal full name"
                            {...field}
                            data-testid="input-person-fullname"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="sOnCOn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>S/O or C/O</FormLabel>
                          <FormControl>
                            <Input placeholder="Son/Daughter/Care of" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="fatherGuardianName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Father / Guardian</FormLabel>
                          <FormControl>
                            <Input placeholder="Father/guardian name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="dateOfBirth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date of Birth</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="gender"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Gender</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Contact & Aadhaar */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Contact & Aadhaar
                  </p>
                  <FormField
                    control={form.control}
                    name="aadhaarNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Aadhaar Number (12 digits)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="XXXXXXXXXXXX"
                            maxLength={12}
                            {...field}
                            data-testid="input-person-aadhaar"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="mobile"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Mobile</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="+91 XXXXX XXXXX"
                              {...field}
                              data-testid="input-person-mobile"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="optional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Address
                  </p>
                  <FormField
                    control={form.control}
                    name="permanentAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Permanent Address</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="House no., street, locality…"
                            className="resize-none"
                            rows={2}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <FormField
                      control={form.control}
                      name="village"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Village</FormLabel>
                          <FormControl>
                            <Input placeholder="Village" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="district"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>District</FormLabel>
                          <FormControl>
                            <Input placeholder="District" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <FormControl>
                            <Input placeholder="State" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Remarks */}
                <FormField
                  control={form.control}
                  name="remarks"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Remarks</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Any additional notes…"
                          className="resize-none"
                          rows={2}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-between gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setWizard((w) => ({
                        ...w,
                        step: w.matches.length > 0 ? "results" : "search",
                      }))
                    }
                    className="gap-1"
                  >
                    <ArrowLeft className="w-3 h-3" /> Back
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setWizardOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createPerson.isPending}
                      data-testid="btn-submit-create-person"
                    >
                      {createPerson.isPending ? "Registering…" : "Register Identity"}
                    </Button>
                  </div>
                </div>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
