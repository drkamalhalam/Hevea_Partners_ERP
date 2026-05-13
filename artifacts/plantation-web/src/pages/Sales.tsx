import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { ShoppingCart } from "lucide-react";

export default function Sales() {
  return (
    <ModulePlaceholder
      icon={ShoppingCart}
      module="Sales"
      description="Manage rubber sales orders, buyer relationships, pricing, and invoicing across all projects."
      plannedFeatures={[
        { label: "Sales Orders", description: "Create and manage RSS and latex rubber sales orders" },
        { label: "Buyer Directory", description: "Maintain a registry of approved buyers and their contacts" },
        { label: "Pricing Engine", description: "Market-linked pricing with grade and quality adjustments" },
        { label: "Invoice Generation", description: "Auto-generate and dispatch sales invoices" },
        { label: "Payment Tracking", description: "Track payment status and outstanding receivables" },
        { label: "Sales Analytics", description: "Revenue trends, buyer analysis, and price benchmarking" },
      ]}
    />
  );
}
