import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex bg-gray-50">
      {/* Fixed sidebar */}
      <div className="hidden md:flex md:w-60 md:flex-col fixed inset-y-0 z-50">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 md:pl-60 flex flex-col min-h-[100dvh]">
        <Navbar />
        <main className="flex-1 p-5 lg:p-7 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
