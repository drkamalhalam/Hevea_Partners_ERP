import { useRoute, Link } from "wouter";
import { useGetPartner, useListAgreements, getGetPartnerQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Mail, Phone, MapPin, IdCard } from "lucide-react";

const roleColors: Record<string, string> = {
  project_developer: "bg-purple-100 text-purple-800",
  landowner: "bg-emerald-100 text-emerald-800",
  investor: "bg-blue-100 text-blue-800",
};

export default function PartnerDetails() {
  const [, params] = useRoute("/partners/:id");
  const id = params?.id ?? "";
  const { data: partner, isLoading } = useGetPartner(id, { query: { enabled: !!id, queryKey: getGetPartnerQueryKey(id) } });
  const { data: agreements } = useListAgreements();

  const partnerAgreements = agreements?.filter(a => a.landOwnerId === id || a.projectDeveloperId === id) ?? [];

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  if (!partner) return (
    <div className="text-center py-16">
      <p className="text-muted-foreground">Partner not found.</p>
      <Link href="/partners"><Button variant="outline" className="mt-4">Back to Partners</Button></Link>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <Link href="/partners"><Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="w-4 h-4" /> Partners</Button></Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{partner.name}</h1>
          <span className={`text-sm px-3 py-1 rounded-full font-medium capitalize inline-block mt-2 ${roleColors[partner.role] ?? "bg-gray-100 text-gray-800"}`}>
            {partner.role.replace("_", " ")}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="font-serif">Contact Information</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3"><Mail className="w-4 h-4 text-muted-foreground" /><span className="text-sm">{partner.email}</span></div>
            {partner.phone && <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-muted-foreground" /><span className="text-sm">{partner.phone}</span></div>}
            <div className="flex items-start gap-3"><MapPin className="w-4 h-4 text-muted-foreground mt-0.5" /><span className="text-sm">{partner.address}</span></div>
            {partner.aadhaarLast4 && <div className="flex items-center gap-3"><IdCard className="w-4 h-4 text-muted-foreground" /><span className="text-sm">Aadhaar: ****{partner.aadhaarLast4}</span></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-serif">Partnership Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Total Agreements</p>
                <p className="text-2xl font-bold">{partnerAgreements.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Total Land Area</p>
                <p className="text-2xl font-bold">{partnerAgreements.reduce((s, a) => s + a.landArea, 0).toFixed(1)} kani</p>
              </div>
            </div>
            {partner.notes && <p className="text-sm text-muted-foreground mt-4 pt-4 border-t">{partner.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-serif">Agreements</CardTitle></CardHeader>
        <CardContent>
          {!partnerAgreements.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">No agreements yet.</p>
          ) : (
            <div className="space-y-3">
              {partnerAgreements.map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{a.projectName}</p>
                    <p className="text-xs text-muted-foreground">{a.landArea} {a.landAreaUnit} · Executed {a.executionDate}</p>
                  </div>
                  <Link href={`/agreements/${a.id}`}><Button variant="ghost" size="sm">View</Button></Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
