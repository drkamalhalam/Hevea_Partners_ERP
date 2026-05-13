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
  ChevronRight,
} from "lucide-react";
import { useRole, ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";

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

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-y-auto">
      {/* Brand */}
      <div className="px-4 py-5 flex items-center gap-3 border-b border-gray-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 flex-shrink-0">
          <Sprout className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white leading-tight">Hevea Partners</p>
          <p className="text-[10px] text-gray-400 leading-tight truncate">Plantation ERP</p>
        </div>
      </div>

      {/* Role badge */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide", ROLE_COLORS[role])}>
            {ROLE_LABELS[role]}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-5">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !item.adminOnly || isAdmin
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.label}>
              <p className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive =
                    location === item.href || location.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <Link key={item.name} href={item.href}>
                      <span
                        className={cn(
                          "flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all group",
                          isActive
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-gray-400 hover:text-white hover:bg-gray-800"
                        )}
                      >
                        <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-white" : "text-gray-500 group-hover:text-gray-300")} />
                        <span className="flex-1 truncate">{item.name}</span>
                        {isActive && <ChevronRight className="w-3 h-3 text-white/60 flex-shrink-0" />}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800">
        <p className="text-[10px] text-gray-600 text-center">v2.0 · Multi-project ERP</p>
      </div>
    </div>
  );
}
