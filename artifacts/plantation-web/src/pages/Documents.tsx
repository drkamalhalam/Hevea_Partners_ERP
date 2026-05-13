import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { Files } from "lucide-react";

export default function Documents() {
  return (
    <ModulePlaceholder
      icon={Files}
      module="Documents"
      description="Centralised repository for all legal, operational, and partner documents across the plantation portfolio."
      plannedFeatures={[
        { label: "Document Library", description: "Upload and organise deeds, permits, maps, and contracts" },
        { label: "Version Control", description: "Track document revisions with full change history" },
        { label: "Access Control", description: "Role-based visibility — partners see only their documents" },
        { label: "Expiry Alerts", description: "Automated reminders for document renewal and compliance deadlines" },
        { label: "Digital Signatures", description: "Integrated e-signature workflow for agreements and addenda" },
        { label: "Linked Records", description: "Link documents directly to projects, partners, or agreements" },
      ]}
    />
  );
}
