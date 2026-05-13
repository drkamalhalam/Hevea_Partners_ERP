import { LucideIcon, Construction } from "lucide-react";

interface Feature {
  label: string;
  description: string;
}

interface ModulePlaceholderProps {
  icon: LucideIcon;
  module: string;
  description: string;
  plannedFeatures: Feature[];
}

export default function ModulePlaceholder({
  icon: Icon,
  module,
  description,
  plannedFeatures,
}: ModulePlaceholderProps) {
  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{module}</h1>
        </div>
        <p className="text-muted-foreground">{description}</p>
      </div>

      {/* Under construction card */}
      <div className="flex-1 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center py-16 px-8 bg-muted/20">
        <div className="max-w-lg w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 mb-6">
            <Construction className="w-8 h-8 text-amber-600" />
          </div>

          <h2 className="text-xl font-semibold text-foreground mb-2">Module Under Development</h2>
          <p className="text-sm text-muted-foreground mb-10">
            The <strong>{module}</strong> module is part of the planned ERP architecture and will be
            available in a future release.
          </p>

          {/* Planned features grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
            {plannedFeatures.map((f) => (
              <div
                key={f.label}
                className="bg-background border border-border rounded-lg px-4 py-3"
              >
                <p className="text-sm font-medium text-foreground mb-0.5">{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
