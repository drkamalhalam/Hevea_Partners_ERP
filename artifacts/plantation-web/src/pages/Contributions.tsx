import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { HandCoins } from "lucide-react";

export default function Contributions() {
  return (
    <ModulePlaceholder
      icon={HandCoins}
      module="Contributions"
      description="Track capital contributions from landowners, investors, and project developers across all plantation projects."
      plannedFeatures={[
        { label: "Capital Ledger", description: "Record and track cash and in-kind contributions per partner" },
        { label: "Contribution Schedule", description: "Planned vs. actual contribution timeline tracking" },
        { label: "Partner Share Calculator", description: "Auto-calculate ownership shares based on contributions" },
        { label: "Payment Receipts", description: "Generate and archive contribution receipts" },
        { label: "Multi-project View", description: "Consolidated contribution dashboard across all projects" },
        { label: "Audit Trail", description: "Full history of all contribution entries and modifications" },
      ]}
    />
  );
}
