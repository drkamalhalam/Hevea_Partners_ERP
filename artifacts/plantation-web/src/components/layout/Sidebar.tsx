import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderKanban,
  Briefcase,
  FileSignature,
  HandCoins,
  Receipt,
  Scale,
  PackageOpen,
  Warehouse,
  ShoppingCart,
  Truck,
  BarChart3,
  Files,
  Building2,
  Bell,
  ShieldCheck,
  ShieldAlert,
  Sprout,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  LibraryBig,
  Scroll,
  ClipboardList,
  Landmark,
  TrendingUp,
  Archive,
  ArrowLeftRight,
  Coins,
} from "lucide-react";
import { useRole, ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import type { UserRole } from "@/contexts/RoleContext";
import { useSidebar } from "@/contexts/SidebarContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { useListProjects } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Nav item definition ───────────────────────────────────────────────────

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  roles?: UserRole[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Core",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { name: "Projects", href: "/projects", icon: FolderKanban },
      {
        name: "My Portfolio",
        href: "/my-portfolio",
        icon: Briefcase,
        roles: ["landowner", "investor", "employee", "operational_staff"],
      },
      { name: "My Profile", href: "/profile", icon: UserCircle },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        name: "Agreements",
        href: "/agreements",
        icon: FileSignature,
        roles: ["admin", "developer", "landowner", "investor"],
      },
      {
        name: "Templates",
        href: "/templates",
        icon: LibraryBig,
        roles: ["admin", "developer"],
      },
      {
        name: "Activation Tasks",
        href: "/activation",
        icon: ShieldCheck,
        roles: ["admin", "developer"],
      },
      {
        name: "Generate Deed",
        href: "/generate-agreement",
        icon: Scroll,
        roles: ["admin", "developer"],
      },
      {
        name: "Participation Dashboard",
        href: "/contributions/dashboard",
        icon: BarChart3,
        roles: ["admin", "developer", "landowner", "investor"],
      },
      {
        name: "Contributions",
        href: "/contributions",
        icon: HandCoins,
        roles: ["admin", "developer"],
      },
      {
        name: "Land Notional",
        href: "/contributions/land",
        icon: Landmark,
        roles: ["admin", "developer"],
      },
      {
        name: "Economic",
        href: "/contributions/economic",
        icon: TrendingUp,
        roles: ["admin", "developer", "landowner", "investor"],
      },
      {
        name: "Ownership Guidance",
        href: "/ownership",
        icon: Scale,
        roles: ["admin", "developer", "landowner", "investor"] as UserRole[],
      },
      {
        name: "Ownership Archive",
        href: "/ownership/archive",
        icon: Archive,
        roles: ["admin", "developer", "landowner", "investor"] as UserRole[],
      },
      {
        name: "Dispute Centre",
        href: "/contributions/disputes",
        icon: ShieldAlert,
        roles: ["admin", "developer"],
      },
      {
        name: "Expenditure",
        href: "/expenditure",
        icon: Receipt,
        roles: ["admin", "developer", "landowner"],
      },
      {
        name: "Burden Accounting",
        href: "/burden",
        icon: ArrowLeftRight,
        roles: ["admin", "developer"],
      },
      {
        name: "Recoverable Advances",
        href: "/advances",
        icon: HandCoins,
        roles: ["admin", "developer"],
      },
      {
        name: "Exp. Analytics",
        href: "/expenditure-analytics",
        icon: BarChart3,
        roles: ["admin", "developer"],
      },
      {
        name: "Exp. Governance",
        href: "/expenditure-governance",
        icon: ShieldAlert,
        roles: ["admin", "developer"],
      },
      {
        name: "LCA Config",
        href: "/lca",
        icon: Coins,
        roles: ["admin", "developer", "landowner"],
      },
      {
        name: "LCA Ledger",
        href: "/lca/ledger",
        icon: Receipt,
        roles: ["admin", "developer", "landowner"],
      },
      {
        name: "LCA Governance",
        href: "/lca/governance",
        icon: ShieldAlert,
        roles: ["admin", "developer"],
      },
      {
        name: "Landowner Account",
        href: "/landowner-account",
        icon: Landmark,
        roles: ["admin", "developer", "landowner"],
      },
      {
        name: "Burden Recovery",
        href: "/burden-recovery",
        icon: Scale,
        roles: ["admin", "developer", "landowner"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        name: "Production Log",
        href: "/production-log",
        icon: ClipboardList,
        roles: ["admin", "developer", "employee", "operational_staff", "landowner", "investor"],
      },
      {
        name: "Production",
        href: "/production",
        icon: Scale,
        roles: ["admin", "developer", "employee"],
      },
      {
        name: "Inventory",
        href: "/inventory",
        icon: PackageOpen,
        roles: ["admin", "developer", "employee", "operational_staff"],
      },
      {
        name: "Inv. Analytics",
        href: "/inventory-analytics",
        icon: BarChart3,
        roles: ["admin", "developer"],
      },
      {
        name: "Stock",
        href: "/stock",
        icon: Warehouse,
        roles: ["admin", "developer", "employee", "operational_staff"],
      },
      {
        name: "Sales",
        href: "/sales",
        icon: ShoppingCart,
        roles: ["admin", "developer"],
      },
      {
        name: "Sale Audit",
        href: "/sales/audit",
        icon: ShieldCheck,
        roles: ["admin", "developer"],
      },
      {
        name: "Distribution",
        href: "/distribution",
        icon: Truck,
        roles: ["admin", "developer", "landowner", "operational_staff"],
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      {
        name: "Reports",
        href: "/reports",
        icon: BarChart3,
        roles: ["admin", "developer", "investor"],
      },
      {
        name: "Documents",
        href: "/documents",
        icon: Files,
        roles: ["admin", "developer", "landowner", "investor"],
      },
      {
        name: "L/O Profitability",
        href: "/landowner-profitability",
        icon: TrendingUp,
        roles: ["admin", "developer", "landowner"],
      },
    ],
  },
  {
    label: "Governance",
    items: [
      {
        name: "Governance",
        href: "/governance",
        icon: Building2,
        roles: ["admin", "developer"],
      },
      { name: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Admin", href: "/admin", icon: ShieldCheck, roles: ["admin"] },
      {
        name: "Access Audit Log",
        href: "/financial-audit-log",
        icon: ShieldAlert,
        roles: ["admin", "developer"] as UserRole[],
      },
    ],
  },
];

const PROJECT_STATUS_DOT: Record<string, string> = {
  planning: "bg-blue-400",
  developing: "bg-amber-400",
  maturing: "bg-emerald-400",
  tapping: "bg-green-500",
  completed: "bg-gray-400",
};

// ── Sidebar component ─────────────────────────────────────────────────────

export default function Sidebar() {
  const [location] = useLocation();
  const { role, canAccessAllProjects } = useRole();
  const { isCollapsed, toggle } = useSidebar();
  const { selectedProjectId, setSelectedProjectId } = useProjectFilter();
  const { data: projects = [] } = useListProjects();

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden">

        {/* Brand header */}
        <div
          className={cn(
            "flex items-center border-b border-gray-800 flex-shrink-0 h-14",
            isCollapsed ? "justify-center px-0" : "px-4 gap-3"
          )}
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 flex-shrink-0">
            <Sprout className="w-4 h-4 text-white" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-sm font-bold text-white leading-tight truncate">
                Hevea Partners
              </p>
              <p className="text-[10px] text-gray-400 leading-tight truncate">
                Plantation ERP
              </p>
            </div>
          )}
        </div>

        {/* Role badge */}
        {!isCollapsed && (
          <div className="px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
            <span
              className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide",
                ROLE_COLORS[role]
              )}
            >
              {ROLE_LABELS[role]}
            </span>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-gray-900 scrollbar-thumb-gray-700">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.roles || item.roles.includes(role)
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label}>
                {!isCollapsed && (
                  <p className="px-2 mb-1 text-[9px] font-bold uppercase tracking-widest text-gray-600">
                    {group.label}
                  </p>
                )}
                {isCollapsed && <div className="h-px bg-gray-800 mx-1 mb-2" />}

                <div className="space-y-0.5">
                  {visibleItems.map((item) => {
                    const isActive =
                      location === item.href ||
                      location.startsWith(item.href + "/");
                    const Icon = item.icon;

                    const navItem = (
                      <Link key={item.name} href={item.href}>
                        <span
                          className={cn(
                            "flex items-center gap-3 rounded-lg text-sm font-medium cursor-pointer transition-all group",
                            isCollapsed
                              ? "w-10 h-10 justify-center mx-auto"
                              : "px-2.5 py-2",
                            isActive
                              ? "bg-emerald-600 text-white shadow-sm"
                              : "text-gray-400 hover:text-white hover:bg-gray-800"
                          )}
                        >
                          <Icon
                            className={cn(
                              "flex-shrink-0 w-4 h-4",
                              isActive
                                ? "text-white"
                                : "text-gray-500 group-hover:text-gray-300"
                            )}
                          />
                          {!isCollapsed && (
                            <>
                              <span className="flex-1 truncate">{item.name}</span>
                              {isActive && (
                                <ChevronRight className="w-3 h-3 text-white/60 flex-shrink-0" />
                              )}
                            </>
                          )}
                        </span>
                      </Link>
                    );

                    if (isCollapsed) {
                      return (
                        <Tooltip key={item.name}>
                          <TooltipTrigger asChild>{navItem}</TooltipTrigger>
                          <TooltipContent side="right" className="text-xs">
                            {item.name}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return navItem;
                  })}
                </div>
              </div>
            );
          })}

          {/* My Projects mini-list — only for role-restricted users */}
          {!canAccessAllProjects && projects.length > 0 && !isCollapsed && (
            <div>
              <p className="px-2 mb-1 text-[9px] font-bold uppercase tracking-widest text-gray-600">
                My Projects
              </p>
              <div className="space-y-0.5">
                {/* "All" deselect option */}
                <button
                  onClick={() => setSelectedProjectId(null)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                    selectedProjectId === null
                      ? "text-gray-300 bg-gray-800"
                      : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                  )}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0" />
                  <span className="truncate">All Projects</span>
                </button>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() =>
                      setSelectedProjectId(
                        selectedProjectId === p.id ? null : p.id
                      )
                    }
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                      selectedProjectId === p.id
                        ? "bg-emerald-600/20 text-emerald-400"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                    )}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        PROJECT_STATUS_DOT[p.status] ?? "bg-gray-500"
                      )}
                    />
                    <span className="truncate flex-1 text-left">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Collapse toggle */}
        <div className="px-2 pb-3 border-t border-gray-800 pt-2 flex-shrink-0">
          <button
            onClick={toggle}
            className={cn(
              "flex items-center rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-all text-xs font-medium gap-2",
              isCollapsed
                ? "w-10 h-10 justify-center mx-auto"
                : "w-full px-2.5 py-2"
            )}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </div>
    </TooltipProvider>
  );
}
