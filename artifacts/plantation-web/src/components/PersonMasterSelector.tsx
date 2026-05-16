import { useState } from "react";
import {
  useListPersonMaster,
  useCreatePersonMaster,
  getListPersonMasterQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Search, CheckCircle2, X, Plus, User, Loader2, ShieldCheck, ShieldAlert, Clock } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";

export type PersonSummary = {
  id: string;
  fullName: string;
  sOnCOn?: string | null;
  fatherGuardianName?: string | null;
  aadhaarLast4?: string | null;
  mobile?: string | null;
  email?: string | null;
  district?: string | null;
  state?: string | null;
  kycStatus: "pending" | "documents_submitted" | "verified" | "flagged";
  createdAt: string;
};

export function derivePersonId(id: string, createdAt: string) {
  const year = new Date(createdAt).getFullYear();
  const num = (parseInt(id.replace(/-/g, "").slice(0, 5), 16) % 100000)
    .toString()
    .padStart(5, "0");
  return `PRS-${year}-${num}`;
}

const KYC_CONFIG: Record<
  string,
  { label: string; icon: typeof Clock; className: string }
> = {
  pending: { label: "KYC Pending", icon: Clock, className: "bg-amber-100 text-amber-800 border-amber-200" },
  documents_submitted: { label: "Docs Submitted", icon: Clock, className: "bg-blue-100 text-blue-800 border-blue-200" },
  verified: { label: "Verified", icon: ShieldCheck, className: "bg-green-100 text-green-800 border-green-200" },
  flagged: { label: "Flagged", icon: ShieldAlert, className: "bg-red-100 text-red-800 border-red-200" },
};

function KycBadge({ status }: { status: string }) {
  const cfg = KYC_CONFIG[status] ?? KYC_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${cfg.className}`}>
      <Icon className="w-2.5 h-2.5 mr-0.5" />
      {cfg.label}
    </Badge>
  );
}

function PersonCard({
  person,
  onUse,
  compact = false,
}: {
  person: PersonSummary;
  onUse?: () => void;
  compact?: boolean;
}) {
  const pid = derivePersonId(person.id, person.createdAt);
  return (
    <div className={`border rounded-lg bg-white ${compact ? "p-3" : "p-3.5"} space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-slate-900 truncate">{person.fullName}</p>
            <KycBadge status={person.kycStatus} />
          </div>
          {(person.sOnCOn || person.fatherGuardianName) && (
            <p className="text-xs text-slate-500 mt-0.5">
              {person.sOnCOn} {person.fatherGuardianName}
            </p>
          )}
        </div>
        <p className="text-[10px] text-slate-400 font-mono shrink-0">{pid}</p>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
        {person.mobile && <span>📞 {person.mobile}</span>}
        {person.aadhaarLast4 && <span>🪪 ••••{person.aadhaarLast4}</span>}
        {person.district && (
          <span>
            📍 {person.district}
            {person.state ? `, ${person.state}` : ""}
          </span>
        )}
      </div>
      {onUse && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs mt-1 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
          onClick={onUse}
        >
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Use this identity
        </Button>
      )}
    </div>
  );
}

type CreateFormState = {
  fullName: string;
  sOnCOn: string;
  fatherGuardianName: string;
  aadhaarNumber: string;
  mobile: string;
  email: string;
  permanentAddress: string;
};

const EMPTY_CREATE_FORM: CreateFormState = {
  fullName: "",
  sOnCOn: "S/O",
  fatherGuardianName: "",
  aadhaarNumber: "",
  mobile: "",
  email: "",
  permanentAddress: "",
};

export interface PersonMasterSelectorProps {
  selectedPerson: PersonSummary | null;
  onSelect: (person: PersonSummary | null) => void;
  label?: string;
}

export function PersonMasterSelector({
  selectedPerson,
  onSelect,
  label,
}: PersonMasterSelectorProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const debouncedQuery = useDebounce(query, 350);
  const createPerson = useCreatePersonMaster();

  const searchEnabled = debouncedQuery.length >= 2;
  const isDigitOnly = /^\d+$/.test(debouncedQuery);
  const isAadhaar = isDigitOnly && debouncedQuery.length >= 4 && debouncedQuery.length <= 12;
  const isMobile = isDigitOnly && debouncedQuery.length >= 6 && debouncedQuery.length > 4;

  const { data: searchResults, isFetching } = useListPersonMaster(
    {
      q: !isDigitOnly ? debouncedQuery : undefined,
      aadhaar: isAadhaar ? debouncedQuery : undefined,
      mobile: isMobile && !isAadhaar ? debouncedQuery : undefined,
      limit: 10,
    },
    {
      query: {
        enabled: searchEnabled,
        queryKey: getListPersonMasterQueryKey({
          q: !isDigitOnly ? debouncedQuery : undefined,
          aadhaar: isAadhaar ? debouncedQuery : undefined,
          mobile: isMobile && !isAadhaar ? debouncedQuery : undefined,
          limit: 10,
        }),
      },
    },
  );

  const results = (searchResults as PersonSummary[] | undefined) ?? [];

  const handleCreate = () => {
    if (createForm.fullName.trim().length < 2) {
      toast({ title: "Full name is required (min 2 characters)", variant: "destructive" });
      return;
    }
    createPerson.mutate(
      {
        data: {
          fullName: createForm.fullName.trim(),
          sOnCOn: createForm.sOnCOn || undefined,
          fatherGuardianName: createForm.fatherGuardianName || undefined,
          aadhaarNumber: createForm.aadhaarNumber || undefined,
          mobile: createForm.mobile || undefined,
          email: createForm.email || undefined,
          permanentAddress: createForm.permanentAddress || undefined,
        },
      },
      {
        onSuccess: (data) => {
          toast({ title: "Person registered successfully" });
          onSelect(data as PersonSummary);
          setShowCreate(false);
          setQuery("");
          setCreateForm(EMPTY_CREATE_FORM);
        },
        onError: (err: any) => {
          const errData = err?.response?.data;
          const msg =
            errData?.existingId
              ? `Duplicate detected — a person with this Aadhaar/mobile already exists (${errData.existingId})`
              : errData?.error ?? "Failed to register person";
          toast({ title: msg, variant: "destructive" });
        },
      },
    );
  };

  if (selectedPerson) {
    return (
      <div className="space-y-2">
        {label && <p className="text-sm font-medium text-slate-700">{label}</p>}
        <div className="relative">
          <PersonCard person={selectedPerson} compact />
          <div className="absolute top-2 right-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              onClick={() => {
                onSelect(null);
                setQuery("");
              }}
            >
              <X className="w-3 h-3 mr-0.5" /> Change
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-1.5">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          Linked to Person Registry —{" "}
          {derivePersonId(selectedPerson.id, selectedPerson.createdAt)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {label && <p className="text-sm font-medium text-slate-700">{label}</p>}

      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-indigo-600 shrink-0" />
          <p className="text-sm font-semibold text-indigo-900">Search Person Registry</p>
        </div>
        <p className="text-xs text-indigo-700 leading-relaxed">
          Search by name (≥ 2 chars), Aadhaar number, or mobile number. All participants must
          originate from the Person Registry.
        </p>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowCreate(false);
            }}
            placeholder="Name, Aadhaar, or mobile..."
            className="pl-8 bg-white border-indigo-200 focus-visible:ring-indigo-400"
          />
          {isFetching && (
            <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-indigo-400 animate-spin pointer-events-none" />
          )}
        </div>

        {searchEnabled && !showCreate && (
          <div className="space-y-2">
            {results.length === 0 && !isFetching ? (
              <div className="text-center py-3 text-xs text-slate-500">
                No records found for &ldquo;{debouncedQuery}&rdquo;
              </div>
            ) : (
              results.map((p) => (
                <PersonCard
                  key={p.id}
                  person={p}
                  onUse={() => {
                    onSelect(p);
                    setQuery("");
                  }}
                />
              ))
            )}
          </div>
        )}

        {!showCreate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-100"
            onClick={() => {
              setShowCreate(true);
              setCreateForm((f) => ({ ...f, fullName: query }));
            }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Register New Person
          </Button>
        ) : (
          <div className="border border-indigo-300 rounded-lg p-4 bg-white space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Register New Person</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setShowCreate(false)}
              >
                <X className="w-3 h-3 mr-0.5" /> Cancel
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Full Legal Name *</Label>
                <Input
                  value={createForm.fullName}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, fullName: e.target.value }))
                  }
                  placeholder="As per Aadhaar card"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Relation</Label>
                <Select
                  value={createForm.sOnCOn}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, sOnCOn: v }))}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="S/O">S/O — Son of</SelectItem>
                    <SelectItem value="D/O">D/O — Daughter of</SelectItem>
                    <SelectItem value="W/O">W/O — Wife of</SelectItem>
                    <SelectItem value="C/O">C/O — Care of</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Father / Guardian</Label>
                <Input
                  value={createForm.fatherGuardianName}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, fatherGuardianName: e.target.value }))
                  }
                  placeholder="Father or guardian's name"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Aadhaar Number</Label>
                <Input
                  value={createForm.aadhaarNumber}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      aadhaarNumber: e.target.value.replace(/\D/g, "").slice(0, 12),
                    }))
                  }
                  placeholder="12-digit Aadhaar"
                  className="h-8 text-sm font-mono tracking-widest"
                  maxLength={12}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mobile Number</Label>
                <Input
                  value={createForm.mobile}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      mobile: e.target.value.replace(/\D/g, "").slice(0, 10),
                    }))
                  }
                  placeholder="10-digit mobile"
                  className="h-8 text-sm"
                  maxLength={10}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="Optional email address"
                  className="h-8 text-sm"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Permanent Address</Label>
                <Textarea
                  value={createForm.permanentAddress}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, permanentAddress: e.target.value }))
                  }
                  placeholder="Complete permanent address"
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={createPerson.isPending || createForm.fullName.trim().length < 2}
              onClick={handleCreate}
            >
              {createPerson.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              Register &amp; Link to Project
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
