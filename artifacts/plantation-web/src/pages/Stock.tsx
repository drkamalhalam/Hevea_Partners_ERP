import { Link } from "wouter";
import {
  useGetStockSummary,
  useListProductionRecords,
  useCreateProductionRecord,
  useDeleteProductionRecord,
  useListProjects,
  getListProductionRecordsQueryKey,
  getGetStockSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import {
  Plus, Scale, ShoppingCart, Warehouse, TrendingUp, TrendingDown, Trash2, BadgeIndianRupee, ArrowUpCircle, ArrowDownCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";

const formSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  recordedAt: z.string().min(1, "Date & time required"),
  productionKg: z.coerce.number().min(0, "Must be ≥ 0"),
  soldKg: z.coerce.number().min(0, "Must be ≥ 0"),
  sellingPricePerKg: z.coerce.number().min(0),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function StockBar({ produced, sold, stock }: { produced: number; sold: number; stock: number }) {
  const pct = produced > 0 ? Math.min((stock / produced) * 100, 100) : 0;
  const color = pct > 30 ? "bg-emerald-500" : pct > 10 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-muted rounded-full h-2 mt-2">
      <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Stock() {
  const { data: stock, isLoading: isLoadingStock } = useGetStockSummary();
  const { data: records, isLoading: isLoadingRecords } = useListProductionRecords();
  const { data: projects } = useListProjects();
  const createRecord = useCreateProductionRecord();
  const deleteRecord = useDeleteProductionRecord();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

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
    createRecord.mutate({ data: { ...values, recordedAt: new Date(values.recordedAt).toISOString() } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductionRecordsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStockSummaryQueryKey() });
        toast({ title: "Record logged — stock updated" });
        setOpen(false);
        form.reset({ projectId: "", recordedAt: new Date().toISOString().slice(0, 16), productionKg: 0, soldKg: 0, sellingPricePerKg: 0, notes: "" });
      },
      onError: () => toast({ title: "Failed to log record", variant: "destructive" }),
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this record? Stock will be recalculated.")) return;
    deleteRecord.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProductionRecordsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetStockSummaryQueryKey() });
        toast({ title: "Record deleted — stock updated" });
      },
    });
  }

  const totalStock = stock?.reduce((s, p) => s + (p.currentStock ?? 0), 0) ?? 0;
  const totalProduced = stock?.reduce((s, p) => s + (p.totalProduced ?? 0), 0) ?? 0;
  const totalSold = stock?.reduce((s, p) => s + (p.totalSold ?? 0), 0) ?? 0;

  // Movement log for selected project (or all)
  const movements = (records ?? [])
    .filter(r => selectedProject === null || r.projectId === selectedProject)
    .map(r => ({
      ...r,
      stockChange: (r.productionKg ?? 0) - (r.soldKg ?? 0),
    }))
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

  // Running stock over time for the selected project (or first with data)
  const chartProject = selectedProject ?? (stock?.find(s => (s.totalProduced ?? 0) > 0)?.projectId ?? null);
  const chartRecords = (records ?? [])
    .filter(r => r.projectId === chartProject)
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  let runningStock = 0;
  const chartData = chartRecords.map(r => {
    runningStock += (r.productionKg ?? 0) - (r.soldKg ?? 0);
    return {
      date: format(new Date(r.recordedAt), "dd MMM"),
      stock: Math.max(runningStock, 0),
    };
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Stock Register</h1>
          <p className="text-muted-foreground mt-1">Live rubber inventory — updates automatically with every production & sale entry</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-log-stock" className="gap-2">
              <Plus className="w-4 h-4" /> Log Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-serif">Log Production / Sale</DialogTitle>
              <DialogDescription className="sr-only">Enter details to record a new stock movement.</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="projectId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v)} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-stock-project"><SelectValue placeholder="Select plantation" /></SelectTrigger></FormControl>
                      <SelectContent>{projects?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="recordedAt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date & Time</FormLabel>
                    <FormControl><Input type="datetime-local" data-testid="input-stock-date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="productionKg" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5 text-emerald-700">
                        <ArrowUpCircle className="w-3.5 h-3.5" /> Produced (kg)
                      </FormLabel>
                      <FormControl><Input type="number" step="0.01" data-testid="input-stock-produced" placeholder="0.00" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="soldKg" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5 text-red-600">
                        <ArrowDownCircle className="w-3.5 h-3.5" /> Sold (kg)
                      </FormLabel>
                      <FormControl><Input type="number" step="0.01" data-testid="input-stock-sold" placeholder="0.00" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="sellingPricePerKg" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <BadgeIndianRupee className="w-3.5 h-3.5 text-muted-foreground" /> Selling Price / kg (₹)
                    </FormLabel>
                    <FormControl><Input type="number" step="0.01" data-testid="input-stock-price" placeholder="0.00" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {previewRevenue > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                    <span className="text-sm font-medium text-emerald-800">Computed Revenue</span>
                    <span className="text-lg font-bold text-emerald-700">₹{previewRevenue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl><Textarea data-testid="input-stock-notes" placeholder="Buyer, grade, batch…" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" data-testid="button-submit-stock" disabled={createRecord.isPending}>
                    {createRecord.isPending ? "Saving…" : "Save & Update Stock"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Top summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Stock (All)</CardTitle>
            <Warehouse className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingStock ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold">{totalStock.toLocaleString("en-IN", { maximumFractionDigits: 1 })} <span className="text-base font-normal text-muted-foreground">kg</span></div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Produced</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoadingStock ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold text-emerald-700">{totalProduced.toLocaleString("en-IN", { maximumFractionDigits: 1 })} <span className="text-base font-normal text-muted-foreground">kg</span></div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sold</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {isLoadingStock ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold text-red-600">{totalSold.toLocaleString("en-IN", { maximumFractionDigits: 1 })} <span className="text-base font-normal text-muted-foreground">kg</span></div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-project stock cards */}
      <div>
        <h2 className="text-lg font-serif font-semibold text-foreground mb-3">Stock Per Project</h2>
        {isLoadingStock ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {stock?.map(p => {
              const stockPct = (p.totalProduced ?? 0) > 0 ? ((p.currentStock ?? 0) / (p.totalProduced ?? 0)) * 100 : 0;
              const isSelected = selectedProject === p.projectId;
              return (
                <Card
                  key={p.projectId}
                  data-testid={`card-stock-${p.projectId}`}
                  className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedProject(isSelected ? null : p.projectId)}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="font-serif text-base leading-snug">{p.projectName}</CardTitle>
                    <p className="text-xs text-muted-foreground">{p.projectName}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Current Stock</p>
                        <p className={`text-2xl font-bold ${(p.currentStock ?? 0) > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                          {(p.currentStock ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">{stockPct.toFixed(0)}% remaining</p>
                      </div>
                    </div>
                    <StockBar produced={p.totalProduced ?? 0} sold={p.totalSold ?? 0} stock={p.currentStock ?? 0} />
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div className="flex items-center gap-1 text-emerald-700">
                        <ArrowUpCircle className="w-3 h-3" />
                        <span>{(p.totalProduced ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg produced</span>
                      </div>
                      <div className="flex items-center gap-1 text-red-600 justify-end">
                        <ArrowDownCircle className="w-3 h-3" />
                        <span>{(p.totalSold ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg sold</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {selectedProject !== null && (
          <p className="text-xs text-muted-foreground mt-2">Showing movement log for selected project. Click the card again to clear filter.</p>
        )}
      </div>

      {/* Running stock chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif">
              Stock Level Over Time — {stock?.find(s => s.projectId === chartProject)?.projectName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16a34a" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" kg" />
                <RechartsTooltip formatter={(v: number) => [`${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`, "Stock"]} />
                <Area type="monotone" dataKey="stock" stroke="#16a34a" strokeWidth={2} fill="url(#stockGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Movement log */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle className="font-serif">Movement Log</CardTitle>
          {selectedProject !== null && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedProject(null)}>Show all projects</Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoadingRecords ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : !movements.length ? (
            <div className="text-center py-10">
              <Warehouse className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No entries yet. Click "Log Entry" to add your first production or sale.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs uppercase tracking-wider">
                    <th className="text-left py-2 pr-3 font-medium">Date & Time</th>
                    <th className="text-left py-2 pr-3 font-medium">Project</th>
                    <th className="text-right py-2 pr-3 font-medium text-emerald-700">+ In (kg)</th>
                    <th className="text-right py-2 pr-3 font-medium text-red-600">− Out (kg)</th>
                    <th className="text-right py-2 pr-3 font-medium">Net Change</th>
                    <th className="text-right py-2 pr-3 font-medium">Revenue</th>
                    <th className="py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {movements.map(r => (
                    <tr key={r.id} data-testid={`row-stock-${r.id}`} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{format(new Date(r.recordedAt), "dd MMM yyyy")}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(r.recordedAt), "HH:mm")}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="font-medium">{r.projectName}</span>
                        {r.notes && <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{r.notes}</div>}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-emerald-700 font-medium">
                        +{(r.productionKg ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-red-600 font-medium">
                        −{(r.soldKg ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">
                        <span className={`font-semibold ${(r.stockChange ?? 0) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {(r.stockChange ?? 0) >= 0 ? "+" : ""}{(r.stockChange ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">
                        {(r.revenue ?? 0) > 0 ? <span className="font-semibold">₹{(r.revenue ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-3 text-right">
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-7 w-7 p-0"
                          data-testid={`button-delete-stock-${r.id}`}
                          onClick={() => handleDelete(r.id)}>
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
