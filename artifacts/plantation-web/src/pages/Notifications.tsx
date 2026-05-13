import ModulePlaceholder from "@/components/shared/ModulePlaceholder";
import { Bell } from "lucide-react";

export default function Notifications() {
  return (
    <ModulePlaceholder
      icon={Bell}
      module="Notifications"
      description="System-wide notification centre for alerts, reminders, and communications across the plantation management platform."
      plannedFeatures={[
        { label: "Alert Centre", description: "Consolidated view of all system-generated alerts and reminders" },
        { label: "Custom Rules", description: "Configure notification triggers for specific events or thresholds" },
        { label: "Partner Broadcasts", description: "Send announcements to selected partner groups or roles" },
        { label: "SMS & Email", description: "Deliver critical alerts via SMS and email to stakeholders" },
        { label: "Notification History", description: "Full log of all sent and received notifications" },
        { label: "Preferences", description: "Per-user preferences for notification channels and frequency" },
      ]}
    />
  );
}
