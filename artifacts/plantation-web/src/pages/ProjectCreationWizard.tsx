import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@clerk/react";
import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProject,
  useUpdateProject,
  useGetProject,
  useUpsertOnboardingParticipant,
  useListOnboardingParticipants,
  useListOnboardingWitnesses,
  useAddOnboardingWitness,
  useUpdateOnboardingWitness,
  useDeleteOnboardingWitness,
  useGetProjectOnboardingState,
  useSendProjectOnboardingOtp,
  useVerifyProjectOnboardingOtp,
  useActivateProjectViaOnboarding,
  useSaveProjectOnboardingStep,
  getListProjectsQueryKey,
  getListOnboardingParticipantsQueryKey,
  useListProjectParcels,
  useCreateProjectParcel,
  useUpdateProjectParcel,
  useDeleteProjectParcel,
  getListProjectParcelsQueryKey,
  useGetProjectAgreementTemplate,
  useSetProjectAgreementTemplate,
  useListTemplates,
  getGetProjectAgreementTemplateQueryKey,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, AlertCircle, ChevronRight, ChevronLeft,
  Plus, Trash2, Users, MapPin, Leaf, FileText, Shield, KeyRound, Eye, Loader2,
  Banknote, Info, Gavel, BookOpen, AlertTriangle, TreePine, Calculator, Scale,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PersonMasterSelector, type PersonSummary } from "@/components/PersonMasterSelector";

// ── Wizard steps (Prompt 6 refactor) ─────────────────────────────────────────
// 8 steps: Project Details → Participants → Commercial Terms → Schedule A →
//          Witnesses → Agreement → Project Type → Review & Submit
const STEPS = [
  { id: 1, label: "Project Details", icon: FileText },
  { id: 2, label: "Participants", icon: Users },
  { id: 3, label: "Commercial Terms", icon: Banknote },
  { id: 4, label: "Schedule A (Parcels)", icon: MapPin },
  { id: 5, label: "Witnesses", icon: Users },
  { id: 6, label: "Agreement Template", icon: BookOpen },
  { id: 7, label: "Project Type", icon: Gavel },
  { id: 8, label: "Review & Submit", icon: CheckCircle2 },
];

// ── Step 1: Project Basics ────────────────────────────────────────────────────

const step1Schema = z.object({
  name: z.string().min(2, "Project name required"),
  commercialModel: z.enum(["ownership_contribution", "fifty_percent_revenue"]),
  location: z.string().min(2, "Location required"),
  village: z.string().optional(),
  district: z.string().min(2, "District required"),
  state: z.string().min(2, "State required"),
  startDate: z.string().min(1, "Start date required"),
  termYears: z.coerce.number().int().positive().default(35),
  notes: z.string().optional(),
});

type Step1Values = z.infer<typeof step1Schema>;

function Step1BasicInfo({ onNext }: { onNext: (projectId: string) => void }) {
  const createProject = useCreateProject();
  const { toast } = useToast();

  const form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      name: "",
      commercialModel: "ownership_contribution",
      location: "",
      village: "",
      district: "",
      state: "Tripura",
      startDate: "",
      termYears: 35,
      notes: "",
    },
  });

  const onSubmit = (values: Step1Values) => {
    createProject.mutate(
      {
        data: {
          ...values,
          status: "planning",
          activationStatus: "draft",
          landArea: 0,
          landAreaUnit: "kani",
          onboardingStep: 1,
        } as any,
      },
      {
        onSuccess: (data: any) => {
          const projectId = data?.id ?? data?.project?.id;
          if (projectId) onNext(projectId);
        },
        onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Project Name *</FormLabel>
              <FormControl><Input placeholder="e.g. HP Rubber Project – Agartala Block A" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="commercialModel" render={({ field }) => (
            <FormItem>
              <FormLabel>Commercial Model *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="ownership_contribution">Ownership Contribution</SelectItem>
                  <SelectItem value="fifty_percent_revenue">50% Revenue Split</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="location" render={({ field }) => (
            <FormItem>
              <FormLabel>Location *</FormLabel>
              <FormControl><Input placeholder="General area/locality" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="village" render={({ field }) => (
            <FormItem>
              <FormLabel>Village</FormLabel>
              <FormControl><Input placeholder="Village name" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="district" render={({ field }) => (
            <FormItem>
              <FormLabel>District *</FormLabel>
              <FormControl><Input placeholder="e.g. West Tripura" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="state" render={({ field }) => (
            <FormItem>
              <FormLabel>State *</FormLabel>
              <FormControl><Input placeholder="Tripura" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="startDate" render={({ field }) => (
            <FormItem>
              <FormLabel>Start Date *</FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="termYears" render={({ field }) => (
            <FormItem>
              <FormLabel>Term (Years) *</FormLabel>
              <FormControl><Input type="number" min={1} max={99} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="notes" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Notes</FormLabel>
              <FormControl><Textarea rows={3} placeholder="Optional project notes..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={createProject.isPending}>
            {createProject.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Create Project & Continue
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Participant KYC Steps (2 & 3) ─────────────────────────────────────────────

const participantSchema = z.object({
  fullName: z.string().min(2, "Full name required"),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().optional(),
  aadhaarNumber: z.string().optional(),
  mobile: z.string().min(10, "Valid mobile required"),
  address: z.string().min(5, "Address required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

type ParticipantValues = z.infer<typeof participantSchema>;

function StepParticipantKYC({
  projectId,
  role,
  roleLabel,
  onNext,
  onBack,
}: {
  projectId: string;
  role: "developer" | "landowner";
  roleLabel: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: existingData } = useListOnboardingParticipants(projectId);
  const upsertParticipant = useUpsertOnboardingParticipant();
  const { toast } = useToast();

  const existing = existingData?.participants?.find((p) => p.role === role);
  const existingId = existing?.id;

  const [selectedPerson, setSelectedPerson] = useState<PersonSummary | null>(null);

  const form = useForm<ParticipantValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: {
      fullName: "",
      sOnCOn: "S/O",
      fatherGuardianName: "",
      aadhaarNumber: "",
      mobile: "",
      address: "",
      email: "",
    },
  });

  useEffect(() => {
    if (existing) {
      form.reset({
        fullName: existing.fullName ?? "",
        sOnCOn: existing.sOnCOn ?? "S/O",
        fatherGuardianName: (existing as any).fatherGuardianName ?? "",
        aadhaarNumber: existing.aadhaarNumber ?? "",
        mobile: existing.mobile ?? "",
        address: existing.address ?? "",
        email: existing.email ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingId]);

  const handlePersonSelect = (person: PersonSummary | null) => {
    setSelectedPerson(person);
    if (person) {
      form.reset({
        fullName: person.fullName ?? "",
        sOnCOn: person.sOnCOn ?? "S/O",
        fatherGuardianName: person.fatherGuardianName ?? "",
        aadhaarNumber: "",
        mobile: person.mobile ?? "",
        address: "",
        email: person.email ?? "",
      });
    }
  };

  const onSubmit = (values: ParticipantValues) => {
    const linkedPersonMasterId =
      selectedPerson?.id ?? (existing as any)?.personMasterId ?? undefined;
    upsertParticipant.mutate(
      {
        projectId,
        role,
        data: { ...values, personMasterId: linkedPersonMasterId } as any,
      },
      {
        onSuccess: async () => {
          await qc.refetchQueries({
            queryKey: getListOnboardingParticipantsQueryKey(projectId),
          });
          onNext();
        },
        onError: () =>
          toast({ title: `Failed to save ${roleLabel} details`, variant: "destructive" }),
      },
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Search the Person Registry and select the <strong>{roleLabel}</strong>, or register a new
          person. All participants must be linked to the central registry.
        </p>

        <PersonMasterSelector
          label={`${roleLabel} — Person Registry`}
          selectedPerson={selectedPerson}
          onSelect={handlePersonSelect}
        />

        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-dashed" />
          <span className="text-xs text-muted-foreground shrink-0">
            {selectedPerson
              ? "Auto-filled from registry — review & adjust below"
              : "Fill in details manually if not linking from registry"}
          </span>
          <div className="flex-1 border-t border-dashed" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="fullName" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Full Legal Name *</FormLabel>
              <FormControl>
                <Input placeholder={`${roleLabel}'s full name as per Aadhaar`} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="sOnCOn" render={({ field }) => (
            <FormItem>
              <FormLabel>Relation Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? "S/O"}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Select relation" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="S/O">S/O — Son of</SelectItem>
                  <SelectItem value="D/O">D/O — Daughter of</SelectItem>
                  <SelectItem value="W/O">W/O — Wife of</SelectItem>
                  <SelectItem value="C/O">C/O — Care of</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="fatherGuardianName" render={({ field }) => (
            <FormItem>
              <FormLabel>Father / Guardian Name</FormLabel>
              <FormControl>
                <Input placeholder="Father or guardian's name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="aadhaarNumber" render={({ field }) => (
            <FormItem>
              <FormLabel>Aadhaar Number</FormLabel>
              <FormControl>
                <Input placeholder="12-digit Aadhaar" maxLength={12} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="mobile" render={({ field }) => (
            <FormItem>
              <FormLabel>Mobile Number *</FormLabel>
              <FormControl>
                <Input placeholder="10-digit mobile" maxLength={10} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="Optional email address" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="address" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Full Address *</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  placeholder="Complete permanent address with PIN"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button type="submit" disabled={upsertParticipant.isPending}>
            {upsertParticipant.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Step 4: Land Details ──────────────────────────────────────────────────────

const landSchema = z.object({
  landType: z.enum(["recorded", "non_recorded"]),
  landArea: z.coerce.number().positive("Area must be positive"),
  landAreaUnit: z.string().min(1),
  landBoundaryDescription: z.string().optional(),
  gpsCoordinates: z.string().optional(),
  // Recorded
  khatianNumber: z.string().optional(),
  plotNumber: z.string().optional(),
  mouja: z.string().optional(),
  tahsil: z.string().optional(),
  revenueCircle: z.string().optional(),
  subDivision: z.string().optional(),
  // Non-recorded
  landAreaName: z.string().optional(),
  postOffice: z.string().optional(),
  policeStation: z.string().optional(),
});

type LandValues = z.infer<typeof landSchema>;

function Step4LandDetails({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: projectData } = useGetProject(projectId);
  const updateProject = useUpdateProject();
  const { toast } = useToast();

  const project = projectData as any;

  const form = useForm<LandValues>({
    resolver: zodResolver(landSchema),
    defaultValues: {
      landType: "recorded",
      landArea: 0,
      landAreaUnit: "kani",
      landBoundaryDescription: "",
      gpsCoordinates: "",
      khatianNumber: "",
      plotNumber: "",
      mouja: "",
      tahsil: "",
      revenueCircle: "",
      subDivision: "",
      landAreaName: "",
      postOffice: "",
      policeStation: "",
    },
  });

  // Populate form once project data loads
  useEffect(() => {
    if (project) {
      form.reset({
        landType: (project.landType as "recorded" | "non_recorded") ?? "recorded",
        landArea: project.landArea ?? 0,
        landAreaUnit: project.landAreaUnit ?? "kani",
        landBoundaryDescription: project.landBoundaryDescription ?? "",
        gpsCoordinates: project.gpsCoordinates ?? "",
        khatianNumber: project.khatianNumber ?? "",
        plotNumber: project.plotNumber ?? "",
        mouja: project.mouja ?? "",
        tahsil: project.tahsil ?? "",
        revenueCircle: project.revenueCircle ?? "",
        subDivision: project.subDivision ?? "",
        landAreaName: project.landAreaName ?? "",
        postOffice: project.postOffice ?? "",
        policeStation: project.policeStation ?? "",
      });
    }
  }, [project?.id]);

  const landType = form.watch("landType");

  const onSubmit = (values: LandValues) => {
    updateProject.mutate(
      { id: projectId, data: values as any },
      {
        onSuccess: onNext,
        onError: () => toast({ title: "Failed to save land details", variant: "destructive" }),
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="landType" render={({ field }) => (
            <FormItem>
              <FormLabel>Land Record Type *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="recorded">Recorded (Khatian / Patta)</SelectItem>
                  <SelectItem value="non_recorded">Non-Recorded (Unregistered)</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <div className="grid grid-cols-2 gap-2">
            <FormField control={form.control} name="landArea" render={({ field }) => (
              <FormItem>
                <FormLabel>Land Area *</FormLabel>
                <FormControl><Input type="number" step="0.01" min="0" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="landAreaUnit" render={({ field }) => (
              <FormItem>
                <FormLabel>Unit *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="kani">Kani</SelectItem>
                    <SelectItem value="acre">Acre</SelectItem>
                    <SelectItem value="hectare">Hectare</SelectItem>
                    <SelectItem value="bigha">Bigha</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          {landType === "recorded" && (
            <>
              <FormField control={form.control} name="khatianNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Khatian Number</FormLabel>
                  <FormControl><Input placeholder="e.g. K-1234" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="plotNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plot / Dag Number</FormLabel>
                  <FormControl><Input placeholder="e.g. 245/A" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mouja" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mouja / Mouza</FormLabel>
                  <FormControl><Input placeholder="Revenue village unit" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="tahsil" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tehsil / Taluk</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="revenueCircle" render={({ field }) => (
                <FormItem>
                  <FormLabel>Revenue Circle</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="subDivision" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub-Division</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </>
          )}

          {landType === "non_recorded" && (
            <>
              <FormField control={form.control} name="landAreaName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Local Name of Land</FormLabel>
                  <FormControl><Input placeholder="Locally known name or area description" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="postOffice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Post Office</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="policeStation" render={({ field }) => (
                <FormItem>
                  <FormLabel>Police Station</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="subDivision" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub-Division</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </>
          )}

          <FormField control={form.control} name="gpsCoordinates" render={({ field }) => (
            <FormItem>
              <FormLabel>GPS Coordinates</FormLabel>
              <FormControl><Input placeholder="e.g. 23.8315° N, 91.2868° E" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="landBoundaryDescription" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Land Boundary Description</FormLabel>
              <FormControl><Textarea rows={2} placeholder="Describe boundaries: North – road, South – canal..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button type="submit" disabled={updateProject.isPending}>
            {updateProject.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Step 5: Capacity & Financial Config ───────────────────────────────────────

const financialSchema = z.object({
  rubberCapacity: z.coerce.number().int().positive("Must be a positive number"),
  rubberCapacityUnit: z.string().default("trees"),
  valuationMethod: z.enum(["by_tree_capacity", "by_land_area_kani", "manual"]).default("manual"),
  perTreeValue: z.coerce.number().min(0).optional(),
  landValuePerUnit: z.coerce.number().min(0).optional(),
  landNotionalValue: z.coerce.number().min(0).optional(),
  landNotionalValueRemarks: z.string().optional(),
  lcaBaseAmount: z.coerce.number().optional(),
  lcaEscalationPct: z.coerce.number().optional(),
});

type FinancialValues = z.infer<typeof financialSchema>;

function Step5CapacityFinancial({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: projectData } = useGetProject(projectId);
  const updateProject = useUpdateProject();
  const { toast } = useToast();
  const [lnvConfirmed, setLnvConfirmed] = useState(false);
  const project = projectData as any;
  const isOwnershipModel = project?.commercialModel === "ownership_contribution";
  const landArea = parseFloat(String(project?.landArea ?? "0")) || 0;
  const landAreaUnit = project?.landAreaUnit ?? "kani";

  const form = useForm<FinancialValues>({
    resolver: zodResolver(financialSchema),
    defaultValues: {
      rubberCapacity: 0,
      rubberCapacityUnit: "trees",
      valuationMethod: "manual",
      perTreeValue: 0,
      landValuePerUnit: 0,
      landNotionalValue: 0,
      landNotionalValueRemarks: "",
      lcaBaseAmount: 0,
      lcaEscalationPct: 0,
    },
  });

  const { watch, setValue } = form;
  const valuationMethod = watch("valuationMethod");
  const rubberCapacity = watch("rubberCapacity");
  const perTreeValue = watch("perTreeValue");
  const landValuePerUnit = watch("landValuePerUnit");

  useEffect(() => {
    if (project) {
      form.reset({
        rubberCapacity: project.rubberCapacity ?? 0,
        rubberCapacityUnit: project.rubberCapacityUnit ?? "trees",
        valuationMethod: (project.valuationMethod as any) ?? "manual",
        perTreeValue: project.perTreeValue ?? 0,
        landValuePerUnit: project.landValuePerUnit ?? 0,
        landNotionalValue: project.landNotionalValue ?? 0,
        landNotionalValueRemarks: project.landNotionalValueRemarks ?? "",
        lcaBaseAmount: project.lcaBaseAmount ? Number(project.lcaBaseAmount) : 0,
        lcaEscalationPct: project.lcaEscalationPct ? Number(project.lcaEscalationPct) : 0,
      });
    }
  }, [project?.id]);

  const computedLNV = useMemo(() => {
    const cap = parseFloat(String(rubberCapacity)) || 0;
    const ptv = parseFloat(String(perTreeValue)) || 0;
    const pku = parseFloat(String(landValuePerUnit)) || 0;
    if (valuationMethod === "by_tree_capacity") return cap * ptv;
    if (valuationMethod === "by_land_area_kani") return landArea * pku;
    return null;
  }, [valuationMethod, rubberCapacity, perTreeValue, landValuePerUnit, landArea]);

  useEffect(() => {
    if (computedLNV !== null) {
      setValue("landNotionalValue", parseFloat(computedLNV.toFixed(2)));
    }
  }, [computedLNV, setValue]);

  const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const onSubmit = (values: FinancialValues) => {
    if (!lnvConfirmed) {
      toast({ title: "Governance acknowledgment required", description: "Please confirm the Land Notional Value declaration before proceeding.", variant: "destructive" });
      return;
    }
    updateProject.mutate(
      {
        id: projectId,
        data: {
          rubberCapacity: values.rubberCapacity,
          rubberCapacityUnit: values.rubberCapacityUnit,
          valuationMethod: values.valuationMethod,
          perTreeValue: values.perTreeValue,
          landValuePerUnit: values.landValuePerUnit,
          landNotionalValue: values.landNotionalValue,
          landNotionalValueRemarks: values.landNotionalValueRemarks || undefined,
          lcaBaseAmount: values.lcaBaseAmount !== undefined ? String(values.lcaBaseAmount) : undefined,
          lcaEscalationPct: values.lcaEscalationPct !== undefined ? String(values.lcaEscalationPct) : undefined,
        } as any,
      },
      {
        onSuccess: onNext,
        onError: () => toast({ title: "Failed to save configuration", variant: "destructive" }),
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

        {/* ════ Page-level governance header ════════════════════════ */}
        <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-500/15 border border-amber-400/40 rounded-lg shrink-0">
              <Gavel className="w-5 h-5 text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <p className="text-sm font-bold text-amber-900">Economic Foundation — Governance Configuration</p>
                <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-[10px] px-1.5 py-0">Step 5 of 10</Badge>
              </div>
              <p className="text-xs text-amber-800/90 leading-relaxed">
                This step defines the <strong>economic and legal foundation</strong> of the plantation partnership — land participation value, ownership basis, LCA structure, and commercial governance. These are not accounting form fields. They are <strong>deed-linked governance declarations</strong> that form the basis of ownership equity, contribution proportions, and maturity economics.
              </p>
            </div>
          </div>
        </div>

        {/* ════ CARD A — Plantation Capacity ════════════════════════ */}
        <Card className="border-emerald-200 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b border-emerald-200 py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-900">
                <TreePine className="w-4 h-4 text-emerald-600" />
                Plantation Capacity
              </CardTitle>
              <div className="flex gap-1.5">
                <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-[10px]">Required</Badge>
                <Badge variant="outline" className="text-slate-500 border-slate-300 text-[10px]">Feeds Valuation</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-5 px-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="rubberCapacity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rubber Tree Capacity *</FormLabel>
                  <FormControl>
                    <Input type="number" min="1" placeholder="e.g. 1200" className="bg-white" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground mt-1">Planted trees; used in tree-capacity valuation</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="rubberCapacityUnit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Capacity Unit</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "trees"}>
                    <FormControl><SelectTrigger className="bg-white"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="trees">Trees</SelectItem>
                      <SelectItem value="hectares">Hectares</SelectItem>
                      <SelectItem value="acres">Acres</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Land area read-back from Step 4 */}
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
              <div>
                <p className="text-xs text-emerald-700 font-medium">Land Area — from Step 4</p>
                {landArea > 0
                  ? <p className="text-base font-bold text-emerald-900 mt-0.5">{landArea.toLocaleString("en-IN")} {landAreaUnit}</p>
                  : <p className="text-xs text-amber-700 mt-0.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Not set — complete Step 4 first</p>
                }
              </div>
              <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px] shrink-0">Auto-linked</Badge>
            </div>
          </CardContent>
        </Card>

        {/* ════ CARD B — Land Notional Value Governance ═════════════ */}
        <Card className="border-amber-300 shadow-md">
          <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 py-3 px-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-amber-900">
                <Scale className="w-4 h-4 text-amber-600" />
                Land Notional Value Declaration
              </CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge className="bg-amber-600 hover:bg-amber-600 text-white text-[10px] px-1.5">Governance Declaration</Badge>
                {isOwnershipModel
                  ? <Badge className="bg-green-600 hover:bg-green-600 text-white text-[10px] px-1.5">Ownership Foundation</Badge>
                  : <Badge variant="outline" className="text-slate-500 border-slate-300 text-[10px]">Inactive · 50% Model</Badge>
                }
                <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">Audit Logged</Badge>
                <Badge variant="outline" className="text-red-600 border-red-300 text-[10px]">Locked After Activation</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 pb-5 px-4 space-y-5">

            {/* What is LNV — explanation panel */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">What is Land Notional Value?</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 pl-1">
                {[
                  ["Non-cash recognition", "Land's economic contribution — no money changes hands"],
                  ["Fixed & foundational", "Does not escalate automatically with inflation or time"],
                  ["Pre-maturity requirement", "Must be recorded before Mature Production lifecycle stage"],
                  ["Separate from operations", "Distinct from expenses, advances, and recoverable items"],
                  ["Deed-linked", "Referenced in deed generation and agreement structure"],
                  ["LCA basis", "Becomes the base for Land Contribution Adjustment calculations"],
                  ["Ownership equity", "Determines contribution proportions and partner equity"],
                  ["Audit trail", "Permanently recorded in governance and agreement snapshots"],
                ].map(([title, desc], i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <p className="text-xs text-slate-600 leading-relaxed"><span className="font-medium text-slate-700">{title}:</span> {desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Model-aware status */}
            {isOwnershipModel ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-green-900">Active — Ownership Contribution Model</p>
                  <p className="text-xs text-green-700 mt-0.5 leading-relaxed">This LNV directly determines ownership equity, LCA calculations, contribution proportions, and all deed parameters. It becomes a legally binding governance commitment upon project activation.</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-slate-300 bg-slate-50 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 border-b border-slate-300">
                  <Info className="w-4 h-4 text-slate-500 shrink-0" />
                  <p className="text-sm font-bold text-slate-700">Governance Status — 50% Revenue Split Model</p>
                  <Badge variant="outline" className="ml-auto text-slate-500 border-slate-400 text-[10px] shrink-0">Inactive · Not Nonexistent</Badge>
                </div>
                {/* Two-column body */}
                <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                  {/* Preserved for */}
                  <div className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">LNV Is Preserved For</p>
                    </div>
                    {[
                      "Governance continuity and audit trail",
                      "Legal reference and land participation recognition",
                      "Deed generation and agreement structure",
                      "Future commercial model migration",
                      "Long-term audit traceability",
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <p className="text-xs text-slate-600 leading-relaxed">{item}</p>
                      </div>
                    ))}
                  </div>
                  {/* Inactive for */}
                  <div className="px-4 py-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Circle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">LNV Is Currently Inactive For</p>
                    </div>
                    {[
                      "Ownership equity and crystallisation",
                      "LCA (Land Contribution Adjustment) generation",
                      "Contribution proportion calculations",
                      "Partner equity accounting",
                      "Ownership-based deed parameters",
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                        <p className="text-xs text-slate-400 leading-relaxed line-through decoration-slate-300">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Footer note */}
                <div className="px-4 py-2 bg-amber-50 border-t border-slate-200">
                  <p className="text-xs text-amber-700 leading-relaxed">
                    <strong>Entry is still required.</strong> If this project migrates to the Ownership Contribution model, this LNV will automatically activate for all ownership calculations without re-entry.
                  </p>
                </div>
              </div>
            )}

            {/* ── Valuation Method TABS ─────────────────────────────── */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Calculator className="w-3.5 h-3.5 text-amber-600" />
                  <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Valuation Method & Calculation</p>
                </div>
                {!isOwnershipModel && (
                  <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-full px-2.5 py-1">
                    <Circle className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                    <span className="text-[10px] text-slate-500 font-medium">Recorded for governance — inactive for ownership calculations</span>
                  </div>
                )}
              </div>

              {/* 50% model formula-visibility notice */}
              {!isOwnershipModel && (
                <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 mb-3">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    The valuation formula and result below are <strong>recorded in full</strong> for governance continuity, audit reference, and future migration. They are <strong>not used</strong> in ownership calculations, LCA generation, or equity accounting under the current 50% Revenue Split model.
                  </p>
                </div>
              )}
              <Tabs
                value={valuationMethod}
                onValueChange={(v) => form.setValue("valuationMethod", v as "by_tree_capacity" | "by_land_area_kani" | "manual")}
              >
                <TabsList className="w-full h-auto grid grid-cols-3 bg-amber-100/70 p-1 rounded-lg">
                  <TabsTrigger value="by_tree_capacity" className="flex flex-col items-center gap-0.5 py-2 text-[11px] data-[state=active]:bg-white data-[state=active]:text-amber-900 data-[state=active]:shadow-sm rounded-md">
                    <TreePine className="w-3.5 h-3.5" />
                    <span className="font-medium">By Tree Capacity</span>
                    <span className="text-[10px] text-muted-foreground hidden sm:block">Trees × Rate</span>
                  </TabsTrigger>
                  <TabsTrigger value="by_land_area_kani" className="flex flex-col items-center gap-0.5 py-2 text-[11px] data-[state=active]:bg-white data-[state=active]:text-amber-900 data-[state=active]:shadow-sm rounded-md">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="font-medium">By Land Area</span>
                    <span className="text-[10px] text-muted-foreground hidden sm:block">{landAreaUnit} × Rate</span>
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="flex flex-col items-center gap-0.5 py-2 text-[11px] data-[state=active]:bg-white data-[state=active]:text-amber-900 data-[state=active]:shadow-sm rounded-md">
                    <FileText className="w-3.5 h-3.5" />
                    <span className="font-medium">Manual / Report</span>
                    <span className="text-[10px] text-muted-foreground hidden sm:block">Direct Entry</span>
                  </TabsTrigger>
                </TabsList>

                {/* ── Tab: By Tree Capacity ── */}
                <TabsContent value="by_tree_capacity" className="mt-4 space-y-4">
                  <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                    <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 leading-relaxed">Use this method when the plantation tree count is well-established and a per-tree market value is available. Best for projects with precise rubber tree census or nursery planting records.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-col justify-center">
                      <p className="text-[10px] text-amber-700 uppercase tracking-wide font-medium">Rubber Trees (auto-linked)</p>
                      <p className="text-2xl font-bold text-amber-900 mt-1">{Number(rubberCapacity || 0).toLocaleString("en-IN")}</p>
                      <p className="text-[10px] text-amber-600 mt-0.5">trees from capacity field above</p>
                    </div>
                    <FormField control={form.control} name="perTreeValue" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Value per Tree (₹) *</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" placeholder="e.g. 5,000" className="bg-white" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground mt-1">Market or assessed rate per rubber tree</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  {/* Live calculation result */}
                  <div className={`rounded-xl border-2 p-4 transition-all ${computedLNV && computedLNV > 0 ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                    <p className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-3">Live Valuation Result</p>
                    <div className="flex items-end justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-slate-700">{Number(rubberCapacity || 0).toLocaleString("en-IN")} trees</span>
                          <span className="text-slate-400">×</span>
                          <span className="font-semibold text-slate-700">{fmtINR(parseFloat(String(perTreeValue || 0)))}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">per tree</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-amber-700 font-medium mb-0.5">= Land Notional Value</p>
                        <p className={`text-2xl font-bold ${computedLNV && computedLNV > 0 ? "text-amber-900" : "text-slate-400"}`}>
                          {computedLNV !== null ? fmtINR(computedLNV) : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ── Tab: By Land Area ── */}
                <TabsContent value="by_land_area_kani" className="mt-4 space-y-4">
                  <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                    <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 leading-relaxed">Use this method when exact land area is available from survey or registry records. The per-{landAreaUnit} value should reflect prevailing local agricultural or plantation land rates at the time of project formation.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex flex-col justify-center">
                      <p className="text-[10px] text-amber-700 uppercase tracking-wide font-medium">Land Area (from Step 4)</p>
                      {landArea > 0
                        ? <>
                            <p className="text-2xl font-bold text-amber-900 mt-1">{landArea.toLocaleString("en-IN")}</p>
                            <p className="text-[10px] text-amber-600 mt-0.5">{landAreaUnit} — auto-linked</p>
                          </>
                        : <p className="text-xs text-destructive mt-1 flex items-center gap-1 font-medium"><AlertTriangle className="w-3 h-3" /> Not set in Step 4</p>
                      }
                    </div>
                    <FormField control={form.control} name="landValuePerUnit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Value per {landAreaUnit} (₹) *</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" placeholder="e.g. 25,000" className="bg-white" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground mt-1">Local plantation land rate per {landAreaUnit}</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  {/* Live calculation result */}
                  <div className={`rounded-xl border-2 p-4 transition-all ${computedLNV && computedLNV > 0 ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
                    <p className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-3">Live Valuation Result</p>
                    <div className="flex items-end justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-slate-700">{landArea.toLocaleString("en-IN")} {landAreaUnit}</span>
                          <span className="text-slate-400">×</span>
                          <span className="font-semibold text-slate-700">{fmtINR(parseFloat(String(landValuePerUnit || 0)))}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">per {landAreaUnit}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-amber-700 font-medium mb-0.5">= Land Notional Value</p>
                        <p className={`text-2xl font-bold ${computedLNV && computedLNV > 0 ? "text-amber-900" : "text-slate-400"}`}>
                          {computedLNV !== null ? fmtINR(computedLNV) : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ── Tab: Manual Entry ── */}
                <TabsContent value="manual" className="mt-4 space-y-4">
                  <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                    <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 leading-relaxed">Use this method when a certified valuation report, deed-referenced amount, or prior assessment is available. Enter the total assessed value directly and reference the source document in the Remarks field below.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="landNotionalValue" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Land Notional Value (₹) *</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" placeholder="Total assessed value in INR" className="bg-white text-base font-semibold" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground mt-1">From valuation report, deed, or prior assessment</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="landValuePerUnit" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Implied Rate per {landAreaUnit} (₹)</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" placeholder={`Per ${landAreaUnit} — optional`} className="bg-white" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground mt-1">For reference and cross-verification</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  {/* Manual value display */}
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                    <p className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-1">Declared Land Notional Value</p>
                    <p className="text-2xl font-bold text-amber-900">
                      {watch("landNotionalValue") && Number(watch("landNotionalValue")) > 0
                        ? fmtINR(Number(watch("landNotionalValue")))
                        : <span className="text-slate-400 text-lg">Enter value above</span>
                      }
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Hidden sync field for non-manual methods */}
              {valuationMethod !== "manual" && (
                <FormField control={form.control} name="landNotionalValue" render={({ field }) => (
                  <FormItem className="hidden">
                    <FormControl><input type="hidden" {...field} /></FormControl>
                  </FormItem>
                )} />
              )}
            </div>

            {/* ── Valuation Remarks & Reference ─────────────────────── */}
            <div className="space-y-2">
              <FormField control={form.control} name="landNotionalValueRemarks" render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    Valuation Remarks & Legal Reference
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter deed clause reference, survey number, market assessment basis, valuation reasoning, assessor name, or any governance notes that should be permanently recorded with this declaration..."
                      rows={4}
                      className="bg-white resize-none"
                      {...field}
                    />
                  </FormControl>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                    {["Deed Clause ref.", "Survey No.", "Kani rate & source", "Valuation report date", "Assessor / authority"].map(ex => (
                      <span key={ex} className="text-[10px] text-muted-foreground font-medium">· {ex}</span>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* ── Governance Acknowledgment ─────────────────────────── */}
            <div className={`rounded-xl border-2 p-4 transition-all duration-200 ${lnvConfirmed ? "border-green-400 bg-green-50" : "border-amber-400 bg-amber-50"}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="lnv-confirm"
                  checked={lnvConfirmed}
                  onCheckedChange={(v) => setLnvConfirmed(!!v)}
                  className="mt-1 shrink-0 border-amber-400 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                />
                <label htmlFor="lnv-confirm" className="cursor-pointer select-none flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {lnvConfirmed
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    }
                    <p className="text-sm font-bold text-slate-800">
                      Governance Acknowledgment <span className="text-destructive">*</span>
                    </p>
                    {lnvConfirmed && <Badge className="bg-green-600 hover:bg-green-600 text-white text-[10px]">Confirmed</Badge>}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    I confirm that the Land Notional Value entered above represents a <strong>fixed, non-cash recognition</strong> of the land's economic participation in this plantation partnership. I confirm this value is <strong>entirely separate</strong> from operational expenses, advance payments, reimbursables, and recoverable items. I understand this declaration will be <strong>linked to deed generation, ownership equity, governance records, and audit logs</strong>, and cannot be amended on an active project without a governance override.
                  </p>
                </label>
              </div>
              {!lnvConfirmed && (
                <p className="text-xs text-amber-700 font-medium mt-2.5 pl-7 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> This acknowledgment is required before you can proceed to the next step.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ════ CARD C — LCA Governance ═════════════════════════════ */}
        <Card className={`shadow-sm ${isOwnershipModel ? "border-purple-200" : "border-slate-200"}`}>
          <CardHeader className={`border-b py-3 px-4 ${isOwnershipModel ? "bg-gradient-to-r from-purple-50 to-violet-50 border-purple-200" : "bg-slate-50 border-slate-200"}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${isOwnershipModel ? "text-purple-900" : "text-slate-600"}`}>
                <Banknote className={`w-4 h-4 ${isOwnershipModel ? "text-purple-600" : "text-slate-400"}`} />
                Land Contribution Adjustment (LCA)
              </CardTitle>
              <div className="flex gap-1.5">
                {isOwnershipModel
                  ? <>
                      <Badge className="bg-purple-600 hover:bg-purple-600 text-white text-[10px]">Active After Maturity</Badge>
                      <Badge variant="outline" className="text-purple-600 border-purple-300 text-[10px]">Ownership Model</Badge>
                    </>
                  : <Badge variant="outline" className="text-slate-400 border-slate-300 text-[10px]">Not Applicable · 50% Model</Badge>
                }
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4 pb-5 px-4 space-y-4">
            {isOwnershipModel ? (
              <>
                {/* LCA explanation */}
                <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-4 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <p className="text-xs font-semibold text-purple-800 uppercase tracking-wide">What is LCA?</p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 pl-1">
                    {[
                      ["Annual adjustment", "Credited yearly to the landowner's contribution account"],
                      ["Sequential escalation", "Year 1 base escalated by the configured % each subsequent year"],
                      ["Carry-forward", "Unpaid LCA balances accumulate — never lost across years"],
                      ["Separate from burden", "Independent from operational expenditure and cost recovery"],
                      ["Ledger credit", "Appears as a credit in the landowner account and affects net position"],
                      ["Config only now", "No LCA entries created until Mature Production is declared"],
                    ].map(([title, desc], i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                        <p className="text-xs text-purple-700 leading-relaxed"><span className="font-medium text-purple-800">{title}:</span> {desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Maturity applicability warning */}
                <div className="flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 px-3.5 py-3">
                  <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-orange-800">Applies Only After Mature Production</p>
                    <p className="text-xs text-orange-700 leading-relaxed mt-0.5">
                      These are <strong>configuration values only</strong> — no LCA entries are generated until this project formally transitions to the Mature Production lifecycle stage. The configured amounts are locked at project activation and require a governance override to amend thereafter.
                    </p>
                  </div>
                </div>

                {/* LCA inputs */}
                <div className="border border-purple-200 bg-purple-50/30 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="lcaBaseAmount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>LCA Base Amount (₹ / year)</FormLabel>
                        <FormControl><Input type="number" step="0.01" placeholder="e.g. 50,000" className="bg-white" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground mt-1">Year-1 annual credit before escalation</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="lcaEscalationPct" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Annual Escalation (%)</FormLabel>
                        <FormControl><Input type="number" step="0.01" min="0" max="100" placeholder="e.g. 5.00" className="bg-white" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground mt-1">Compounding rate per maturity year</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  {/* LCA preview */}
                  {watch("lcaBaseAmount") && Number(watch("lcaBaseAmount")) > 0 && (
                    <div className="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-3">
                      <p className="text-[10px] text-purple-700 font-semibold uppercase tracking-wide mb-2">Escalation Preview</p>
                      <div className="flex gap-4 flex-wrap">
                        {[1, 2, 3, 5].map(yr => {
                          const base = Number(watch("lcaBaseAmount")) || 0;
                          const pct = Number(watch("lcaEscalationPct")) || 0;
                          const val = base * Math.pow(1 + pct / 100, yr - 1);
                          return (
                            <div key={yr} className="text-center">
                              <p className="text-[10px] text-purple-600">Year {yr}</p>
                              <p className="text-xs font-bold text-purple-900">{fmtINR(val)}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-600">LCA Not Applicable — 50% Revenue Split Model</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Land Contribution Adjustment does not apply to this commercial model. Under the Revenue Split arrangement, the landowner's return is governed by the 50/50 revenue split rather than contribution-based equity. LCA will become available only if this project migrates to the Ownership Contribution model under a governance override.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Navigation ─────────────────────────────────────────── */}
        <div className="flex justify-between pt-1">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button type="submit" disabled={updateProject.isPending || !lnvConfirmed} className={lnvConfirmed ? "bg-green-700 hover:bg-green-800" : ""}>
            {updateProject.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Step 6: Agreement Details ──────────────────────────────────────────────────

const agreementSchema = z.object({
  agreementType: z.string().min(1, "Agreement type required"),
  agreementEffectiveDate: z.string().min(1, "Effective date required"),
  agreementDurationYears: z.coerce.number().int().positive(),
  agreementSpecialTerms: z.string().optional(),
});

type AgreementValues = z.infer<typeof agreementSchema>;

function Step6AgreementDetails({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: projectData } = useGetProject(projectId);
  const updateProject = useUpdateProject();
  const { toast } = useToast();
  const project = projectData as any;

  const form = useForm<AgreementValues>({
    resolver: zodResolver(agreementSchema),
    defaultValues: {
      agreementType: project?.agreementType ?? "Plantation Development Agreement",
      agreementEffectiveDate: project?.agreementEffectiveDate ?? "",
      agreementDurationYears: project?.agreementDurationYears ?? 35,
      agreementSpecialTerms: project?.agreementSpecialTerms ?? "",
    },
  });

  const onSubmit = (values: AgreementValues) => {
    updateProject.mutate(
      { id: projectId, data: values as any },
      {
        onSuccess: onNext,
        onError: () => toast({ title: "Failed to save agreement details", variant: "destructive" }),
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="agreementType" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Agreement Type *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="Plantation Development Agreement">Plantation Development Agreement</SelectItem>
                  <SelectItem value="Hevea Cultivation Partnership Deed">Hevea Cultivation Partnership Deed</SelectItem>
                  <SelectItem value="Revenue Sharing Agreement">Revenue Sharing Agreement</SelectItem>
                  <SelectItem value="Joint Venture Agreement">Joint Venture Agreement</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="agreementEffectiveDate" render={({ field }) => (
            <FormItem>
              <FormLabel>Effective Date *</FormLabel>
              <FormControl><Input type="date" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="agreementDurationYears" render={({ field }) => (
            <FormItem>
              <FormLabel>Duration (Years) *</FormLabel>
              <FormControl><Input type="number" min={1} max={99} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="agreementSpecialTerms" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Special Terms & Conditions</FormLabel>
              <FormControl><Textarea rows={4} placeholder="Any special clauses, conditions, or deviations from standard terms..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button type="submit" disabled={updateProject.isPending}>
            {updateProject.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Step 7: Witnesses ─────────────────────────────────────────────────────────

const witnessSchema = z.object({
  fullName: z.string().min(2, "Full name required"),
  sOnCOn: z.string().optional(),
  fatherGuardianName: z.string().min(1, "Father/Guardian name required"),
  mobile: z.string().min(10, "10-digit mobile required").max(10, "10-digit mobile required"),
  address: z.string().min(5, "Address required"),
  aadhaarNumber: z.string().optional(),
});

type WitnessValues = z.infer<typeof witnessSchema>;

const EMPTY_WITNESS: WitnessValues = {
  fullName: "",
  sOnCOn: "S/O",
  fatherGuardianName: "",
  mobile: "",
  address: "",
  aadhaarNumber: "",
};

function Step7Witnesses({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: witnessData, refetch } = useListOnboardingWitnesses(projectId);
  const addWitness = useAddOnboardingWitness();
  const deleteWitness = useDeleteOnboardingWitness();
  const [showForm, setShowForm] = useState(false);
  const [witnessPersonSel, setWitnessPersonSel] = useState<PersonSummary | null>(null);
  const { toast } = useToast();

  const witnesses = witnessData?.witnesses ?? [];

  const form = useForm<WitnessValues>({
    resolver: zodResolver(witnessSchema),
    defaultValues: EMPTY_WITNESS,
  });

  const handleWitnessPersonSelect = (person: PersonSummary | null) => {
    setWitnessPersonSel(person);
    if (person) {
      form.reset({
        fullName: person.fullName ?? "",
        sOnCOn: person.sOnCOn ?? "S/O",
        fatherGuardianName: person.fatherGuardianName ?? "",
        mobile: person.mobile ?? "",
        address: "",
        aadhaarNumber: "",
      });
    }
  };

  const addNew = (values: WitnessValues) => {
    addWitness.mutate(
      {
        projectId,
        data: {
          ...values,
          personMasterId: witnessPersonSel?.id ?? undefined,
        } as any,
      },
      {
        onSuccess: () => {
          refetch();
          form.reset(EMPTY_WITNESS);
          setWitnessPersonSel(null);
          setShowForm(false);
          toast({ title: "Witness added" });
        },
        onError: () => toast({ title: "Failed to add witness", variant: "destructive" }),
      },
    );
  };

  const remove = (position: number) => {
    deleteWitness.mutate(
      { projectId, position },
      {
        onSuccess: () => {
          refetch();
          toast({ title: "Witness removed" });
        },
        onError: () => toast({ title: "Failed to remove witness", variant: "destructive" }),
      },
    );
  };

  const canProceed = witnesses.length >= 2;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Minimum <strong>2 witnesses</strong> are required. They will be named in the partnership
        deed. Search the Person Registry or register a new person for each witness.
      </p>

      {witnesses.length === 0 && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          No witnesses added yet. At least 2 required before proceeding.
        </div>
      )}

      <div className="space-y-2">
        {witnesses.map((w) => (
          <div
            key={w.id}
            className="flex items-start justify-between bg-muted/40 rounded-md p-3 border"
          >
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm">
                  Witness {w.position}: {w.fullName}
                  {w.sOnCOn && (w as any).fatherGuardianName ? (
                    <span className="text-muted-foreground font-normal ml-1">
                      ({w.sOnCOn} {(w as any).fatherGuardianName})
                    </span>
                  ) : w.sOnCOn ? (
                    <span className="text-muted-foreground font-normal ml-1">({w.sOnCOn})</span>
                  ) : null}
                </p>
                {(w as any).personMasterId && (
                  <span className="text-[10px] bg-green-100 text-green-700 border border-green-200 rounded px-1.5 py-0.5">
                    Registry Linked
                  </span>
                )}
              </div>
              {w.mobile && (
                <p className="text-xs text-muted-foreground mt-0.5">📞 {w.mobile}</p>
              )}
              {w.address && (
                <p className="text-xs text-muted-foreground">📍 {w.address}</p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => remove(w.position)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {showForm ? (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(addNew)}
            className="border rounded-lg p-4 space-y-4 bg-muted/20"
          >
            <p className="text-sm font-semibold">Add Witness</p>

            <PersonMasterSelector
              label="Search Registry (Optional)"
              selectedPerson={witnessPersonSel}
              onSelect={handleWitnessPersonSelect}
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-dashed" />
              <span className="text-xs text-muted-foreground shrink-0">
                {witnessPersonSel ? "Auto-filled — review below" : "Fill in details"}
              </span>
              <div className="flex-1 border-t border-dashed" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Full Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Witness full legal name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sOnCOn" render={({ field }) => (
                <FormItem>
                  <FormLabel>Relation</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "S/O"}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="S/O">S/O — Son of</SelectItem>
                      <SelectItem value="D/O">D/O — Daughter of</SelectItem>
                      <SelectItem value="W/O">W/O — Wife of</SelectItem>
                      <SelectItem value="C/O">C/O — Care of</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="fatherGuardianName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Father / Guardian Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Father or guardian's name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mobile" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mobile *</FormLabel>
                  <FormControl>
                    <Input placeholder="10-digit mobile" maxLength={10} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="aadhaarNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Aadhaar</FormLabel>
                  <FormControl>
                    <Input placeholder="12-digit Aadhaar" maxLength={12} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Address *</FormLabel>
                  <FormControl>
                    <Input placeholder="Witness permanent address" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addWitness.isPending}>
                {addWitness.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1" />
                )}
                Add Witness
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  setWitnessPersonSel(null);
                  form.reset(EMPTY_WITNESS);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Witness
        </Button>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed}
          title={!canProceed ? "Add at least 2 witnesses" : ""}
        >
          Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 8: Documents ─────────────────────────────────────────────────────────

type UploadField = "aadhaarObjectPath" | "supportingIdObjectPath";
type UploadKey = `${"developer" | "landowner"}-${UploadField}`;

function Step8Documents({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { getToken } = useAuth();
  const { data: participantData, refetch, isLoading, isFetching } = useListOnboardingParticipants(projectId);
  const upsertParticipant = useUpsertOnboardingParticipant();
  const { toast } = useToast();

  // Force a fresh fetch every time this step becomes visible (covers page-reload scenario)
  useEffect(() => {
    refetch();
  }, []);

  const participants = participantData?.participants ?? [];
  const developer = participants.find((p) => p.role === "developer");
  const landowner = participants.find((p) => p.role === "landowner");

  const [uploading, setUploading] = useState<Partial<Record<UploadKey, boolean>>>({});

  // Hidden file input refs — one per slot
  const inputRefs = useRef<Partial<Record<UploadKey, HTMLInputElement | null>>>({});

  const triggerPick = (key: UploadKey) => {
    inputRefs.current[key]?.click();
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    role: "developer" | "landowner",
    field: UploadField,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after a failure
    e.target.value = "";

    const participant = role === "developer" ? developer : landowner;
    if (!participant) {
      toast({ title: `Complete ${role} KYC step first`, variant: "destructive" });
      return;
    }

    const key: UploadKey = `${role}-${field}`;
    setUploading((prev) => ({ ...prev, [key]: true }));
    try {
      // Step 1 — request presigned URL
      const token = await getToken();
      const urlResp = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlResp.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await urlResp.json() as { uploadURL: string; objectPath: string };

      // Step 2 — PUT file directly to storage
      const putResp = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putResp.ok) throw new Error("File upload to storage failed");

      // Step 3 — patch participant record with new object path
      await upsertParticipant.mutateAsync({
        projectId,
        role,
        data: {
          fullName: participant.fullName,
          sOnCOn: participant.sOnCOn ?? undefined,
          fatherGuardianName: (participant as any).fatherGuardianName ?? undefined,
          aadhaarNumber: participant.aadhaarNumber ?? undefined,
          mobile: participant.mobile ?? undefined,
          address: participant.address ?? undefined,
          email: participant.email ?? undefined,
          aadhaarObjectPath:
            field === "aadhaarObjectPath"
              ? objectPath
              : (participant.aadhaarObjectPath ?? undefined),
          supportingIdObjectPath:
            field === "supportingIdObjectPath"
              ? objectPath
              : (participant.supportingIdObjectPath ?? undefined),
        },
      });

      await refetch();
      toast({ title: "Document uploaded successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setUploading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const rows: Array<{ label: string; role: "developer" | "landowner"; participant: typeof developer }> = [
    { label: "Developer", role: "developer", participant: developer },
    { label: "Landowner", role: "landowner", participant: landowner },
  ];

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Upload KYC documents for both parties. Aadhaar copies are required; supporting ID is optional.
        You may also upload later from the project details page.
      </p>

      <div className="space-y-4">
        {rows.map(({ label, role, participant }) => (
          <div key={role} className="border rounded-md p-4 space-y-3">
            <p className="font-medium text-sm">
              {label}: <span className="text-muted-foreground font-normal">{participant?.fullName ?? "—"}</span>
            </p>

            {(isLoading || isFetching) && !participant && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Verifying KYC record…
              </p>
            )}
            {!isLoading && !isFetching && participant && (
              <p className="text-xs text-green-700 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                KYC saved — linked to project successfully
              </p>
            )}
            {!isLoading && !isFetching && !participant && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p className="text-xs font-medium text-amber-800">KYC not saved</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Go back to the {label} KYC step and save before uploading documents.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {(["aadhaarObjectPath", "supportingIdObjectPath"] as UploadField[]).map((field) => {
                const key: UploadKey = `${role}-${field}`;
                const isAadhaar = field === "aadhaarObjectPath";
                const uploaded = !!((participant as any)?.[field]);
                const busy = uploading[key] ?? false;

                return (
                  <div key={field} className="space-y-1.5">
                    <Label className="text-xs">
                      {isAadhaar ? "Aadhaar Copy (PDF/Image)" : "Supporting ID (Optional)"}
                    </Label>

                    {/* hidden real input */}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="sr-only"
                      ref={(el) => { inputRefs.current[key] = el; }}
                      onChange={(e) => handleFileChange(e, role, field)}
                      disabled={busy}
                    />

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs h-8 px-3 flex-1"
                        disabled={busy}
                        onClick={() => triggerPick(key)}
                      >
                        {busy ? (
                          <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Uploading…</>
                        ) : uploaded ? (
                          <><CheckCircle2 className="h-3 w-3 mr-1.5 text-green-600" /> Replace</>
                        ) : (
                          "Choose file"
                        )}
                      </Button>
                      {uploaded && !busy && (
                        <Badge variant="secondary" className="text-xs whitespace-nowrap shrink-0">
                          <CheckCircle2 className="h-3 w-3 mr-1 text-green-600" /> Uploaded
                        </Badge>
                      )}
                      {!uploaded && !busy && isAadhaar && (
                        <Badge variant="outline" className="text-xs whitespace-nowrap shrink-0 text-amber-600 border-amber-300">
                          Pending
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={onNext}>
          Continue to OTP Verification <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 9: OTP Verification ──────────────────────────────────────────────────

function Step9OtpVerification({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: stateData, refetch } = useGetProjectOnboardingState(projectId);
  const sendOtp = useSendProjectOnboardingOtp();
  const verifyOtp = useVerifyProjectOnboardingOtp();
  const { toast } = useToast();

  const [devOtpInput, setDevOtpInput] = useState("");
  const [loOtpInput, setLoOtpInput] = useState("");
  const [devDevOtp, setDevDevOtp] = useState<string | null>(null);
  const [loDevOtp, setLoDevOtp] = useState<string | null>(null);

  const state = stateData as any;
  const otpStatus = state?.otpStatus ?? {};
  const developerVerified = otpStatus?.developer?.verified;
  const landownerVerified = otpStatus?.landowner?.verified;
  const canProceed = developerVerified && landownerVerified;

  const handleSendOtp = (role: "developer" | "landowner") => {
    const phone = role === "developer" ? otpStatus?.developer?.phone : otpStatus?.landowner?.phone;
    if (!phone) {
      toast({ title: `No phone number for ${role}. Please complete KYC step.`, variant: "destructive" });
      return;
    }
    sendOtp.mutate(
      { projectId, data: { role, phone } },
      {
        onSuccess: (data: any) => {
          toast({ title: `OTP sent to ${phone}` });
          if (data?.devOtp) {
            if (role === "developer") setDevDevOtp(data.devOtp);
            else setLoDevOtp(data.devOtp);
          }
          refetch();
        },
        onError: () => toast({ title: "Failed to send OTP", variant: "destructive" }),
      }
    );
  };

  const handleVerifyOtp = (role: "developer" | "landowner") => {
    const otpCode = role === "developer" ? devOtpInput : loOtpInput;
    if (!otpCode || otpCode.length !== 6) {
      toast({ title: "Enter the 6-digit OTP code", variant: "destructive" });
      return;
    }
    verifyOtp.mutate(
      { projectId, data: { role, otpCode } },
      {
        onSuccess: () => {
          toast({ title: `${role === "developer" ? "Developer" : "Landowner"} OTP verified` });
          refetch();
          if (role === "developer") { setDevOtpInput(""); setDevDevOtp(null); }
          else { setLoOtpInput(""); setLoDevOtp(null); }
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Invalid OTP";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  const renderOtpBlock = (
    role: "developer" | "landowner",
    label: string,
    phone: string | null | undefined,
    verified: boolean,
    otpInput: string,
    setOtpInput: (v: string) => void,
    devOtp: string | null
  ) => (
    <div className="border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-sm">{label}</p>
          <p className="text-xs text-muted-foreground">{phone ?? "No phone on file"}</p>
        </div>
        {verified ? (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-600">Pending</Badge>
        )}
      </div>

      {!verified && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSendOtp(role)}
            disabled={!phone || sendOtp.isPending}
          >
            {sendOtp.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Send OTP
          </Button>

          {devOtp && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-2 text-xs text-amber-700">
              <strong>Dev mode OTP:</strong> {devOtp}
            </div>
          )}

          <div className="flex gap-2 items-center">
            <Input
              placeholder="Enter 6-digit OTP"
              maxLength={6}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value)}
              className="w-40 text-center font-mono tracking-widest"
            />
            <Button
              size="sm"
              onClick={() => handleVerifyOtp(role)}
              disabled={otpInput.length !== 6 || verifyOtp.isPending}
            >
              {verifyOtp.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Verify
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Both the <strong>Developer</strong> and <strong>Landowner</strong> must verify their identity
        via OTP before the project can be activated.
      </p>

      {renderOtpBlock(
        "developer", "Developer",
        otpStatus?.developer?.phone, developerVerified,
        devOtpInput, setDevOtpInput, devDevOtp
      )}
      {renderOtpBlock(
        "landowner", "Landowner",
        otpStatus?.landowner?.phone, landownerVerified,
        loOtpInput, setLoOtpInput, loDevOtp
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed} title={!canProceed ? "Both OTPs must be verified" : ""}>
          Proceed to Review <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 10: Review & Activate ────────────────────────────────────────────────

function Step10ReviewActivate({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}) {
  const { data: stateData, isLoading } = useGetProjectOnboardingState(projectId);
  const activateProject = useActivateProjectViaOnboarding();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const state = stateData as any;
  const project = state?.project;
  const rawChecks = state?.completionChecks ?? {};
  const { data: parcelData } = useListProjectParcels(projectId);
  const { data: templateLink } = useGetProjectAgreementTemplate(projectId);

  // ── Activation gate criteria (must mirror server side in
  // project_onboarding.ts → POST /:id/onboarding/activate)
  const checks: Record<string, boolean> = {
    basicInfo: !!rawChecks.basicInfo,
    developerInfo: !!rawChecks.developerInfo,
    landownerInfo: !!rawChecks.landownerInfo,
    financialConfig: !!rawChecks.financialConfig,
    scheduleA: ((parcelData as any)?.parcels?.length ?? 0) >= 1,
    witnessDetails: !!rawChecks.witnessDetails,
    agreementTemplate: !!(templateLink as any)?.template?.id || !!(project as any)?.agreementTemplateId,
    projectType: !!(project as any)?.projectType,
    developerOtpVerified: !!rawChecks.developerOtpVerified,
    landownerOtpVerified: !!rawChecks.landownerOtpVerified,
  };
  const allPassed = Object.values(checks).every(Boolean);

  const handleActivate = () => {
    activateProject.mutate(
      { projectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          toast({ title: "Project activated successfully!" });
          navigate(`/projects/${projectId}`);
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Failed to activate project";
          toast({ title: msg, variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const checkLabels: Record<string, string> = {
    basicInfo: "Basic project info",
    developerInfo: "Developer KYC",
    landownerInfo: "Landowner KYC",
    financialConfig: "Commercial terms",
    scheduleA: "Schedule A (≥1 parcel)",
    witnessDetails: "Witnesses (min. 2)",
    agreementTemplate: "Agreement template linked",
    projectType: "Project type selected",
    developerOtpVerified: "Developer OTP verified",
    landownerOtpVerified: "Landowner OTP verified",
  };

  return (
    <div className="space-y-5">
      {project && (
        <div className="bg-muted/30 rounded-md p-4 space-y-2">
          <p className="font-semibold text-base">{project.name}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{project.commercialModel === "ownership_contribution" ? "Contribution Model" : "50% Revenue"}</Badge>
            <Badge variant="outline">{project.district}, {project.state}</Badge>
            <Badge variant="outline">Started: {project.startDate}</Badge>
            <Badge variant="outline">{project.termYears}yr term</Badge>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-medium mb-2">Pre-Activation Checklist</p>
        <div className="space-y-1.5">
          {Object.entries(checkLabels).map(([key, label]) => {
            const passed = !!checks[key];
            return (
              <div key={key} className="flex items-center gap-2 text-sm">
                {passed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className={passed ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                {!passed && <Badge variant="outline" className="text-xs text-amber-600 ml-auto">Incomplete</Badge>}
              </div>
            );
          })}
        </div>
      </div>

      {!allPassed && (
        <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Some steps are incomplete. Go back and complete all required steps before activating.</span>
        </div>
      )}

      {allPassed && (
        <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-md p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All checks passed. The project is ready for activation.
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button
          onClick={handleActivate}
          disabled={!allPassed || activateProject.isPending}
          className="bg-green-700 hover:bg-green-800 text-white"
        >
          {activateProject.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          Activate Project
        </Button>
      </div>
    </div>
  );
}

// ── Main Wizard Orchestrator ──────────────────────────────────────────────────

export default function ProjectCreationWizard() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const [projectId, setProjectId] = useState<string | null>(params?.id ?? null);
  const [currentStep, setCurrentStep] = useState(1);
  const saveStep = useSaveProjectOnboardingStep();

  const { data: projectData } = useGetProject(projectId ?? "skip");
  const project = projectData as any;

  useEffect(() => {
    if (project?.onboardingStep && project.onboardingStep > currentStep) {
      setCurrentStep(project.onboardingStep);
    }
  }, [project?.onboardingStep]);

  const advanceStep = (nextStep: number) => {
    if (projectId) {
      saveStep.mutate({ projectId, data: { step: nextStep } });
    }
    setCurrentStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleStep1Success = (id: string) => {
    setProjectId(id);
    navigate(`/projects/create/${id}`, { replace: true });
    advanceStep(2);
  };

  const goNext = () => advanceStep(currentStep + 1);
  const goBack = () => setCurrentStep((s) => Math.max(1, s - 1));

  const stepIcon = (step: number) => {
    const s = STEPS[step - 1];
    if (!s) return null;
    const Icon = s.icon;
    const isDone = currentStep > step;
    const isCurrent = currentStep === step;
    const isLocked = !projectId && step > 1;

    return (
      <div
        key={step}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm
          ${isCurrent ? "bg-primary/10 text-primary font-medium" : ""}
          ${isDone ? "text-green-700" : ""}
          ${!isCurrent && !isDone ? "text-muted-foreground" : ""}
          ${isLocked ? "opacity-40 cursor-not-allowed" : ""}
        `}
        onClick={() => !isLocked && step < currentStep && setCurrentStep(step)}
      >
        <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold
          ${isCurrent ? "bg-primary text-primary-foreground" : ""}
          ${isDone ? "bg-green-600 text-white" : ""}
          ${!isCurrent && !isDone ? "border border-muted-foreground/40" : ""}
        `}>
          {isDone ? "✓" : step}
        </div>
        <span>{s.label}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b px-6 py-4 flex items-center justify-between bg-card">
        <div>
          <h1 className="font-semibold text-lg">New Project Onboarding</h1>
          {project?.name && <p className="text-sm text-muted-foreground">{project.name}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
          Cancel
        </Button>
      </div>

      <div className="max-w-5xl mx-auto flex gap-6 p-6">
        <div className="w-52 shrink-0">
          <Card className="sticky top-6">
            <CardContent className="p-2 space-y-0.5">
              {STEPS.map((s) => stepIcon(s.id))}
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 min-w-0">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">
                Step {currentStep}: {STEPS[currentStep - 1]?.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              {currentStep === 1 && <Step1BasicInfo onNext={handleStep1Success} />}
              {currentStep === 2 && projectId && (
                <StepParticipants projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 3 && projectId && (
                <Step5CapacityFinancial projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 4 && projectId && (
                <StepScheduleA projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 5 && projectId && (
                <Step7Witnesses projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 6 && projectId && (
                <StepAgreementTemplate projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 7 && projectId && (
                <StepProjectType projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 8 && projectId && (
                <div className="space-y-6">
                  <Step9OtpVerification projectId={projectId} onNext={() => { /* stay on this step */ }} onBack={goBack} />
                  <Separator />
                  <Step10ReviewActivate projectId={projectId} onBack={goBack} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Prompt 6 — New step components (Participants list, Schedule A, Agreement
// Template selector, Project Type). Appended at end of file; JS hoisting
// makes them visible to the orchestrator above.
// ════════════════════════════════════════════════════════════════════════════

// ── Step 2: Participants (collapsed dev + landowner KYC) ────────────────────

function StepParticipants({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data } = useListOnboardingParticipants(projectId);
  const hasDev = !!data?.participants?.find((p) => p.role === "developer");
  const hasLandowner = !!data?.participants?.find((p) => p.role === "landowner");
  const canProceed = hasDev && hasLandowner;

  return (
    <div className="space-y-6">
      <div className="bg-muted/30 border rounded-md p-3 text-xs text-muted-foreground">
        Capture KYC for the two legally-required participants — Project
        Developer and Landowner. Additional participants (investors,
        employees, operational staff) can be added from the project page
        after creation.
      </div>

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Project Developer
            {hasDev && <Badge variant="outline" className="ml-2 text-[10px] bg-green-50 text-green-700 border-green-200">Captured</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StepParticipantKYC
            projectId={projectId}
            role="developer"
            roleLabel="Developer"
            onNext={() => { /* stay on combined screen */ }}
            onBack={onBack}
          />
        </CardContent>
      </Card>

      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" /> Landowner
            {hasLandowner && <Badge variant="outline" className="ml-2 text-[10px] bg-green-50 text-green-700 border-green-200">Captured</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StepParticipantKYC
            projectId={projectId}
            role="landowner"
            roleLabel="Landowner"
            onNext={() => { /* stay on combined screen */ }}
            onBack={onBack}
          />
        </CardContent>
      </Card>

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Continue <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Schedule A (multi-parcel CRUD) ──────────────────────────────────

const parcelFormSchema = z.object({
  landType: z.enum(["recorded", "non_recorded"]),
  khatianNumber: z.string().optional(),
  plotNumber: z.string().optional(),
  mouja: z.string().optional(),
  tahsil: z.string().optional(),
  revenueCircle: z.string().optional(),
  subDivision: z.string().optional(),
  landAreaName: z.string().optional(),
  postOffice: z.string().optional(),
  policeStation: z.string().optional(),
  village: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  landBoundaryDescription: z.string().optional(),
  gpsCoordinates: z.string().optional(),
  landArea: z.coerce.number().nonnegative(),
  landAreaUnit: z.string().default("kani"),
  notes: z.string().optional(),
});
type ParcelFormValues = z.infer<typeof parcelFormSchema>;

function StepScheduleA({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListProjectParcels(projectId);
  const createParcel = useCreateProjectParcel();
  const updateParcel = useUpdateProjectParcel();
  const deleteParcel = useDeleteProjectParcel();

  const parcels = data?.parcels ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const form = useForm<ParcelFormValues>({
    resolver: zodResolver(parcelFormSchema),
    defaultValues: { landType: "recorded", landArea: 0, landAreaUnit: "kani" },
  });

  const startEdit = (parcelId: string) => {
    const p = parcels.find((x: any) => x.id === parcelId);
    if (!p) return;
    setEditingId(parcelId);
    form.reset({
      landType: (p.landType as "recorded" | "non_recorded") ?? "recorded",
      khatianNumber: p.khatianNumber ?? "",
      plotNumber: p.plotNumber ?? "",
      mouja: p.mouja ?? "",
      tahsil: p.tahsil ?? "",
      revenueCircle: p.revenueCircle ?? "",
      subDivision: p.subDivision ?? "",
      landAreaName: p.landAreaName ?? "",
      postOffice: p.postOffice ?? "",
      policeStation: p.policeStation ?? "",
      village: p.village ?? "",
      district: p.district ?? "",
      state: p.state ?? "",
      landBoundaryDescription: p.landBoundaryDescription ?? "",
      gpsCoordinates: p.gpsCoordinates ?? "",
      landArea: Number(p.landArea) || 0,
      landAreaUnit: p.landAreaUnit ?? "kani",
      notes: (p as any).notes ?? "",
    });
    setShowForm(true);
  };

  const startAdd = () => {
    setEditingId(null);
    form.reset({ landType: "recorded", landArea: 0, landAreaUnit: "kani" });
    setShowForm(true);
  };

  const onSubmit = async (values: ParcelFormValues) => {
    try {
      if (editingId) {
        await updateParcel.mutateAsync({ id: projectId, parcelId: editingId, data: values });
        toast({ title: "Parcel updated" });
      } else {
        await createParcel.mutateAsync({ id: projectId, data: values });
        toast({ title: "Parcel added" });
      }
      await qc.invalidateQueries({ queryKey: getListProjectParcelsQueryKey(projectId) });
      setShowForm(false);
      setEditingId(null);
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not save parcel", variant: "destructive" });
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Remove this parcel from Schedule A?")) return;
    try {
      await deleteParcel.mutateAsync({ id: projectId, parcelId: id });
      await qc.invalidateQueries({ queryKey: getListProjectParcelsQueryKey(projectId) });
      toast({ title: "Parcel removed" });
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not remove parcel", variant: "destructive" });
    }
  };

  const isRecorded = form.watch("landType") === "recorded";

  return (
    <div className="space-y-5">
      <div className="bg-muted/30 border rounded-md p-3 text-xs text-muted-foreground">
        Schedule A lists every parcel covered by the project. You must record
        at least one parcel before the project can be activated. Each parcel
        is independently audited.
      </div>

      {/* List of existing parcels */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      ) : parcels.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">
          No parcels yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-2">
          {parcels.map((p: any) => (
            <div key={p.id} className="flex items-start justify-between border rounded-md p-3 bg-muted/20">
              <div className="text-sm">
                <div className="font-medium">
                  Parcel #{p.position} · {p.landArea} {p.landAreaUnit} · {p.landType === "recorded" ? "Recorded" : "Non-Recorded"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.landType === "recorded"
                    ? [p.mouja, p.khatianNumber && `Khatian ${p.khatianNumber}`, p.plotNumber && `Plot ${p.plotNumber}`].filter(Boolean).join(" · ")
                    : [p.landAreaName, p.postOffice, p.policeStation].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(p.id)}>Edit</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(p.id)}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm && (
        <Button type="button" variant="outline" onClick={startAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add Parcel
        </Button>
      )}

      {/* Add / edit form */}
      {showForm && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{editingId ? "Edit Parcel" : "New Parcel"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="landType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Land Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="recorded">Recorded</SelectItem>
                        <SelectItem value="non_recorded">Non-Recorded</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                {isRecorded ? (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="khatianNumber" render={({ field }) => (
                      <FormItem><FormLabel>Khatian Number</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="plotNumber" render={({ field }) => (
                      <FormItem><FormLabel>Plot Number</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="mouja" render={({ field }) => (
                      <FormItem><FormLabel>Mouja</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="tahsil" render={({ field }) => (
                      <FormItem><FormLabel>Tahsil</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="revenueCircle" render={({ field }) => (
                      <FormItem><FormLabel>Revenue Circle</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="subDivision" render={({ field }) => (
                      <FormItem><FormLabel>Sub-Division</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={form.control} name="landAreaName" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel>Land / Area Name</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="postOffice" render={({ field }) => (
                      <FormItem><FormLabel>Post Office</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="policeStation" render={({ field }) => (
                      <FormItem><FormLabel>Police Station</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                    )} />
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <FormField control={form.control} name="village" render={({ field }) => (
                    <FormItem><FormLabel>Village</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="district" render={({ field }) => (
                    <FormItem><FormLabel>District</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="state" render={({ field }) => (
                    <FormItem><FormLabel>State</FormLabel><FormControl><Input {...field} value={field.value ?? ""} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="landBoundaryDescription" render={({ field }) => (
                  <FormItem><FormLabel>Boundary Description</FormLabel><FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl></FormItem>
                )} />

                <div className="grid grid-cols-3 gap-3">
                  <FormField control={form.control} name="landArea" render={({ field }) => (
                    <FormItem><FormLabel>Area</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="landAreaUnit" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? "kani"}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="kani">Kani</SelectItem>
                          <SelectItem value="acres">Acres</SelectItem>
                          <SelectItem value="hectares">Hectares</SelectItem>
                          <SelectItem value="bigha">Bigha</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gpsCoordinates" render={({ field }) => (
                    <FormItem><FormLabel>GPS</FormLabel><FormControl><Input placeholder="lat, lng" {...field} value={field.value ?? ""} /></FormControl></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea rows={2} {...field} value={field.value ?? ""} /></FormControl></FormItem>
                )} />

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</Button>
                  <Button type="submit" disabled={createParcel.isPending || updateParcel.isPending}>
                    {(createParcel.isPending || updateParcel.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingId ? "Save Changes" : "Add Parcel"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={onNext} disabled={parcels.length < 1}>
          Continue <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 6: Agreement Template selector ─────────────────────────────────────

function StepAgreementTemplate({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: linkData, isLoading: linkLoading } = useGetProjectAgreementTemplate(projectId);
  const { data: templates, isLoading: tplLoading } = useListTemplates();
  const setLink = useSetProjectAgreementTemplate();

  const currentId = (linkData as any)?.template?.id ?? null;
  const [selected, setSelected] = useState<string | "">("");

  useEffect(() => {
    if (currentId) setSelected(currentId);
  }, [currentId]);

  const eligible = useMemo(
    () => (templates ?? []).filter((t: any) => t.category === "agreement" && t.status === "active"),
    [templates],
  );

  const handleSave = async () => {
    if (!selected) {
      toast({ title: "Pick a template", variant: "destructive" });
      return;
    }
    try {
      await setLink.mutateAsync({ id: projectId, data: { agreementTemplateId: selected } });
      await qc.invalidateQueries({ queryKey: getGetProjectAgreementTemplateQueryKey(projectId) });
      await qc.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      toast({ title: "Agreement template linked" });
      onNext();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not link template", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-muted/30 border rounded-md p-3 text-xs text-muted-foreground">
        Link this project to an active agreement template from the Document
        Template Registry. The template will be used when generating the
        partnership deed.
      </div>

      {tplLoading || linkLoading ? (
        <p className="text-sm text-muted-foreground">Loading templates…</p>
      ) : eligible.length === 0 ? (
        <div className="border border-amber-200 bg-amber-50 rounded-md p-3 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            No active agreement templates available. Ask an admin to create
            one in the Templates module before continuing.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Active Agreement Templates</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger><SelectValue placeholder="Select an agreement template…" /></SelectTrigger>
            <SelectContent>
              {eligible.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} {t.version ? `· v${t.version}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={handleSave} disabled={!selected || setLink.isPending}>
          {setLink.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 7: Project Type ────────────────────────────────────────────────────

const PROJECT_TYPES: Array<{ value: string; label: string; description: string }> = [
  { value: "joint_venture", label: "Joint Venture", description: "Single landowner + single developer JV (typical)." },
  { value: "community_partnership", label: "Community Partnership", description: "Multi-landowner pooled with one developer." },
  { value: "sole_developer", label: "Sole Developer", description: "Developer-owned land — no separate landowner." },
  { value: "lease_based", label: "Lease-Based", description: "Developer leases land for a fixed term." },
  { value: "other", label: "Other", description: "Fallback — requires a governance note." },
];

function StepProjectType({
  projectId,
  onNext,
  onBack,
}: {
  projectId: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: project } = useGetProject(projectId);
  const updateProject = useUpdateProject();
  const [selected, setSelected] = useState<string>((project as any)?.projectType ?? "joint_venture");

  useEffect(() => {
    if ((project as any)?.projectType) setSelected((project as any).projectType);
  }, [(project as any)?.projectType]);

  const handleSave = async () => {
    try {
      await updateProject.mutateAsync({ id: projectId, data: { projectType: selected } as any });
      await qc.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
      toast({ title: "Project type saved" });
      onNext();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not save project type", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-muted/30 border rounded-md p-3 text-xs text-muted-foreground">
        Classify the structural shape of this project. Drives deed template
        selection, governance expectations, and dashboard filtering. Cannot
        be changed on an active project without a governance override.
      </div>

      <div className="space-y-2">
        {PROJECT_TYPES.map((t) => (
          <label
            key={t.value}
            className={`flex items-start gap-3 border rounded-md p-3 cursor-pointer transition-colors
              ${selected === t.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
          >
            <input
              type="radio"
              name="projectType"
              className="mt-1"
              value={t.value}
              checked={selected === t.value}
              onChange={() => setSelected(t.value)}
            />
            <div>
              <div className="text-sm font-medium">{t.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={handleSave} disabled={updateProject.isPending}>
          {updateProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save & Continue <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
