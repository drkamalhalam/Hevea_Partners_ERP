import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  FolderKanban,
  FileSignature,
  HandCoins,
  Receipt,
  PackageOpen,
  ShoppingCart,
  Truck,
  BarChart3,
  Files,
  Building2,
  Bell,
  ShieldCheck,
  Sprout,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useRole, ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import { useSidebar } from "@/contexts/SidebarContext";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
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
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Agreements", href: "/agreements", icon: FileSignature },
      { name: "Contributions", href: "/contributions", icon: HandCoins },
      { name: "Expenditure", href: "/expenditure", icon: Receipt },
    ],
  },
  {
    label: "Operations",
    items: [
      { name: "Inventory", href: "/inventory", icon: PackageOpen },
      { name: "Sales", href: "/sales", icon: ShoppingCart },
      { name: "Distribution", href: "/distribution", icon: Truck },
    ],
  },
  {
    label: "Analytics",
    items: [
      { name: "Reports", href: "/reports", icon: BarChart3 },
      { name: "Documents", href: "/documents", icon: Files },
    ],
  },
  {
    label: "Governance",
    items: [
      { name: "Governance", href: "/governance", icon: Building2 },
      { name: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Admin", href: "/admin", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

export default function Sidebar() {
  const [location] = useLocation();
  const { role, isAdmin } = useRole();
  const { isCollapsed, toggle } = useSidebar();

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-hidden">
        {/* Brand header */}
        <div
          className={cn(
            "flex items-center border-b border-gray-800 flex-shrink-0 h-14",
            isCollapsed ? "px-0 justify-center" : "px-4 gap-3"
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
        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto overflow-x-hidden">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.adminOnly || isAdmin
            );
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label}>
                {!isCollapsed && (
                  <p className="px-2 mb-1 text-[9px] font-bold uppercase tracking-widest text-gray-600">
                    {group.label}
                  </p>
                )}
                {isCollapsed && (
                  <div className="h-px bg-gray-800 mx-1 mb-2" />
                )}
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
                              "flex-shrink-0",
                              isCollapsed ? "w-4.5 h-4.5" : "w-4 h-4",
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
