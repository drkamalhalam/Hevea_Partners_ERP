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
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2, Circle, AlertCircle, ChevronRight, ChevronLeft,
  Plus, Trash2, Users, MapPin, Leaf, FileText, Shield, KeyRound, Eye, Loader2,
  Banknote, Info, Gavel, BookOpen, AlertTriangle, TreePine, Calculator, Scale,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

const STEPS = [
  { id: 1, label: "Project Basics", icon: FileText },
  { id: 2, label: "Developer KYC", icon: Users },
  { id: 3, label: "Landowner KYC", icon: Users },
  { id: 4, label: "Land Details", icon: MapPin },
  { id: 5, label: "Capacity & Finance", icon: Leaf },
  { id: 6, label: "Agreement Terms", icon: FileText },
  { id: 7, label: "Witnesses", icon: Users },
  { id: 8, label: "Documents", icon: Shield },
  { id: 9, label: "OTP Verification", icon: KeyRound },
  { id: 10, label: "Review & Activate", icon: CheckCircle2 },
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
  // Stable id used as effect dependency — avoids resetting form on every re-render
  const existingId = existing?.id;

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

  // Populate form once the saved record loads — keyed on the record ID so it
  // only fires when a genuinely different record arrives, not on every render.
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

  const onSubmit = (values: ParticipantValues) => {
    upsertParticipant.mutate(
      { projectId, role, data: values },
      {
        onSuccess: async () => {
          // Refetch now (not just mark stale) so the in-memory cache is populated
          // with the saved participant before the next step renders.
          await qc.refetchQueries({
            queryKey: getListOnboardingParticipantsQueryKey(projectId),
          });
          onNext();
        },
        onError: () => toast({ title: `Failed to save ${roleLabel} details`, variant: "destructive" }),
      }
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Full legal identity details for the <strong>{roleLabel}</strong> as they appear on official documents.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="fullName" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Full Legal Name *</FormLabel>
              <FormControl><Input placeholder={`${roleLabel}'s full name as per Aadhaar`} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="sOnCOn" render={({ field }) => (
            <FormItem>
              <FormLabel>Relation Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? "S/O"}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select relation" /></SelectTrigger></FormControl>
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
              <FormControl><Input placeholder="Father or guardian's name" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="aadhaarNumber" render={({ field }) => (
            <FormItem>
              <FormLabel>Aadhaar Number</FormLabel>
              <FormControl><Input placeholder="12-digit Aadhaar" maxLength={12} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="mobile" render={({ field }) => (
            <FormItem>
              <FormLabel>Mobile Number *</FormLabel>
              <FormControl><Input placeholder="10-digit mobile" maxLength={10} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input type="email" placeholder="Optional email address" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="address" render={({ field }) => (
            <FormItem className="col-span-2">
              <FormLabel>Full Address *</FormLabel>
              <FormControl><Textarea rows={2} placeholder="Complete permanent address with PIN" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button type="submit" disabled={upsertParticipant.isPending}>
            {upsertParticipant.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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
  // LNV — captured for ALL commercial models
  valuationMethod: z.enum(["by_tree_capacity", "by_land_area_kani", "manual"]).default("manual"),
  perTreeValue: z.coerce.number().min(0).optional(),
  landValuePerUnit: z.coerce.number().min(0).optional(),
  landNotionalValue: z.coerce.number().min(0).optional(),
  landNotionalValueRemarks: z.string().optional(),
  // LCA — only activates for ownership model
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

  // Populate form once project data loads
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

  // Auto-compute LNV from the chosen method
  const computedLNV = useMemo(() => {
    const cap = parseFloat(String(rubberCapacity)) || 0;
    const ptv = parseFloat(String(perTreeValue)) || 0;
    const pku = parseFloat(String(landValuePerUnit)) || 0;
    if (valuationMethod === "by_tree_capacity") return cap * ptv;
    if (valuationMethod === "by_land_area_kani") return landArea * pku;
    return null;
  }, [valuationMethod, rubberCapacity, perTreeValue, landValuePerUnit, landArea]);

  // Keep the landNotionalValue form field in sync with the computed value
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Governance Configuration Banner ──────────────────────── */}
        <div className="rounded-lg border border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 p-4 flex items-start gap-3">
          <div className="p-1.5 bg-amber-500/15 border border-amber-400/30 rounded-md shrink-0 mt-0.5">
            <Gavel className="w-4 h-4 text-amber-700" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-900">Governance Configuration — Land Valuation & Financial Foundation</p>
            <p className="text-xs text-amber-800/80 mt-1 leading-relaxed">
              The values configured in this step are <strong>foundational governance declarations</strong> — not ordinary accounting entries. They form the legal and commercial basis for deed generation, ownership equity, contribution structure, LCA calculation, and maturity economics. Enter them with the same care as a signed contractual commitment.
            </p>
          </div>
        </div>

        {/* ── What is Land Notional Value? ─────────────────────────── */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-slate-600 shrink-0" />
            <p className="text-sm font-semibold text-slate-800">Understanding Land Notional Value (LNV)</p>
          </div>
          <div className="grid grid-cols-1 gap-1.5 pl-6">
            {[
              "Non-cash recognition of the land's economic contribution to the project — no money changes hands",
              "Fixed and foundation-based — does not escalate automatically with inflation or time",
              "Must be recorded before the project reaches the Mature Production lifecycle stage",
              "Entirely separate from operational expenses, advance payments, and recoverable items",
              "Linked to deed generation, ownership equity, and contribution proportion calculations",
              "Becomes the basis for Land Contribution Adjustment (LCA) under Ownership Contribution model",
              "Audit-linked — this declaration will appear in governance records and agreement snapshots",
            ].map((point, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-slate-400 mt-2 shrink-0" />
                <p className="text-xs text-slate-600 leading-relaxed">{point}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Plantation Capacity ─────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TreePine className="w-4 h-4 text-green-600 shrink-0" />
            <p className="text-sm font-semibold">Plantation Capacity</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="rubberCapacity" render={({ field }) => (
              <FormItem>
                <FormLabel>Rubber Tree Capacity *</FormLabel>
                <FormControl><Input type="number" min="1" placeholder="Approx. number of trees" {...field} /></FormControl>
                <p className="text-xs text-muted-foreground mt-1">Used for tree-capacity valuation method and production planning.</p>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="rubberCapacityUnit" render={({ field }) => (
              <FormItem>
                <FormLabel>Capacity Unit</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? "trees"}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
        </div>

        <Separator />

        {/* ── Land Notional Value Declaration ─────────────────────── */}
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm font-semibold">Land Notional Value Declaration</p>
          </div>

          {/* Model-aware status panel */}
          {isOwnershipModel ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3.5 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-900">Active — Ownership Contribution Model</p>
                <p className="text-xs text-green-700 mt-0.5 leading-relaxed">
                  This LNV directly determines ownership equity, LCA base calculation, contribution proportions, and all deed parameters. It is a legally binding governance value once the project is activated.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3.5 flex items-start gap-3">
              <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-sky-900">Preserved — 50% Revenue Split Model</p>
                <p className="text-xs text-sky-700 mt-0.5 leading-relaxed">
                  Under the Revenue Split model, LNV is captured and preserved for governance audit and future reference. It remains <strong>inactive for ownership and LCA calculations</strong> but will activate automatically if this project migrates to the Ownership Contribution model. Entry is still required.
                </p>
              </div>
            </div>
          )}

          {/* Valuation Method Selector */}
          <div className="space-y-3">
            <FormField control={form.control} name="valuationMethod" render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2 mb-1">
                  <Calculator className="w-3.5 h-3.5 text-muted-foreground" />
                  <FormLabel className="mb-0">Valuation Method *</FormLabel>
                </div>
                <Select onValueChange={field.onChange} value={field.value ?? "manual"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select how to determine land value" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="by_tree_capacity">By Tree Capacity — LNV = Trees × Value per Tree</SelectItem>
                    <SelectItem value="by_land_area_kani">By Land Area ({landAreaUnit}) — LNV = Area × Value per {landAreaUnit}</SelectItem>
                    <SelectItem value="manual">Manual / Report-Based — Enter total value directly</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Per-method guidance text */}
            {valuationMethod === "by_tree_capacity" && (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">Use this method when the plantation tree count is well-established and a per-tree market value is available. Ideal for projects with precise rubber tree census records or nursery records.</p>
              </div>
            )}
            {valuationMethod === "by_land_area_kani" && (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">Use this method when exact land area is available from survey or registry records. The per-{landAreaUnit} value should reflect prevailing local agricultural or plantation land rates at the time of project formation.</p>
              </div>
            )}
            {valuationMethod === "manual" && (
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">Use this method when a certified valuation report, deed-referenced amount, or prior assessment is available. Enter the total assessed value directly. Reference the source document in the Remarks field below.</p>
              </div>
            )}
          </div>

          {/* By Tree Capacity inputs */}
          {valuationMethod === "by_tree_capacity" && (
            <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-4 space-y-4">
              <p className="text-xs font-medium text-amber-900 uppercase tracking-wide">Calculation Inputs</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border border-amber-200 rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">Rubber Trees (from above)</p>
                  <p className="font-bold text-base text-amber-900">{Number(rubberCapacity || 0).toLocaleString("en-IN")}</p>
                  <p className="text-xs text-muted-foreground mt-1">trees (auto-linked)</p>
                </div>
                <FormField control={form.control} name="perTreeValue" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value per Tree (₹) *</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" placeholder="e.g. 5000" className="bg-white" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground mt-1">Market or assessed rate per tree</p>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              {computedLNV !== null && (
                <div className={`rounded-md p-3 flex items-center justify-between ${computedLNV > 0 ? "bg-amber-100 border border-amber-300" : "bg-muted border"}`}>
                  <div>
                    <p className="text-xs text-amber-800 font-medium">Computed Land Notional Value</p>
                    <p className="text-xs text-amber-700 mt-0.5">{Number(rubberCapacity||0).toLocaleString("en-IN")} trees × {fmtINR(parseFloat(String(perTreeValue||0)))}</p>
                  </div>
                  <p className={`font-bold text-xl ${computedLNV > 0 ? "text-amber-900" : "text-muted-foreground"}`}>{fmtINR(computedLNV)}</p>
                </div>
              )}
            </div>
          )}

          {/* By Land Area inputs */}
          {valuationMethod === "by_land_area_kani" && (
            <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-4 space-y-4">
              <p className="text-xs font-medium text-amber-900 uppercase tracking-wide">Calculation Inputs</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border border-amber-200 rounded-md p-3">
                  <p className="text-xs text-muted-foreground mb-1">Land Area (from Step 4)</p>
                  <p className="font-bold text-base text-amber-900">{landArea.toLocaleString("en-IN")} {landAreaUnit}</p>
                  {landArea === 0 && (
                    <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Return to Step 4 to set land area</p>
                  )}
                </div>
                <FormField control={form.control} name="landValuePerUnit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value per {landAreaUnit} (₹) *</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" placeholder="e.g. 25000" className="bg-white" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground mt-1">Local plantation land rate</p>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              {computedLNV !== null && (
                <div className={`rounded-md p-3 flex items-center justify-between ${computedLNV > 0 ? "bg-amber-100 border border-amber-300" : "bg-muted border"}`}>
                  <div>
                    <p className="text-xs text-amber-800 font-medium">Computed Land Notional Value</p>
                    <p className="text-xs text-amber-700 mt-0.5">{landArea.toLocaleString("en-IN")} {landAreaUnit} × {fmtINR(parseFloat(String(landValuePerUnit||0)))}</p>
                  </div>
                  <p className={`font-bold text-xl ${computedLNV > 0 ? "text-amber-900" : "text-muted-foreground"}`}>{fmtINR(computedLNV)}</p>
                </div>
              )}
            </div>
          )}

          {/* Manual entry */}
          {valuationMethod === "manual" && (
            <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-4 space-y-4">
              <p className="text-xs font-medium text-amber-900 uppercase tracking-wide">Direct Value Entry</p>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="landNotionalValue" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Land Notional Value (₹) *</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" placeholder="Total assessed value in INR" className="bg-white font-semibold" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground mt-1">From valuation report or deed reference</p>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="landValuePerUnit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Implied Rate per {landAreaUnit} (₹)</FormLabel>
                    <FormControl><Input type="number" step="0.01" min="0" placeholder={`Optional — per ${landAreaUnit}`} className="bg-white" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground mt-1">For reference only</p>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>
          )}

          {/* Auto-computed total (non-manual) */}
          {valuationMethod !== "manual" && (
            <FormField control={form.control} name="landNotionalValue" render={({ field }) => (
              <FormItem>
                <FormLabel>Total Land Notional Value (₹) — auto-computed</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" readOnly className="bg-muted text-muted-foreground cursor-not-allowed font-semibold text-base" {...field} />
                </FormControl>
                <p className="text-xs text-muted-foreground">Calculated automatically from the inputs above. Switch to Manual Entry to override directly.</p>
              </FormItem>
            )} />
          )}

          {/* Remarks / Reference Section */}
          <div className="space-y-2">
            <FormField control={form.control} name="landNotionalValueRemarks" render={({ field }) => (
              <FormItem>
                <FormLabel>Valuation Remarks & Reference</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Enter reference details that support this valuation..."
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                  {["Deed Clause ref.", "Survey No.", "Market rate basis", "Valuation report date", "Assessor name"].map(ex => (
                    <span key={ex} className="text-xs text-muted-foreground">· {ex}</span>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />
          </div>

          {/* ── Governance Acknowledgment ──────────────────────────── */}
          <div className={`rounded-lg border p-4 transition-colors ${lnvConfirmed ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
            <div className="flex items-start gap-3">
              <Checkbox
                id="lnv-confirm"
                checked={lnvConfirmed}
                onCheckedChange={(v) => setLnvConfirmed(!!v)}
                className="mt-0.5 shrink-0"
              />
              <label htmlFor="lnv-confirm" className="cursor-pointer select-none">
                <p className="text-sm font-semibold text-slate-800">
                  Governance Acknowledgment <span className="text-destructive">*</span>
                </p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  I confirm that this Land Notional Value is a <strong>fixed, non-cash governance declaration</strong>, entirely separate from operational expenses, advance payments, and recoverable items. I understand that this value will be linked to deed generation, ownership equity, governance records, and future audit logs, and that it cannot be changed on an active project without a governance override.
                </p>
              </label>
            </div>
            {!lnvConfirmed && (
              <p className="text-xs text-amber-700 mt-2 pl-7">This acknowledgment is required before you can proceed.</p>
            )}
          </div>
        </div>

        <Separator />

        {/* ── LCA Configuration ────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-purple-600 shrink-0" />
            <p className="text-sm font-semibold">Land Contribution Adjustment (LCA)</p>
          </div>

          {isOwnershipModel ? (
            <>
              {/* LCA explanation */}
              <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-4 space-y-2">
                <p className="text-xs font-medium text-purple-900 uppercase tracking-wide">What is LCA?</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {[
                    "An annual adjustment credited to the landowner's contribution account",
                    "Applied sequentially each year — Year 1 base, escalated by the configured % each subsequent year",
                    "Carry-forward mechanism preserves unpaid LCA balances across years — they are never lost",
                    "Separate from operational expenditure, burden accounting, and distribution",
                    "Becomes part of the landowner's credit ledger and affects net position calculations",
                  ].map((point, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-purple-400 mt-2 shrink-0" />
                      <p className="text-xs text-purple-700 leading-relaxed">{point}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Maturity warning */}
              <div className="flex items-start gap-2.5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0 mt-0.5" />
                <p className="text-xs text-orange-800 leading-relaxed">
                  <strong>LCA activates only after this project transitions to Mature Production.</strong> These values are configuration only — no LCA entries are generated until maturity is formally declared. The configured amounts are locked at activation and require a governance override to change thereafter.
                </p>
              </div>

              {/* LCA inputs */}
              <div className="border border-purple-200 bg-purple-50/30 rounded-lg p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="lcaBaseAmount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>LCA Base Amount (₹ / year)</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="Annual base LCA amount" className="bg-white" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground mt-1">Year-1 LCA credit amount before escalation</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="lcaEscalationPct" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Annual Escalation (%)</FormLabel>
                      <FormControl><Input type="number" step="0.01" min="0" max="100" placeholder="e.g. 5.00" className="bg-white" {...field} /></FormControl>
                      <p className="text-xs text-muted-foreground mt-1">Compounding rate applied each maturity year</p>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-700">LCA Not Applicable</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Land Contribution Adjustment does not apply to the 50% Revenue Split commercial model. Under this model, the landowner's return is governed by the revenue split arrangement rather than contribution-based equity. LCA will only become available if this project migrates to the Ownership Contribution model.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button type="submit" disabled={updateProject.isPending || !lnvConfirmed}>
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
  const { toast } = useToast();

  const witnesses = witnessData?.witnesses ?? [];

  const form = useForm<WitnessValues>({
    resolver: zodResolver(witnessSchema),
    defaultValues: { fullName: "", sOnCOn: "S/O", fatherGuardianName: "", mobile: "", address: "", aadhaarNumber: "" },
  });

  const addNew = (values: WitnessValues) => {
    addWitness.mutate(
      { projectId, data: values },
      {
        onSuccess: () => {
          refetch();
          form.reset({ fullName: "", sOnCOn: "S/O", fatherGuardianName: "", mobile: "", address: "", aadhaarNumber: "" });
          setShowForm(false);
          toast({ title: "Witness added" });
        },
        onError: () => toast({ title: "Failed to add witness", variant: "destructive" }),
      }
    );
  };

  const remove = (position: number) => {
    deleteWitness.mutate(
      { projectId, position },
      {
        onSuccess: () => { refetch(); toast({ title: "Witness removed" }); },
        onError: () => toast({ title: "Failed to remove witness", variant: "destructive" }),
      }
    );
  };

  const canProceed = witnesses.length >= 2;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Minimum <strong>2 witnesses</strong> are required. They will be named in the partnership deed.
      </p>

      {witnesses.length === 0 && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          No witnesses added yet. At least 2 required before proceeding.
        </div>
      )}

      <div className="space-y-2">
        {witnesses.map((w) => (
          <div key={w.id} className="flex items-start justify-between bg-muted/40 rounded-md p-3 border">
            <div>
              <p className="font-medium text-sm">
                Witness {w.position}: {w.fullName}
                {w.sOnCOn && (w as any).fatherGuardianName
                  ? <span className="text-muted-foreground font-normal ml-1">({w.sOnCOn} {(w as any).fatherGuardianName})</span>
                  : w.sOnCOn
                  ? <span className="text-muted-foreground font-normal ml-1">({w.sOnCOn})</span>
                  : null}
              </p>
              {w.mobile && <p className="text-xs text-muted-foreground mt-0.5">📞 {w.mobile}</p>}
              {w.address && <p className="text-xs text-muted-foreground">📍 {w.address}</p>}
            </div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(w.position)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {showForm ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(addNew)} className="border rounded-md p-4 space-y-3 bg-muted/20">
            <p className="text-sm font-medium">New Witness</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Full Name *</FormLabel>
                  <FormControl><Input placeholder="Witness full legal name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sOnCOn" render={({ field }) => (
                <FormItem>
                  <FormLabel>Relation</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "S/O"}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
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
                  <FormControl><Input placeholder="Father or guardian's name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="mobile" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mobile *</FormLabel>
                  <FormControl><Input placeholder="10-digit mobile" maxLength={10} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="aadhaarNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Aadhaar</FormLabel>
                  <FormControl><Input placeholder="12-digit Aadhaar" maxLength={12} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Address *</FormLabel>
                  <FormControl><Input placeholder="Witness permanent address" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addWitness.isPending}>
                {addWitness.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                Add Witness
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
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
        <Button onClick={onNext} disabled={!canProceed} title={!canProceed ? "Add at least 2 witnesses" : ""}>
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
  const checks = state?.completionChecks ?? {};
  const allPassed = checks && Object.values(checks).every(Boolean);

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
    landDetails: "Land details",
    financialConfig: "Financial configuration",
    agreementDetails: "Agreement terms",
    witnessDetails: "Witnesses (min. 2)",
    documentsUploaded: "Documents uploaded",
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
                <StepParticipantKYC
                  projectId={projectId}
                  role="developer"
                  roleLabel="Developer (Project Developer)"
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === 3 && projectId && (
                <StepParticipantKYC
                  projectId={projectId}
                  role="landowner"
                  roleLabel="Landowner"
                  onNext={goNext}
                  onBack={goBack}
                />
              )}
              {currentStep === 4 && projectId && (
                <Step4LandDetails projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 5 && projectId && (
                <Step5CapacityFinancial projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 6 && projectId && (
                <Step6AgreementDetails projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 7 && projectId && (
                <Step7Witnesses projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 8 && projectId && (
                <Step8Documents projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 9 && projectId && (
                <Step9OtpVerification projectId={projectId} onNext={goNext} onBack={goBack} />
              )}
              {currentStep === 10 && projectId && (
                <Step10ReviewActivate projectId={projectId} onBack={goBack} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
