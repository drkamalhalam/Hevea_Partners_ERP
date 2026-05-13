import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value?: string | number;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  trend?: { value: number; label?: string };
  isLoading?: boolean;
  onClick?: () => void;
}

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
  trend,
  isLoading,
  onClick,
}: MetricCardProps) {
  const trendPositive = trend && trend.value > 0;
  const trendNegative = trend && trend.value < 0;
  const trendNeutral = trend && trend.value === 0;

  return (
    <Card
      className={cn(
        "border border-gray-200 shadow-none bg-white transition-shadow",
        onClick && "cursor-pointer hover:shadow-md hover:border-gray-300"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
              {label}
            </p>
            {isLoading ? (
              <>
                <Skeleton className="h-8 w-20 mt-2 mb-1" />
                <Skeleton className="h-3 w-24" />
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-foreground mt-1.5 tabular-nums leading-none">
                  {value ?? "—"}
                </p>
                {(sub || trend) && (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {trend && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full",
                          trendPositive && "bg-emerald-50 text-emerald-700",
                          trendNegative && "bg-red-50 text-red-600",
                          trendNeutral && "bg-gray-100 text-gray-500"
                        )}
                      >
                        {trendPositive && <TrendingUp className="w-2.5 h-2.5" />}
                        {trendNegative && <TrendingDown className="w-2.5 h-2.5" />}
                        {trendNeutral && <Minus className="w-2.5 h-2.5" />}
                        {Math.abs(trend.value)}%
                      </span>
                    )}
                    {sub && (
                      <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className={cn("p-2.5 rounded-xl flex-shrink-0", iconColor)}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
