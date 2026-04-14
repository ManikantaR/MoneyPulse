'use client';

import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** Main application shell: sidebar + top bar + content area with atmospheric background. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--background)]">
      {/* Atmospheric background glows (visible in dark mode) */}
      <div className="pointer-events-none fixed right-0 top-0 z-0 h-[500px] w-[500px] rounded-full bg-[var(--primary)]/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-0 left-60 z-0 h-[400px] w-[400px] rounded-full bg-[var(--secondary)]/4 blur-[100px]" />

      <Sidebar />
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
