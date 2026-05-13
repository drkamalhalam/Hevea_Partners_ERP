import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { Receipt } from "lucide-react";

export default function Expenditure() {
  return (
    <ModulePlaceholder
      icon={Receipt}
      module="Expenditure"
      description="Monitor all operational costs including labour, inputs, equipment, and overhead across plantation projects."
      plannedFeatures={[
        { label: "Expense Categories", description: "Structured categories: labour, inputs, equipment, transport, admin" },
        { label: "Budget vs Actuals", description: "Compare planned budgets against actual spending per project" },
        { label: "Vendor Management", description: "Maintain supplier records and payment history" },
        { label: "Approval Workflow", description: "Multi-level expense approval for large expenditures" },
        { label: "Cost per Hectare", description: "Operational cost analytics normalised by land area" },
        { label: "Monthly Reports", description: "Auto-generated monthly expenditure summaries" },
      ]}
    />
  );
}
