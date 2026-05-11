import { useState } from "react";
import { Link } from "wouter";
import { useListPartners, useCreatePartner, getListPartnersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, Users, Phone, Mail, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const roleColors: Record<string, string> = {
  project_developer: "bg-purple-100 text-purple-800",
  landowner: "bg-emerald-100 text-emerald-800",
  investor: "bg-blue-100 text-blue-800",
};

const formSchema = z.object({
  name: z.string().min(2),
  role: z.enum(["project_developer", "landowner", "investor"]),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().min(5),
  aadhaarLast4: z.string().max(4).optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function Partners() {
  const { data: partners, isLoading } = useListPartners();
  const createPartner = useCreatePartner();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", role: "landowner", email: "", phone: "", address: "", aadhaarLast4: "", notes: "" },
  });

  function onSubmit(values: FormValues) {
    createPartner.mutate({ data: values as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
        toast({ title: "Partner registered successfully" });
        setOpen(false);
        form.reset();
      },
      onError: () => toast({ title: "Failed to register partner", variant: "destructive" }),
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Partners</h1>
          <p className="text-muted-foreground mt-1">Project developers, landowners, and investors</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-register-partner" className="gap-2">
              <Plus className="w-4 h-4" /> Register Partner
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-serif">Register New Partner</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input data-testid="input-partner-name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger data-testid="select-partner-role"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="project_developer">Project Developer</SelectItem>
                        <SelectItem value="landowner">Landowner</SelectItem>
                        <SelectItem value="investor">Investor</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input data-testid="input-partner-email" type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl><Input data-testid="input-partner-phone" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl><Textarea data-testid="input-partner-address" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="aadhaarLast4" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aadhaar (Last 4 digits)</FormLabel>
                    <FormControl><Input data-testid="input-aadhaar" maxLength={4} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl><Textarea data-testid="input-partner-notes" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" data-testid="button-submit-partner" disabled={createPartner.isPending}>
                    {createPartner.isPending ? "Registering..." : "Register"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !partners?.length ? (
        <Card className="py-16 text-center">
          <Users className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground">No partners registered yet.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {partners.map(partner => (
            <Card key={partner.id} data-testid={`card-partner-${partner.id}`} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="font-serif text-lg">{partner.name}</CardTitle>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleColors[partner.role] ?? "bg-gray-100 text-gray-800"}`}>
                    {partner.role.replace("_", " ")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="w-3 h-3" />{partner.email}
                </div>
                {partner.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-3 h-3" />{partner.phone}
                  </div>
                )}
                <p className="text-xs text-muted-foreground line-clamp-1">{partner.address}</p>
                <Link href={`/partners/${partner.id}`}>
                  <Button variant="outline" size="sm" className="w-full gap-1 mt-2" data-testid={`button-view-partner-${partner.id}`}>
                    <ExternalLink className="w-3 h-3" /> View Profile
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
