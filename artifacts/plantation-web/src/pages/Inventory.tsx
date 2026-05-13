import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { PackageOpen } from "lucide-react";

export default function Inventory() {
  return (
    <ModulePlaceholder
      icon={PackageOpen}
      module="Inventory"
      description="Manage physical assets, inputs, and materials used across all plantation operations."
      plannedFeatures={[
        { label: "Input Stock", description: "Track fertilisers, chemicals, and consumables by project" },
        { label: "Equipment Registry", description: "Register and track tools, machinery, and vehicles" },
        { label: "Reorder Alerts", description: "Automatic low-stock notifications for critical inputs" },
        { label: "Batch Tracking", description: "Lot-level tracking for inputs with expiry dates" },
        { label: "Inter-project Transfers", description: "Record transfers of assets between plantation sites" },
        { label: "Valuation", description: "Real-time inventory valuation at cost and market price" },
      ]}
    />
  );
}
