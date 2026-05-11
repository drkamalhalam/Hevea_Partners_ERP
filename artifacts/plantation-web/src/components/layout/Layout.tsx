import { ReactNode } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      <div className="hidden md:flex md:w-64 md:flex-col fixed inset-y-0 z-50">
        <Sidebar />
      </div>
      
      <div className="flex-1 md:pl-64 flex flex-col">
        <Navbar />
        <main className="flex-1 p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
