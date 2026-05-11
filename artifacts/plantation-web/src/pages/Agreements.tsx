import { useState } from "react";
import { Link } from "wouter";
import { useListAgreements, useCreateAgreement, useListProjects, useListPartners, getListAgreementsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, FileText, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  active: "bg-green-100 text-green-800",
  matured: "bg-blue-100 text-blue-800",
  terminated: "bg-red-100 text-red-800",
};

const formSchema = z.object({
  projectId: z.coerce.number().positive(),
  landOwnerId: z.coerce.number().positive(),
  projectDeveloperId: z.coerce.number().positive(),
  executionDate: z.string().min(1),
  executionPlace: z.string().min(2),
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

export default function Agreements() {
  const { data: agreements, isLoading } = useListAgreements();
  const { data: projects } = useListProjects();
  const { data: partners } = useListPartners();
  const createAgreement = useCreateAgreement();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: 0, landOwnerId: 0, projectDeveloperId: 0,
      executionDate: "", executionPlace: "Ambassa, Dhalai",
      termYears: 35, landArea: 0, landAreaUnit: "kani",
      landNotionalValue: 0, landValuePerUnit: 30000,
      landContributionAdjustment: 5000, yearlyEscalation: 5,
      revenueModel: "contribution",
    },
  });

  function onSubmit(values: FormValues) {
    createAgreement.mutate({ data: values as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAgreementsQueryKey() });
        toast({ title: "Agreement created" });
        setOpen(false);
        form.reset();
      },
      onError: () => toast({ title: "Failed to create agreement", variant: "destructive" }),
    });
  }

  const landowners = partners?.filter(p => p.role === "landowner") ?? [];
  const developers = partners?.filter(p => p.role === "project_developer") ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Partnership Agreements</h1>
          <p className="text-muted-foreground mt-1">All plantation partnership deeds</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-agreement" className="gap-2"><Plus className="w-4 h-4" /> New Agreement</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-serif">Create Partnership Agreement</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="projectId" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Project</FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                        <FormControl><SelectTrigger data-testid="select-project"><SelectValue placeholder="Select project" /></SelectTrigger></FormControl>
                        <SelectContent>{projects?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="landOwnerId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Landowner</FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                        <FormControl><SelectTrigger data-testid="select-landowner"><SelectValue placeholder="Select landowner" /></SelectTrigger></FormControl>
                        <SelectContent>{landowners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="projectDeveloperId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Developer</FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={field.value ? String(field.value) : ""}>
                        <FormControl><SelectTrigger data-testid="select-developer"><SelectValue placeholder="Select developer" /></SelectTrigger></FormControl>
                        <SelectContent>{developers.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="executionDate" render={({ field }) => (
                    <FormItem><FormLabel>Execution Date</FormLabel><FormControl><Input type="date" data-testid="input-execution-date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="executionPlace" render={({ field }) => (
                    <FormItem><FormLabel>Execution Place</FormLabel><FormControl><Input data-testid="input-execution-place" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="termYears" render={({ field }) => (
                    <FormItem><FormLabel>Term (Years)</FormLabel><FormControl><Input type="number" data-testid="input-agreement-term" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="landArea" render={({ field }) => (
                    <FormItem><FormLabel>Land Area</FormLabel><FormControl><Input type="number" step="0.1" data-testid="input-agreement-land-area" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="landAreaUnit" render={({ field }) => (
                    <FormItem><FormLabel>Unit</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-agreement-unit"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent><SelectItem value="kani">Kani</SelectItem><SelectItem value="acre">Acre</SelectItem></SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="landNotionalValue" render={({ field }) => (
                    <FormItem><FormLabel>Land Notional Value (INR)</FormLabel><FormControl><Input type="number" data-testid="input-notional-value" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="landValuePerUnit" render={({ field }) => (
                    <FormItem><FormLabel>Value Per Unit (INR)</FormLabel><FormControl><Input type="number" data-testid="input-value-per-unit" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="landContributionAdjustment" render={({ field }) => (
                    <FormItem><FormLabel>Land Contribution Adjustment (INR/unit/yr)</FormLabel><FormControl><Input type="number" data-testid="input-lca" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="yearlyEscalation" render={({ field }) => (
                    <FormItem><FormLabel>Yearly Escalation (%)</FormLabel><FormControl><Input type="number" step="0.1" data-testid="input-escalation" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="revenueModel" render={({ field }) => (
                    <FormItem className="col-span-2"><FormLabel>Revenue Model</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-revenue-model"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="contribution">Contribution Model</SelectItem>
                          <SelectItem value="fifty_percent_revenue">50% Revenue Model</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="northBoundary" render={({ field }) => (
                    <FormItem><FormLabel>North Boundary</FormLabel><FormControl><Input data-testid="input-north" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="southBoundary" render={({ field }) => (
                    <FormItem><FormLabel>South Boundary</FormLabel><FormControl><Input data-testid="input-south" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="eastBoundary" render={({ field }) => (
                    <FormItem><FormLabel>East Boundary</FormLabel><FormControl><Input data-testid="input-east" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="westBoundary" render={({ field }) => (
                    <FormItem><FormLabel>West Boundary</FormLabel><FormControl><Input data-testid="input-west" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" data-testid="button-submit-agreement" disabled={createAgreement.isPending}>
                    {createAgreement.isPending ? "Creating..." : "Create Agreement"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : !agreements?.length ? (
        <Card className="py-16 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No agreements yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {agreements.map(a => (
            <Card key={a.id} data-testid={`card-agreement-${a.id}`} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-serif font-semibold text-foreground">{a.projectName}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[a.status] ?? ""}`}>{a.status}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground mt-2">
                      <span>Landowner: <strong className="text-foreground">{a.landOwnerName}</strong></span>
                      <span>Developer: <strong className="text-foreground">{a.projectDeveloperName}</strong></span>
                      <span>Area: <strong className="text-foreground">{a.landArea} {a.landAreaUnit}</strong></span>
                      <span>Executed: <strong className="text-foreground">{a.executionDate}</strong></span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Notional Value: <strong className="text-foreground">₹{a.landNotionalValue.toLocaleString("en-IN")}</strong> ·
                      Model: <strong className="text-foreground capitalize">{a.revenueModel.replace("_", " ")}</strong>
                    </div>
                  </div>
                  <Link href={`/agreements/${a.id}`}>
                    <Button variant="outline" size="sm" className="gap-1 whitespace-nowrap" data-testid={`button-view-agreement-${a.id}`}>
                      <ExternalLink className="w-3 h-3" /> View
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
