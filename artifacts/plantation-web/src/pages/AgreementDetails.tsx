import { useRoute, Link } from "wouter";
import { useGetAgreement, getGetAgreementQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MapPin } from "lucide-react";
import AgreementVariablePanel from "./AgreementVariablePanel";
import AgreementGeneratePanel from "./AgreementGeneratePanel";

const statusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  active: "bg-green-100 text-green-800",
  matured: "bg-blue-100 text-blue-800",
  terminated: "bg-red-100 text-red-800",
};

export default function AgreementDetails() {
  const [, params] = useRoute("/agreements/:id");
  const id = params?.id ?? "";
  const { data: agreement, isLoading } = useGetAgreement(id, { query: { enabled: !!id, queryKey: getGetAgreementQueryKey(id) } });

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-96 rounded-xl" /></div>;

  if (!agreement) return (
    <div className="text-center py-16">
      <p className="text-muted-foreground">Agreement not found.</p>
      <Link href="/agreements"><Button variant="outline" className="mt-4">Back to Agreements</Button></Link>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <Link href="/agreements"><Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="w-4 h-4" /> Agreements</Button></Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Partnership Deed</h1>
          <p className="text-muted-foreground mt-1">Project: {agreement.projectName}</p>
        </div>
        <span className={`text-sm px-3 py-1 rounded-full font-medium capitalize ${statusColors[agreement.status] ?? ""}`}>{agreement.status}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Land Area</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{agreement.landArea} <span className="text-base font-normal text-muted-foreground">{agreement.landAreaUnit}</span></p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Notional Land Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">₹{agreement.landNotionalValue.toLocaleString("en-IN")}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Revenue Model</CardTitle></CardHeader>
          <CardContent><p className="text-lg font-semibold capitalize">{agreement.revenueModel?.replace(/_/g, " ")}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="font-serif">Parties</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-xs text-muted-foreground mb-1">Project Developer (First Party)</p>
              <p className="font-semibold">{agreement.projectDeveloperName}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border">
              <p className="text-xs text-muted-foreground mb-1">Landowner (Second Party)</p>
              <p className="font-semibold">{agreement.landOwnerName}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-serif">Agreement Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Execution Date</dt><dd className="font-medium">{agreement.executionDate}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Execution Place</dt><dd className="font-medium">{agreement.executionPlace}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Term</dt><dd className="font-medium">{agreement.termYears} years</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Value Per Unit</dt><dd className="font-medium">₹{agreement.landValuePerUnit.toLocaleString("en-IN")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">LCA Per Unit/Year</dt><dd className="font-medium">₹{agreement.landContributionAdjustment.toLocaleString("en-IN")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Yearly Escalation</dt><dd className="font-medium">{agreement.yearlyEscalation}%</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {(agreement.ownershipShareLandowner != null || agreement.ownershipShareDeveloper != null) && (
        <Card>
          <CardHeader><CardTitle className="font-serif">Ownership Shares (Post-Maturity)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                <p className="text-xs text-muted-foreground mb-1">Landowner Share</p>
                <p className="text-3xl font-bold text-emerald-700">{agreement.ownershipShareLandowner?.toFixed(1)}%</p>
              </div>
              <div className="text-center p-4 rounded-lg bg-purple-50 border border-purple-200">
                <p className="text-xs text-muted-foreground mb-1">Developer Share</p>
                <p className="text-3xl font-bold text-purple-700">{agreement.ownershipShareDeveloper?.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <AgreementVariablePanel agreementId={id} />

      <AgreementGeneratePanel agreementId={id} />

      {(agreement.northBoundary || agreement.southBoundary || agreement.eastBoundary || agreement.westBoundary) && (
        <Card>
          <CardHeader><CardTitle className="font-serif">Land Boundaries (Schedule A)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {agreement.northBoundary && <div><p className="text-muted-foreground text-xs">North</p><p className="font-medium">{agreement.northBoundary}</p></div>}
              {agreement.southBoundary && <div><p className="text-muted-foreground text-xs">South</p><p className="font-medium">{agreement.southBoundary}</p></div>}
              {agreement.eastBoundary && <div><p className="text-muted-foreground text-xs">East</p><p className="font-medium">{agreement.eastBoundary}</p></div>}
              {agreement.westBoundary && <div><p className="text-muted-foreground text-xs">West</p><p className="font-medium">{agreement.westBoundary}</p></div>}
            </div>
            {agreement.gpsLat && agreement.gpsLng && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t text-sm text-muted-foreground">
                <MapPin className="w-4 h-4" />
                <span>GPS: {agreement.gpsLat.toFixed(4)}°N, {agreement.gpsLng.toFixed(4)}°E</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {agreement.notes && (
        <Card>
          <CardHeader><CardTitle className="font-serif">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{agreement.notes}</p></CardContent>
        </Card>
      )}
    </div>
  );
}
