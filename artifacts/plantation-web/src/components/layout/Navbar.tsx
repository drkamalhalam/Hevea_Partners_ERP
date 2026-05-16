import { useState } from "react"; // used by ProjectSelector + NotificationsDropdown sub-components
import { useUser, useClerk } from "@clerk/react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useCommandPalette } from "@/contexts/CommandPaletteContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  Menu,
  LogOut,
  Settings,
  User,
  Bell,
  Search,
  Trees,
  ChevronDown,
  Check,
  Command,
} from "lucide-react";
import Sidebar from "./Sidebar";
import { useRole, ROLE_LABELS, ROLE_COLORS } from "@/contexts/RoleContext";
import { useProjectFilter } from "@/contexts/ProjectFilterContext";
import { useListProjects } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ── Page title map ────────────────────────────────────────────────────────

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
  "/admin": { label: "Admin Console", parent: "System" },
  "/partners": { label: "Partners", parent: "Core" },
  "/my-portfolio": { label: "My Portfolio", parent: "Core" },
  "/production": { label: "Production & Sales", parent: "Operations" },
  "/stock": { label: "Stock Register", parent: "Operations" },
};

// ── Mock notifications ─────────────────────────────────────────────────────

const MOCK_NOTIFICATIONS = [
  {
    id: 1,
    title: "Agreement renewal due",
    desc: "Manu Valley Plantation — overdue by 2 days",
    time: "2h ago",
    unread: true,
  },
  {
    id: 2,
    title: "New production record logged",
    desc: "180 kg sold @ ₹220/kg — Ambassa Northern",
    time: "5h ago",
    unread: true,
  },
  {
    id: 3,
    title: "Quarterly report ready",
    desc: "Q1 2026 plantation report is available",
    time: "1d ago",
    unread: false,
  },
];

// ── Project selector ───────────────────────────────────────────────────────

function ProjectSelector() {
  const { data: projects = [] } = useListProjects();
  const { selectedProjectId, setSelectedProjectId } = useProjectFilter();
  const [open, setOpen] = useState(false);

  const selected = projects.find((p) => p.id === selectedProjectId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-medium border-gray-200 text-gray-700 hover:bg-gray-50 max-w-[200px] hidden sm:flex"
        >
          <Trees className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
          <span className="truncate flex-1 text-left">
            {selected ? selected.name : "All Projects"}
          </span>
          <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1.5">
          Filter by Project
        </p>
        <button
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            setSelectedProjectId(null);
            setOpen(false);
          }}
        >
          <Trees className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="flex-1 text-left">All Projects</span>
          {selectedProjectId === null && (
            <Check className="w-3 h-3 text-emerald-600" />
          )}
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors"
            onClick={() => {
              setSelectedProjectId(p.id);
              setOpen(false);
            }}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                p.status === "tapping"
                  ? "bg-green-500"
                  : p.status === "maturing"
                  ? "bg-emerald-400"
                  : p.status === "developing"
                  ? "bg-amber-400"
                  : "bg-blue-400"
              )}
            />
            <span className="flex-1 text-left truncate">{p.name}</span>
            {selectedProjectId === p.id && (
              <Check className="w-3 h-3 text-emerald-600" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ── Notifications dropdown ─────────────────────────────────────────────────

function NotificationsDropdown() {
  const unreadCount = MOCK_NOTIFICATIONS.filter((n) => n.unread).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between py-2">
          <span className="font-semibold text-sm">Notifications</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              {unreadCount} new
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MOCK_NOTIFICATIONS.map((n) => (
          <DropdownMenuItem
            key={n.id}
            className={cn(
              "flex flex-col items-start gap-0.5 px-3 py-2.5 cursor-pointer",
              n.unread && "bg-blue-50/60"
            )}
          >
            <div className="flex items-center gap-2 w-full">
              {n.unread && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  !n.unread && "ml-3.5"
                )}
              >
                {n.title}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                {n.time}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground ml-3.5 leading-tight">
              {n.desc}
            </p>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="justify-center text-xs text-primary cursor-pointer py-2">
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Navbar ─────────────────────────────────────────────────────────────────

export default function Navbar() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { role } = useRole();
  const [location] = useLocation();
  const { setOpen: openPalette } = useCommandPalette();

  const basePath = Object.keys(PAGE_TITLES)
    .filter((k) => location === k || location.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const page = basePath ? PAGE_TITLES[basePath] : null;

  const initials =
    (user?.firstName?.charAt(0) ?? "") + (user?.lastName?.charAt(0) ?? "");

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-white px-3 sm:px-4 shadow-sm">
      {/* Mobile hamburger */}
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden -ml-1 h-8 w-8 flex-shrink-0"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 bg-gray-950">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>

      {/* Breadcrumb */}
      <div className="hidden sm:flex items-center gap-1.5 text-sm min-w-0 mr-2">
        <span className="font-semibold text-foreground truncate">
          {page?.label ?? "Hevea Partners"}
        </span>
        {page?.parent && (
          <span className="text-muted-foreground/50 text-xs">
            / {page.parent}
          </span>
        )}
      </div>

      {/* Project selector */}
      <ProjectSelector />

      {/* Command palette trigger — desktop */}
      <div className="flex-1 hidden md:flex justify-center max-w-xs mx-auto">
        <button
          onClick={() => openPalette(true)}
          className="relative w-full flex items-center gap-2 h-8 px-3 rounded-md text-xs text-muted-foreground bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-colors cursor-pointer"
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
            <Command className="w-2.5 h-2.5" />K
          </kbd>
        </button>
      </div>

      {/* Spacer — mobile */}
      <div className="flex-1 md:hidden" />

      {/* Right actions */}
      <div className="flex items-center gap-1">
        {/* Mobile search — opens palette */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8 text-muted-foreground"
          onClick={() => openPalette(true)}
        >
          <Search className="h-4 w-4" />
        </Button>

        <NotificationsDropdown />

        {/* User profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 flex items-center gap-2 px-2 rounded-lg"
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={user?.imageUrl} alt={user?.fullName ?? ""} />
                <AvatarFallback className="text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  {initials || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col items-start">
                <span className="text-xs font-medium text-foreground leading-none">
                  {user?.firstName ?? "User"}
                </span>
              </div>
              <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal py-2.5">
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-none">
                  {user?.fullName ?? "User"}
                </p>
                <p className="text-xs text-muted-foreground leading-none truncate">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
                <span
                  className={cn(
                    "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide mt-0.5",
                    ROLE_COLORS[role]
                  )}
                >
                  {ROLE_LABELS[role]}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 cursor-pointer text-sm">
              <User className="h-3.5 w-3.5" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 cursor-pointer text-sm">
              <Settings className="h-3.5 w-3.5" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut()}
              className="gap-2 text-destructive focus:text-destructive cursor-pointer text-sm"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </header>
  );
}
