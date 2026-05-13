import { useState } from "react";
import {
  useListProductionRecords,
  useCreateProductionRecord,
  useDeleteProductionRecord,
  useListProjects,
  getListProductionRecordsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import {
  Plus, Trash2, Scale, ShoppingCart, BadgeIndianRupee, TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const formSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  recordedAt: z.string().min(1, "Date & time required"),
  productionKg: z.coerce.number().positive("Must be positive"),
  soldKg: z.coerce.number().positive("Must be positive"),
  sellingPricePerKg: z.coerce.number().positive("Must be positive"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function Production() {
  const { data: records, isLoading } = useListProductionRecords();
  const { data: projects } = useListProjects();
  const createRecord = useCreateProductionRecord();
  const deleteRecord = useDeleteProductionRecord();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [filterProject, setFilterProject] = useState<string>("all");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectId: "",
      recordedAt: new Date().toISOString().slice(0, 16),
      productionKg: 0,
      soldKg: 0,
      sellingPricePerKg: 0,
      notes: "",
    },
  });

  const watchedSoldKg = form.watch("soldKg");
  const watchedPrice = form.watch("sellingPricePerKg");
  const previewRevenue = (watchedSoldKg || 0) * (watchedPrice || 0);

  function onSubmit(values: FormValues) {
    const payload = {
      ...values,
      recordedAt: new Date(values.recordedAt).toISOString(),
    };
    createRecord.mutate({ data: payload as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductionRecordsQueryKey() });
        toast({ title: "Production record logged successfully" });
        setOpen(false);
        form.reset({
          projectId: "",
          recordedAt: new Date().toISOString().slice(0, 16),
          productionKg: 0,
          soldKg: 0,
          sellingPricePerKg: 0,
          notes: "",
        });
      },
      onError: () => toast({ title: "Failed to log record", variant: "destructive" }),
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this production record?")) return;
    deleteRecord.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductionRecordsQueryKey() });
        toast({ title: "Record deleted" });
      },
    });
  }

  const filtered = filterProject === "all"
    ? (records ?? [])
    : (records ?? []).filter(r => String(r.projectId) === filterProject);

  const totalProduction = filtered.reduce((s, r) => s + r.productionKg, 0);
  const totalSold = filtered.reduce((s, r) => s + r.soldKg, 0);
  const totalRevenue = filtered.reduce((s, r) => s + r.revenue, 0);

  // Chart data: aggregate by month
  const chartMap: Record<string, { month: string; production: number; sold: number; revenue: number }> = {};
  filtered.forEach(r => {
    const key = format(new Date(r.recordedAt), "MMM yy");
    if (!chartMap[key]) chartMap[key] = { month: key, production: 0, sold: 0, revenue: 0 };
    chartMap[key].production += r.productionKg;
    chartMap[key].sold += r.soldKg;
    chartMap[key].revenue += r.revenue;
  });
  const chartData = Object.values(chartMap).slice(-12);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Production & Sales</h1>
          <p className="text-muted-foreground mt-1">Track rubber production, sales quantity, and revenue</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-log-production" className="gap-2">
              <Plus className="w-4 h-4" /> Log Record
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-serif">Log Production & Sale</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="projectId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v)} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-production-project">
                          <SelectValue placeholder="Select plantation project" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects?.map(p => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="recordedAt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date & Time of Sale</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" data-testid="input-recorded-at" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="productionKg" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Scale className="w-3.5 h-3.5 text-muted-foreground" />
                        Production (kg)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" data-testid="input-production-kg" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="soldKg" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <ShoppingCart className="w-3.5 h-3.5 text-muted-foreground" />
                        Sold (kg)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" data-testid="input-sold-kg" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="sellingPricePerKg" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <BadgeIndianRupee className="w-3.5 h-3.5 text-muted-foreground" />
                      Selling Price per kg (₹)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" data-testid="input-price-per-kg" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {previewRevenue > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                    <span className="text-sm font-medium text-emerald-800">Computed Revenue</span>
                    <span className="text-lg font-bold text-emerald-700">
                      ₹{previewRevenue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea data-testid="input-production-notes" placeholder="Buyer name, batch info, quality grade…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" data-testid="button-submit-production" disabled={createRecord.isPending}>
                    {createRecord.isPending ? "Saving…" : "Save Record"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Produced</CardTitle>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProduction.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sold</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSold.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif">Monthly Production vs. Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit=" kg" />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [
                    `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`,
                    name === "production" ? "Produced" : "Sold",
                  ]}
                />
                <Legend formatter={(v) => v === "production" ? "Produced (kg)" : "Sold (kg)"} />
                <Bar dataKey="production" fill="#86efac" radius={[3, 3, 0, 0]} />
                <Bar dataKey="sold" fill="#16a34a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Filter + Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="font-serif">Records</CardTitle>
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-48" data-testid="select-filter-project">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects?.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : !filtered.length ? (
            <div className="text-center py-12">
              <Scale className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No production records yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Log Record" to add your first entry.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="text-left py-2 pr-4 font-medium">Date & Time</th>
                    <th className="text-left py-2 pr-4 font-medium">Project</th>
                    <th className="text-right py-2 pr-4 font-medium">Produced (kg)</th>
                    <th className="text-right py-2 pr-4 font-medium">Sold (kg)</th>
                    <th className="text-right py-2 pr-4 font-medium">Price/kg</th>
                    <th className="text-right py-2 pr-4 font-medium">Revenue</th>
                    <th className="py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} data-testid={`row-production-${r.id}`} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{format(new Date(r.recordedAt), "dd MMM yyyy")}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(r.recordedAt), "HH:mm")}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-medium">{r.projectName}</span>
                        {r.notes && (
                          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.notes}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {r.productionKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {r.soldKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                        ₹{r.sellingPricePerKg.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">
                        <span className="font-semibold text-emerald-700">
                          ₹{r.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive h-7 w-7 p-0"
                          data-testid={`button-delete-production-${r.id}`}
                          onClick={() => handleDelete(r.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
