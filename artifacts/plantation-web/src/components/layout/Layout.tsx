import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { ProjectFilterProvider } from "@/contexts/ProjectFilterContext";
import { cn } from "@/lib/utils";

function LayoutInner({ children }: { children: ReactNode }) {
  const { isCollapsed } = useSidebar();

  return (
    <div className="min-h-[100dvh] flex bg-gray-50">
      {/* Fixed sidebar — desktop only */}
      <div
        className={cn(
          "hidden md:flex md:flex-col fixed inset-y-0 z-50 transition-all duration-300 ease-in-out",
          isCollapsed ? "md:w-14" : "md:w-60"
        )}
      >
        <Sidebar />
      </div>

      {/* Main content area */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-[100dvh] transition-all duration-300 ease-in-out",
          isCollapsed ? "md:pl-14" : "md:pl-60"
        )}
      >
        <Navbar />
        <main className="flex-1 p-4 sm:p-5 lg:p-6 xl:p-7 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <ProjectFilterProvider>
        <LayoutInner>{children}</LayoutInner>
      </ProjectFilterProvider>
    </SidebarProvider>
  );
}
