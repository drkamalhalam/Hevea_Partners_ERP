import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject, useDeleteProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, MapPin, Trees, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800 border-blue-200",
  developing: "bg-amber-100 text-amber-800 border-amber-200",
  maturing: "bg-emerald-100 text-emerald-800 border-emerald-200",
  tapping: "bg-green-100 text-green-800 border-green-200",
  completed: "bg-gray-100 text-gray-800 border-gray-200",
};

const formSchema = z.object({
  name: z.string().min(2, "Name required"),
  location: z.string().min(2, "Location required"),
  village: z.string().optional(),
  district: z.string().min(2, "District required"),
  state: z.string().min(2, "State required"),
  landArea: z.coerce.number().positive("Must be positive"),
  landAreaUnit: z.string().min(1),
  landNotionalValue: z.coerce.number().optional(),
  landValuePerUnit: z.coerce.number().optional(),
  status: z.enum(["planning", "developing", "maturing", "tapping", "completed"]),
  startDate: z.string().min(1, "Start date required"),
  expectedMaturityDate: z.string().optional(),
  termYears: z.coerce.number().int().positive(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", location: "", village: "", district: "", state: "Tripura",
      landArea: 0, landAreaUnit: "kani", status: "planning", startDate: "",
      termYears: 35, notes: "",
    },
  });

  function onSubmit(values: FormValues) {
    createProject.mutate({ data: values as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created successfully" });
        setOpen(false);
        form.reset();
      },
      onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
    });
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`Delete project "${name}"?`)) return;
    deleteProject.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project deleted" });
      },
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Plantation Projects</h1>
          <p className="text-muted-foreground mt-1">All active rubber plantation ventures</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-project" className="gap-2">
              <Plus className="w-4 h-4" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-serif">Create Plantation Project</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Project Name</FormLabel>
                      <FormControl><Input data-testid="input-project-name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="location" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl><Input data-testid="input-location" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="village" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Village / Mouja</FormLabel>
                      <FormControl><Input data-testid="input-village" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="district" render={({ field }) => (
                    <FormItem>
                      <FormLabel>District</FormLabel>
                      <FormControl><Input data-testid="input-district" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="state" render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl><Input data-testid="input-state" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="landArea" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Land Area</FormLabel>
                      <FormControl><Input data-testid="input-land-area" type="number" step="0.1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="landAreaUnit" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-land-unit"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="kani">Kani</SelectItem>
                          <SelectItem value="acre">Acre</SelectItem>
                          <SelectItem value="hectare">Hectare</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="status" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="planning">Planning</SelectItem>
                          <SelectItem value="developing">Developing</SelectItem>
                          <SelectItem value="maturing">Maturing</SelectItem>
                          <SelectItem value="tapping">Tapping</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl><Input data-testid="input-start-date" type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="expectedMaturityDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected Maturity Date</FormLabel>
                      <FormControl><Input data-testid="input-maturity-date" type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="termYears" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Term (Years)</FormLabel>
                      <FormControl><Input data-testid="input-term-years" type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="landValuePerUnit" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Land Value Per Unit (INR)</FormLabel>
                      <FormControl><Input data-testid="input-land-value" type="number" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Textarea data-testid="input-notes" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" data-testid="button-submit-project" disabled={createProject.isPending}>
                    {createProject.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : !projects?.length ? (
        <Card className="py-16 text-center">
          <Trees className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No plantation projects yet. Create the first one.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} data-testid={`card-project-${project.id}`} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="font-serif text-lg leading-tight">{project.name}</CardTitle>
                  <span className={`text-xs px-2 py-1 rounded-full border font-medium capitalize whitespace-nowrap ${statusColors[project.status] ?? ""}`}>
                    {project.status}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  {project.village ? `${project.village}, ` : ""}{project.district}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Land Area</p>
                    <p className="font-semibold">{project.landArea} {project.landAreaUnit}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Term</p>
                    <p className="font-semibold">{project.termYears} years</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Started</p>
                    <p className="font-semibold">{project.startDate}</p>
                  </div>
                  {project.expectedMaturityDate && (
                    <div>
                      <p className="text-muted-foreground text-xs">Maturity</p>
                      <p className="font-semibold">{project.expectedMaturityDate}</p>
                    </div>
                  )}
                </div>
                {project.notes && <p className="text-xs text-muted-foreground line-clamp-2">{project.notes}</p>}
                <div className="flex gap-2 pt-1">
                  <Link href={`/projects/${project.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full gap-1" data-testid={`button-view-project-${project.id}`}>
                      <ExternalLink className="w-3 h-3" /> View Details
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                    data-testid={`button-delete-project-${project.id}`}
                    onClick={() => handleDelete(project.id, project.name)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
