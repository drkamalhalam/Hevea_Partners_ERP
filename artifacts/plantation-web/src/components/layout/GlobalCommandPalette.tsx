import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useListProjects } from "@workspace/api-client-react";
import { useRole } from "@/contexts/RoleContext";
import { useCommandPalette } from "@/contexts/CommandPaletteContext";
import { ProjectFinancialEntryDialog, type FinancialEntryProject } from "@/components/finance/ProjectFinancialEntryDialog";
import { QuickStockMovementDialog } from "@/components/inventory/QuickStockMovementDialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Trees,
  FileSignature,
  Wallet,
  Receipt,
  Warehouse,
  ShoppingCart,
  Truck,
  Scale,
  Shield,
  UserCog,
  BarChart2,
  FileText,
  FileSearch,
  CircleDollarSign,
  Package,
  ChevronRight,
  Zap,
} from "lucide-react";

// ── Role-gated nav items ────────────────────────────────────────────────────

type NavItem = {
  label: string;
  path: string;
  icon: React.FC<{ className?: string }>;
  roles?: string[];
  keywords?: string;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",        path: "/dashboard",         icon: LayoutDashboard },
  { label: "Projects",         path: "/projects",          icon: Trees },
  { label: "Agreements",       path: "/agreements",        icon: FileSignature, roles: ["admin","developer","landowner","investor"] },
  { label: "Contributions",    path: "/contributions",     icon: Wallet, roles: ["admin","developer"] },
  { label: "Expenditure",      path: "/expenditure",       icon: Receipt, roles: ["admin","developer"] },
  { label: "Inventory",        path: "/inventory",         icon: Warehouse, roles: ["admin","developer","employee","operational_staff"], keywords: "stock movements" },
  { label: "Sales",            path: "/sales",             icon: ShoppingCart, roles: ["admin","developer","employee"], keywords: "revenue" },
  { label: "Distribution",     path: "/distribution",      icon: Truck, roles: ["admin","developer"] },
  { label: "Production Log",   path: "/production-log",    icon: Scale, roles: ["admin","developer","employee","operational_staff"], keywords: "harvest batch" },
  { label: "LCA Config",       path: "/lca/config",        icon: CircleDollarSign, roles: ["admin","developer"], keywords: "land contribution adjustment" },
  { label: "LCA Ledger",       path: "/lca/ledger",        icon: CircleDollarSign, roles: ["admin","developer"] },
  { label: "Analytics Hub",    path: "/analytics-hub",     icon: BarChart2 },
  { label: "Financial Reports",path: "/financial-reports", icon: FileText, roles: ["admin","developer","landowner","investor"] },
  { label: "Documents",        path: "/documents",         icon: FileSearch },
  { label: "Governance",       path: "/governance",        icon: Shield },
  { label: "Stock Register",   path: "/stock",             icon: Package, roles: ["admin","developer","employee","operational_staff"] },
  { label: "Admin Console",    path: "/admin",             icon: UserCog, roles: ["admin"] },
];

// ── Quick actions ────────────────────────────────────────────────────────────

type ActionItem = {
  label: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  color: string;
  action: "financial_entry" | "stock_movement";
  roles?: string[];
};

const ACTION_ITEMS: ActionItem[] = [
  {
    label: "Record Financial Entry",
    description: "Contribution, investment, or operational expense",
    icon: CircleDollarSign,
    color: "text-primary",
    action: "financial_entry",
    roles: ["admin","developer"],
  },
  {
    label: "Log Stock Movement",
    description: "Production inflow, purchase, adjustment, or transfer",
    icon: Warehouse,
    color: "text-teal-600",
    action: "stock_movement",
    roles: ["admin","developer","employee","operational_staff"],
  },
];

// ── GlobalCommandPalette ─────────────────────────────────────────────────────

export default function GlobalCommandPalette() {
  const [, navigate] = useLocation();
  const { role } = useRole();
  const { open, setOpen, pendingAction, triggerAction, clearAction } = useCommandPalette();
  const { data: allProjects = [] } = useListProjects();

  // Financial entry dialog needs FinancialEntryProject shape
  const projects = useMemo<FinancialEntryProject[]>(
    () =>
      allProjects.map((p) => ({
        id: p.id,
        name: p.name,
        commercialModel: p.commercialModel ?? "ownership_contribution",
        lifecycleStatus: p.lifecycleStatus ?? "prematurity",
      })),
    [allProjects],
  );

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [setOpen]);

  // Role-filtered nav items
  const visibleNav = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role),
  );

  // Role-filtered actions
  const visibleActions = ACTION_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role),
  );

  function handleNav(path: string) {
    setOpen(false);
    navigate(path);
  }

  // ── Derive dialog open states from pendingAction ──────────────────────────
  const financialEntryOpen = pendingAction === "financial_entry";
  const stockMovementOpen  = pendingAction === "stock_movement";

  return (
    <>
      {/* ── Command palette dialog ─────────────────────────────────────── */}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, actions, or jump to project…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Quick actions */}
          {visibleActions.length > 0 && (
            <CommandGroup heading="Quick Actions">
              {visibleActions.map((item) => (
                <CommandItem
                  key={item.action}
                  value={`action ${item.label} ${item.description}`}
                  onSelect={() => triggerAction(item.action)}
                  className="gap-3"
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/5 flex-shrink-0">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{item.label}</span>
                      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        Global
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{item.description}</p>
                  </div>
                  <Zap className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandSeparator />

          {/* Navigate */}
          <CommandGroup heading="Navigate">
            {visibleNav.map((item) => (
              <CommandItem
                key={item.path}
                value={`navigate ${item.label} ${item.keywords ?? ""} ${item.path}`}
                onSelect={() => handleNav(item.path)}
                className="gap-2.5"
              >
                <item.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
              </CommandItem>
            ))}
          </CommandGroup>

          {/* Jump to project */}
          {allProjects.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Jump to Project">
                {allProjects.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`project ${p.name} ${p.district ?? ""} ${p.projectCode ?? ""}`}
                    onSelect={() => handleNav(`/projects/${p.id}`)}
                    className="gap-2.5"
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      p.lifecycleStatus === "mature_production"
                        ? "bg-emerald-500"
                        : p.lifecycleStatus === "closed"
                        ? "bg-gray-400"
                        : "bg-violet-400"
                    }`} />
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.district && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{p.district}</span>
                    )}
                    <ChevronRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {/* ── Action sub-dialogs (triggered by palette selection) ──────── */}
      <ProjectFinancialEntryDialog
        open={financialEntryOpen}
        onClose={clearAction}
        projects={projects}
        onSuccess={clearAction}
      />

      <QuickStockMovementDialog
        open={stockMovementOpen}
        onClose={clearAction}
      />
    </>
  );
}
