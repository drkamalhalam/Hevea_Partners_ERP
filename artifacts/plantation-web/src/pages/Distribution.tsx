import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { Truck } from "lucide-react";

export default function Distribution() {
  return (
    <ModulePlaceholder
      icon={Truck}
      module="Distribution"
      description="Plan and track the movement of rubber from plantation sites to processing centres and buyers."
      plannedFeatures={[
        { label: "Dispatch Planning", description: "Schedule and assign vehicles for rubber collection runs" },
        { label: "Route Management", description: "Optimise collection routes across multiple plantation blocks" },
        { label: "Trip Logs", description: "Record trip details including quantity, driver, and departure time" },
        { label: "Delivery Confirmation", description: "Capture buyer acknowledgement and delivery receipts" },
        { label: "Transport Cost Tracking", description: "Log freight costs per trip and link to expenditure module" },
        { label: "Real-time Status", description: "Live dispatch board showing current status of all shipments" },
      ]}
    />
  );
}
