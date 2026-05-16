import { useState } from "react";
import {
  useGetAgreementAccountingProfile,
  useUpsertAgreementAccountingProfile,
  useValidateAgreementAccountingProfile,
  getGetAgreementAccountingProfileQueryKey,
} from "@workspace/api-client-react";
import type {
  AgreementAccountingProfile,
  AccountingProfileValidationResult,
  AccountingProfileValidationCheck,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/contexts/RoleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  FlaskConical,
  Info,
  Minus,
  Banknote,
  TrendingDown,
  Scale,
  GitMerge,
  Pencil,
  Check,
  X,
  Users,
  Landmark,
  RotateCcw,
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────

function validationStatusBadge(status: string) {
  switch (status) {
    case "valid":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs gap-1"><CheckCircle2 className="h-3 w-3" /> Valid</Badge>;
    case "warning":
      return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 text-xs gap-1"><AlertTriangle className="h-3 w-3" /> Warning</Badge>;
    case "invalid":
      return <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-xs gap-1"><XCircle className="h-3 w-3" /> Invalid</Badge>;
    default:
      return <Badge className="bg-gray-500/15 text-gray-400 border-gray-500/30 text-xs gap-1"><Minus className="h-3 w-3" /> Pending</Badge>;
  }
}

function checkIcon(status: AccountingProfileValidationCheck["status"]) {
  switch (status) {
    case "pass": return <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />;
    case "warn": return <AlertTriangle className="h-4 w-4 text-yellow-400 flex-shrink-0 mt-0.5" />;
    case "fail": return <XCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />;
  }
}

function FlagRow({
  label,
  hint,
  value,
  onChange,
  editable,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  editable: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-700/50 last:border-0">
      <div className="flex items-center gap-2">
        <Label className="text-sm text-gray-300 cursor-default">{label}</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-gray-500 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs bg-gray-800 border-gray-700 text-gray-200">
              {hint}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {editable && onChange ? (
        <Switch checked={value} onCheckedChange={onChange} />
      ) : (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${value ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-700 text-gray-400"}`}>
          {value ? "Yes" : "No"}
        </span>
      )}
    </div>
  );
}

// ── Contribution model flow diagram ──────────────────────────────────────────

function ContributionFlowDiagram({ profile }: { profile: AgreementAccountingProfile }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2 text-blue-300 font-medium text-center">
          Gross Revenue
        </div>
      </div>
      {profile.costsChargedBeforeDistribution && (
        <>
          <div className="flex items-center gap-2 pl-4">
            <ArrowRight className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
            <div className="flex-1 flex items-center gap-2">
              <Minus className="h-3.5 w-3.5 text-red-400" />
              <span className="text-gray-300">Operating Costs</span>
              <span className="text-xs text-gray-500">(charged before distribution)</span>
            </div>
          </div>
        </>
      )}
      {profile.lcaApplicable && profile.lcaChargedBeforeDistribution && (
        <div className="flex items-center gap-2 pl-4">
          <ArrowRight className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
          <div className="flex-1 flex items-center gap-2">
            <Minus className="h-3.5 w-3.5 text-red-400" />
            <span className="text-gray-300">LCA (Annual Land Contribution Adjustment)</span>
            <span className="text-xs text-gray-500">(charged before distribution)</span>
          </div>
        </div>
      )}
      {!profile.costsChargedBeforeDistribution && !profile.lcaChargedBeforeDistribution && (
        <div className="pl-4 text-xs text-gray-500 italic">No deductions before distribution</div>
      )}
      <div className="flex items-center gap-2 pl-2">
        <div className="h-6 border-l-2 border-dashed border-gray-600 ml-2" />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-emerald-500/10 border border-emerald-500/30 rounded px-3 py-2 text-emerald-300 font-medium text-center">
          Distributable Profit Pool
        </div>
      </div>
      <div className="pl-4 text-xs text-gray-500">→ Split by ownership / contribution stakes</div>
    </div>
  );
}

// ── 50% Revenue model flow diagram ───────────────────────────────────────────

function FiftyPercentFlowDiagram({ profile }: { profile: AgreementAccountingProfile }) {
  const lo  = Number(profile.grossSplitPctLandowner).toFixed(0);
  const epp = Number(profile.grossSplitPctDeveloper).toFixed(0);   // field stores EPP share
  return (
    <div className="space-y-2 text-sm">
      {/* Gross Revenue */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded px-3 py-2 text-blue-300 font-medium text-center">
        Gross Revenue
      </div>

      {/* Split arrow */}
      <div className="flex items-center gap-2 pl-3">
        <GitMerge className="h-4 w-4 text-gray-500 flex-shrink-0" />
        <span className="text-xs text-gray-400">First split — before any cost deductions</span>
      </div>

      {/* Two branches */}
      <div className="grid grid-cols-2 gap-3">

        {/* Left: Landowner */}
        <div className="space-y-1.5">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2 text-amber-300 font-medium text-center text-xs">
            <Landmark className="h-3.5 w-3.5 inline mr-1 mb-0.5" />
            Landowner {lo}%
          </div>
          {profile.landownerBearsCostSeparately && (
            <div className="flex items-center gap-1 text-xs text-gray-400 pl-2">
              <Minus className="h-3 w-3 text-red-400 flex-shrink-0" />
              Reimbursable advances deducted
            </div>
          )}
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1.5 text-emerald-300 text-xs text-center">
            Landowner Net
          </div>
        </div>

        {/* Right: Economic Participant Pool */}
        <div className="space-y-1.5">
          <div className="bg-purple-500/10 border border-purple-500/30 rounded px-3 py-2 text-purple-300 font-medium text-center text-xs">
            <Users className="h-3.5 w-3.5 inline mr-1 mb-0.5" />
            Economic Pool {epp}%
          </div>
          <div className="bg-purple-900/20 border border-purple-700/30 rounded px-2 py-1.5 space-y-0.5">
            <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">
              Distributed proportionally among:
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-300">
              <ArrowRight className="h-2.5 w-2.5 text-purple-400 flex-shrink-0" /> Developers
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-300">
              <ArrowRight className="h-2.5 w-2.5 text-purple-400 flex-shrink-0" /> Investors
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-300">
              <ArrowRight className="h-2.5 w-2.5 text-purple-400 flex-shrink-0" /> Other participants
            </div>
            <div className="text-[10px] text-gray-500 mt-1 italic">
              Share % per finalized contribution structure
            </div>
          </div>
          {profile.developerBearsCostSeparately && (
            <div className="flex items-center gap-1 text-xs text-gray-400 pl-2">
              <Minus className="h-3 w-3 text-red-400 flex-shrink-0" />
              Reimbursable advances deducted from pool
            </div>
          )}
        </div>
      </div>

      {/* Governance notices */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-start gap-1.5 bg-yellow-500/5 border border-yellow-500/20 rounded px-2.5 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-yellow-200/70 leading-snug">
            <span className="font-semibold">LCA not applicable</span> — Land Contribution Adjustment is a
            contribution-model obligation only.
          </p>
        </div>
        <div className="flex items-start gap-1.5 bg-slate-500/10 border border-slate-500/20 rounded px-2.5 py-2">
          <Landmark className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-300/70 leading-snug">
            <span className="font-semibold">Land Notional Value recorded but inactive</span> — LNV is preserved
            for audit continuity and future model switching; it does not drive ownership calculations under this model.
          </p>
        </div>
        <div className="flex items-start gap-1.5 bg-blue-500/5 border border-blue-500/20 rounded px-2.5 py-2">
          <RotateCcw className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-200/70 leading-snug">
            <span className="font-semibold">Post-maturity contributions</span> — payments made after project
            maturity do not create ownership share; they are classified as reimbursable project costs and
            tracked separately from economic entitlement.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AgreementAccountingProfile({ agreementId }: { agreementId: string }) {
  const { role } = useRole();
  const qc = useQueryClient();
  const isEditor = role === "admin" || role === "developer";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<{
    costsChargedBeforeDistribution: boolean;
    lcaChargedBeforeDistribution: boolean;
    grossSplitPctLandowner: number;
    grossSplitPctDeveloper: number;
    landownerBearsCostSeparately: boolean;
    developerBearsCostSeparately: boolean;
  }>>({});
  const [validationResult, setValidationResult] = useState<AccountingProfileValidationResult | null>(null);

  const { data: profile, isLoading } = useGetAgreementAccountingProfile(agreementId, {
    query: { enabled: !!agreementId, queryKey: getGetAgreementAccountingProfileQueryKey(agreementId) },
  });

  const upsertMutation = useUpsertAgreementAccountingProfile({
    mutation: {
      onSuccess: (updated) => {
        qc.invalidateQueries({ queryKey: getGetAgreementAccountingProfileQueryKey(agreementId) });
        setEditing(false);
        setDraft({});
      },
    },
  });

  const validateMutation = useValidateAgreementAccountingProfile({
    mutation: {
      onSuccess: (result) => {
        qc.invalidateQueries({ queryKey: getGetAgreementAccountingProfileQueryKey(agreementId) });
        setValidationResult(result);
      },
    },
  });

  function handleSave() {
    upsertMutation.mutate({ id: agreementId, data: draft });
  }

  function handleValidate() {
    setValidationResult(null);
    validateMutation.mutate({ id: agreementId });
  }

  function cancelEdit() {
    setEditing(false);
    setDraft({});
  }

  if (isLoading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-5">
          <div className="h-4 w-48 bg-gray-700 rounded animate-pulse mb-2" />
          <div className="h-32 bg-gray-700 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }
  if (!profile) return null;

  const isContribution = profile.accountingModel === "contribution";
  const effective = { ...profile, ...draft };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <Scale className="h-5 w-5 text-blue-400" />
            Accounting Profile
          </CardTitle>
          <div className="flex items-center gap-2">
            {validationStatusBadge(profile.validationStatus)}
            {isEditor && (
              <>
                {!editing ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(true)}
                    className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1.5 h-7 text-xs"
                  >
                    <Pencil className="h-3 w-3" /> Edit Flags
                  </Button>
                ) : (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={upsertMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 gap-1 h-7 text-xs"
                    >
                      <Check className="h-3 w-3" /> Save
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cancelEdit}
                      className="border-gray-600 text-gray-300 hover:bg-gray-700 h-7 text-xs"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidate}
                  disabled={validateMutation.isPending}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700 gap-1.5 h-7 text-xs"
                >
                  <FlaskConical className="h-3 w-3" />
                  {validateMutation.isPending ? "Validating…" : "Validate"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Model badge */}
        <div className="flex items-center gap-2 mt-2">
          {isContribution ? (
            <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs">
              Contribution / Ownership Model
            </Badge>
          ) : (
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">
              50% Revenue Split Model
            </Badge>
          )}
          {profile.lcaApplicable && (
            <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30 text-xs">
              LCA Applicable
            </Badge>
          )}
          <span className="text-xs text-gray-500 ml-1">
            Configured by {profile.configuredByName}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Accounting flow diagram */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Accounting Flow
            </p>
            {isContribution
              ? <ContributionFlowDiagram profile={effective as AgreementAccountingProfile} />
              : <FiftyPercentFlowDiagram profile={effective as AgreementAccountingProfile} />
            }
          </div>

          {/* Model flags */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Behavior Flags
            </p>

            {isContribution ? (
              <div>
                <FlagRow
                  label="Costs charged before distribution"
                  hint="When enabled, operating costs are deducted from gross revenue before computing the distributable profit pool."
                  value={effective.costsChargedBeforeDistribution ?? true}
                  editable={editing}
                  onChange={(v) => setDraft((d) => ({ ...d, costsChargedBeforeDistribution: v }))}
                />
                <FlagRow
                  label="LCA charged before distribution"
                  hint="When enabled, the annual Land Contribution Adjustment is deducted from gross revenue before computing the distributable profit pool."
                  value={effective.lcaChargedBeforeDistribution ?? true}
                  editable={editing}
                  onChange={(v) => setDraft((d) => ({ ...d, lcaChargedBeforeDistribution: v }))}
                />
                <FlagRow
                  label="LCA applicable"
                  hint="Auto-set by validation: true when the project has an active LCA configuration."
                  value={profile.lcaApplicable}
                  editable={false}
                />
              </div>
            ) : (
              <div>
                {editing ? (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-gray-400 mb-1 block">Landowner gross split %</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={effective.grossSplitPctLandowner ?? 50}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          setDraft((d) => ({
                            ...d,
                            grossSplitPctLandowner: v,
                            grossSplitPctDeveloper: Math.round((100 - v) * 10) / 10,
                          }));
                        }}
                        className="bg-gray-700 border-gray-600 text-white h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-400 mb-1 block">Economic Participant Pool gross split %</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={effective.grossSplitPctDeveloper ?? 50}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          setDraft((d) => ({
                            ...d,
                            grossSplitPctDeveloper: v,
                            grossSplitPctLandowner: Math.round((100 - v) * 10) / 10,
                          }));
                        }}
                        className="bg-gray-700 border-gray-600 text-white h-8 text-sm"
                      />
                    </div>
                    {Math.abs((effective.grossSplitPctLandowner ?? 50) + (effective.grossSplitPctDeveloper ?? 50) - 100) > 0.01 && (
                      <p className="text-xs text-red-400">
                        Split must sum to exactly 100% (currently {((effective.grossSplitPctLandowner ?? 50) + (effective.grossSplitPctDeveloper ?? 50)).toFixed(1)}%)
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="py-2.5 border-b border-gray-700/50">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Landowner gross split</span>
                        <span className="font-semibold text-amber-300">{Number(profile.grossSplitPctLandowner).toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="py-2.5 border-b border-gray-700/50">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Economic Participant Pool gross split</span>
                        <span className="font-semibold text-purple-300">{Number(profile.grossSplitPctDeveloper).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                )}
                <FlagRow
                  label="Landowner advances costs separately"
                  hint="The landowner may advance operational costs from their own gross allocation. Such advances are tracked as reimbursable project costs — separate from economic entitlement — and are recovered before net distribution."
                  value={effective.landownerBearsCostSeparately ?? true}
                  editable={editing}
                  onChange={(v) => setDraft((d) => ({ ...d, landownerBearsCostSeparately: v }))}
                />
                <FlagRow
                  label="Participants advance costs from pool"
                  hint="Economic participants (developers, investors, or others) may advance operational costs from their pool share. Such advances become reimbursable project costs tracked separately from ownership or economic entitlement."
                  value={effective.developerBearsCostSeparately ?? true}
                  editable={editing}
                  onChange={(v) => setDraft((d) => ({ ...d, developerBearsCostSeparately: v }))}
                />
                <FlagRow
                  label="LCA applicable"
                  hint="Always false for the 50% revenue model. Land Contribution Adjustment is a contribution-model obligation only and does not apply here."
                  value={false}
                  editable={false}
                />
                <FlagRow
                  label="LNV active for ownership calculations"
                  hint="Always false for the 50% revenue model. Land Notional Value is recorded and preserved for audit continuity and future model switching, but it does not drive ownership calculations under this model."
                  value={false}
                  editable={false}
                />
              </div>
            )}
          </div>
        </div>

        {/* Validation Results Panel */}
        {(validationResult || profile.validationNotes) && (
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-750 px-4 py-2.5 border-b border-gray-700 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Validation Results
              </p>
              {validationResult && (
                <span className="text-xs text-gray-500">
                  {new Date().toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="p-4 space-y-2">
              {validationResult?.checks.map((check) => (
                <div key={check.checkId} className="flex items-start gap-2">
                  {checkIcon(check.status)}
                  <div>
                    <span className="text-xs font-semibold text-gray-300">{check.label}</span>
                    <p className="text-xs text-gray-400 mt-0.5">{check.message}</p>
                  </div>
                </div>
              ))}
              {!validationResult && profile.validationNotes && (
                <p className="text-xs text-gray-400 leading-relaxed">{profile.validationNotes}</p>
              )}
            </div>
          </div>
        )}

        {/* Architecture note */}
        <div className="bg-gray-700/30 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">Architecture note:</span>{" "}
            {isContribution
              ? "Contribution model: costs and LCA reduce a shared profit pool before distribution. Profit is split by ownership or contribution stakes."
              : "50% Revenue model: gross revenue is split first — 50% to the landowner, 50% to the Economic Participant Pool. The pool is then distributed proportionally among developers, investors, and other economic participants based on finalized contribution shares. No single participant is a fixed beneficiary of the entire pool. Operational costs may be advanced by any participant and are tracked as reimbursable project costs, separate from economic entitlement. LCA does not apply. Land Notional Value is recorded and preserved for audit and governance continuity but is inactive for ownership calculations under this model. Post-maturity contributions do not create ownership share — they are reimbursable project costs only."
            }{" "}
            Final distribution calculations are not computed here — this panel defines the accounting structure only.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
