import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Trees, 
  Users, 
  FileText, 
  Briefcase, 
  ShieldCheck,
  Sprout,
  Scale
} from "lucide-react";
import { useUser } from "@clerk/react";

export default function Sidebar() {
  const [location] = useLocation();
  const { user } = useUser();

  const navigation = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "My Portfolio", href: "/my-portfolio", icon: Briefcase },
    { name: "Projects", href: "/projects", icon: Trees },
    { name: "Partners", href: "/partners", icon: Users },
    { name: "Agreements", href: "/agreements", icon: FileText },
    { name: "Production & Sales", href: "/production", icon: Scale },
  ];

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border text-sidebar-foreground">
      <div className="p-6 flex items-center gap-3">
        <div className="bg-sidebar-primary text-sidebar-primary-foreground p-2 rounded-md">
          <Sprout className="w-5 h-5" />
        </div>
        <span className="font-serif font-bold text-lg tracking-tight">Hevea Partners</span>
      </div>

      <div className="px-4 pb-4">
        <p className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-4 px-2">Menu</p>
        <nav className="flex flex-col gap-1">
          {navigation.map((item) => {
            const isActive = location.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.name} href={item.href}>
                <span className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium ${
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                }`}>
                  <Icon className="w-4 h-4" />
                  {item.name}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-sidebar-border">
        <Link href="/admin">
          <span className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium ${
            location.startsWith("/admin")
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
          }`}>
            <ShieldCheck className="w-4 h-4" />
            Admin Overview
          </span>
        </Link>
      </div>
    </div>
  );
}
