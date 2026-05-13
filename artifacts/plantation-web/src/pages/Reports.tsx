import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { BarChart3 } from "lucide-react";

export default function Reports() {
  return (
    <ModulePlaceholder
      icon={BarChart3}
      module="Reports"
      description="Generate structured financial, operational, and partner reports for management and compliance."
      plannedFeatures={[
        { label: "Financial Summary", description: "P&L, balance sheet, and cash flow by project and period" },
        { label: "Partner Statements", description: "Individual partner account statements and revenue share reports" },
        { label: "Production Reports", description: "Yield per hectare, tapping efficiency, and grade breakdown" },
        { label: "Compliance Reports", description: "Regulatory and land-lease compliance status reports" },
        { label: "Custom Report Builder", description: "Drag-and-drop report builder with PDF/Excel export" },
        { label: "Scheduled Delivery", description: "Auto-deliver reports to stakeholders on a set schedule" },
      ]}
    />
  );
}
