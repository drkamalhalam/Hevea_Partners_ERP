import { Link } from "wouter";
import { useGetMyPortfolio } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@clerk/react";
import { Briefcase, Trees, Percent, FileText } from "lucide-react";

export default function MyPortfolio() {
  const { data: portfolio, isLoading } = useGetMyPortfolio();
  const { user } = useUser();

  if (isLoading) return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">My Portfolio</h1>
        <p className="text-muted-foreground mt-1">
          {user?.fullName ? `${user.fullName}'s` : "Your"} plantation partnership overview
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Agreements</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{portfolio?.agreements.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Land Area</CardTitle>
            <Trees className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{portfolio?.projects?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">kani</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ownership Share</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{portfolio?.agreements?.length ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Your Agreements</CardTitle>
        </CardHeader>
        <CardContent>
          {!portfolio?.agreements.length ? (
            <div className="text-center py-8">
              <Briefcase className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No agreements linked to your account yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Ask your administrator to link your profile to partnership agreements.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {portfolio.agreements.map(a => (
                <div key={a.id} data-testid={`portfolio-agreement-${a.id}`} className="flex items-center justify-between p-4 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors">
                  <div>
                    <p className="font-semibold text-sm font-serif">{a.projectName}</p>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      <span>{a.landArea} {a.landAreaUnit}</span>
                      <span>·</span>
                      <span>₹{a.landNotionalValue.toLocaleString("en-IN")} notional value</span>
                      <span>·</span>
                      <span className="capitalize">{a.revenueModel?.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${a.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>{a.status}</span>
                    <Link href={`/agreements/${a.id}`}><Button variant="outline" size="sm">View</Button></Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
