import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Menu,
  LogOut,
  Settings,
  User,
  ChevronRight,
  Bell,
} from "lucide-react";
import Sidebar from "./Sidebar";
import { useRole, ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";

const PAGE_TITLES: Record<string, { label: string; parent?: string }> = {
  "/dashboard": { label: "Dashboard" },
  "/projects": { label: "Projects", parent: "Core" },
  "/agreements": { label: "Agreements", parent: "Finance" },
  "/contributions": { label: "Contributions", parent: "Finance" },
  "/expenditure": { label: "Expenditure", parent: "Finance" },
  "/inventory": { label: "Inventory", parent: "Operations" },
  "/sales": { label: "Sales", parent: "Operations" },
  "/distribution": { label: "Distribution", parent: "Operations" },
  "/reports": { label: "Reports", parent: "Analytics" },
  "/documents": { label: "Documents", parent: "Analytics" },
  "/governance": { label: "Governance", parent: "Governance" },
  "/notifications": { label: "Notifications", parent: "Governance" },
  "/admin": { label: "Admin", parent: "System" },
  "/partners": { label: "Partners", parent: "Core" },
  "/my-portfolio": { label: "My Portfolio", parent: "Core" },
  "/production": { label: "Production & Sales", parent: "Operations" },
  "/stock": { label: "Stock Register", parent: "Operations" },
};

function Breadcrumb() {
  const [location] = useLocation();
  const basePath = Object.keys(PAGE_TITLES)
    .filter((k) => location === k || location.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const page = basePath ? PAGE_TITLES[basePath] : null;

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0">
      <span className="font-medium text-foreground truncate">
        {page?.label ?? "Hevea Partners"}
      </span>
      {page?.parent && (
        <>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
          <span className="text-muted-foreground/70 hidden sm:block truncate">{page.parent}</span>
        </>
      )}
    </nav>
  );
}

export default function Navbar() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { role } = useRole();

  const initials =
    (user?.firstName?.charAt(0) ?? "") + (user?.lastName?.charAt(0) ?? "");

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-4 border-b bg-white px-4 sm:px-6 shadow-sm">
      {/* Mobile menu */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden -ml-1 h-8 w-8">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 bg-gray-950">
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumb />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 flex items-center gap-2 px-2 rounded-lg">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.imageUrl} alt={user?.fullName ?? ""} />
                <AvatarFallback className="text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-xs font-medium text-foreground leading-none">
                  {user?.firstName ?? "User"}
                </span>
              </div>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal py-2">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold leading-none">{user?.fullName ?? "User"}</p>
                <p className="text-xs text-muted-foreground leading-none truncate">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
                <span className={cn("inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide", ROLE_COLORS[role])}>
                  {ROLE_LABELS[role]}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 cursor-pointer">
              <User className="h-4 w-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 cursor-pointer">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="gap-2 text-destructive focus:text-destructive cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
