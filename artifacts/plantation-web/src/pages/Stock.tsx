import { Link } from "wouter";
import {
  useGetStockSummary,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Scale, Warehouse, TrendingUp, TrendingDown, ArrowUpCircle, ArrowDownCircle,
  Info, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Per-type badge colours ────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  rubber_sheet: { label: "Rubber Sheet", color: "text-emerald-700" },
  rubber_scrap: { label: "Rubber Scrap", color: "text-amber-700" },
  latex:        { label: "Latex",        color: "text-blue-700"   },
};

function StockBar({ balance, totalIn }: { balance: number; totalIn: number }) {
  const pct = totalIn > 0 ? Math.min((balance / totalIn) * 100, 100) : 0;
  const color = pct > 30 ? "bg-emerald-500" : pct > 10 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-full bg-muted rounded-full h-1.5 mt-1.5">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Stock() {
  const { data: stock, isLoading } = useGetStockSummary();

  const totalStockKg    = stock?.reduce((s, p) => s + (p.currentStock ?? 0), 0) ?? 0;
  const totalProducedKg = stock?.reduce((s, p) => s + (p.totalProduced ?? 0), 0) ?? 0;
  const totalSoldKg     = stock?.reduce((s, p) => s + (p.totalSold ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Stock Register</h1>
        <p className="text-muted-foreground mt-1">
          Live rubber inventory — balance computed from the canonical movement ledger
        </p>
      </div>

      {/* Canonical source notice */}
      <div className="flex items-start gap-3 p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-sm text-blue-800 dark:text-blue-300">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Stock balances are computed from the inventory movement ledger — not manually entered here.</p>
          <p className="text-xs opacity-80">
            To record production:&nbsp;
            <Link href="/production-log" className="underline underline-offset-2">Production Log</Link>.&nbsp;
            To record sales:&nbsp;
            <Link href="/sales" className="underline underline-offset-2">Sales</Link>.&nbsp;
            To view or create manual movements:&nbsp;
            <Link href="/inventory" className="underline underline-offset-2 inline-flex items-center gap-0.5">
              Inventory&nbsp;<ExternalLink className="w-3 h-3" />
            </Link>.
          </p>
        </div>
      </div>

      {/* Top summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Stock (All)</CardTitle>
            <Warehouse className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold">
                {totalStockKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                <span className="text-base font-normal text-muted-foreground"> kg</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Net confirmed balance across all kg stock types</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Produced</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold text-emerald-700">
                {totalProducedKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                <span className="text-base font-normal text-muted-foreground"> kg</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">All confirmed in-movements (production, opening, etc.)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Dispatched</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold text-red-600">
                {totalSoldKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                <span className="text-base font-normal text-muted-foreground"> kg</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">All confirmed out-movements (sales, wastage, etc.)</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-project stock cards */}
      <div>
        <h2 className="text-lg font-serif font-semibold text-foreground mb-3">Stock Per Project</h2>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
          </div>
        ) : !stock?.length ? (
          <div className="p-12 text-center">
            <Scale className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No stock data yet. Record production entries to see inventory.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stock.map((p) => {
              const byType = (p as any).stockByType as Array<{
                stockType: string; totalIn: number; totalOut: number; balance: number; unit: string;
              }> | undefined;

              const balanceKg = p.currentStock ?? 0;
              const totalInKg = p.totalProduced ?? 0;

              return (
                <Card key={p.projectId} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-serif text-base leading-snug">{p.projectName}</CardTitle>
                    {(p as any).district && (
                      <p className="text-xs text-muted-foreground">{(p as any).district}</p>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Aggregate balance bar */}
                    <div>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-xs text-muted-foreground">Net Balance (kg)</p>
                          <p className={cn(
                            "text-2xl font-bold",
                            balanceKg > 0 ? "text-foreground" : "text-muted-foreground",
                          )}>
                            {balanceKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                          </p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          {totalInKg > 0
                            ? `${((balanceKg / totalInKg) * 100).toFixed(0)}% remaining`
                            : "No production yet"}
                        </div>
                      </div>
                      <StockBar balance={balanceKg} totalIn={totalInKg} />
                    </div>

                    {/* Per-type breakdown */}
                    {byType && byType.length > 0 ? (
                      <div className="space-y-1.5 pt-1 border-t">
                        {byType.map((t) => {
                          const cfg = TYPE_CONFIG[t.stockType] ?? { label: t.stockType, color: "text-slate-600" };
                          return (
                            <div key={t.stockType} className="flex items-center justify-between text-xs">
                              <span className={cn("font-medium", cfg.color)}>{cfg.label}</span>
                              <span className="tabular-nums text-muted-foreground">
                                {t.balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {t.unit}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t">
                        <div className="flex items-center gap-1 text-emerald-700">
                          <ArrowUpCircle className="w-3 h-3" />
                          <span>{(p.totalProduced ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg in</span>
                        </div>
                        <div className="flex items-center gap-1 text-red-600 justify-end">
                          <ArrowDownCircle className="w-3 h-3" />
                          <span>{(p.totalSold ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg out</span>
                        </div>
                      </div>
                    )}

                    {/* Link to detailed movement view */}
                    <Link
                      href={`/inventory?projectId=${p.projectId}`}
                      className="block text-center text-xs text-primary underline-offset-2 hover:underline pt-1"
                    >
                      View movement ledger →
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
