'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { BottomTabBar } from './BottomTabBar';
import { MobileMoreDrawer } from './MobileMoreDrawer';
import { AddTransactionModal } from './AddTransactionModal';

/** Main application shell: sidebar (desktop) + bottom tab bar (mobile) + content area. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);

  return (
    <div className="relative flex h-screen overflow-hidden bg-[var(--background)]">
      {/* Atmospheric background glows (visible in dark mode) */}
      <div className="pointer-events-none fixed right-0 top-0 z-0 h-[500px] w-[500px] rounded-full bg-[var(--primary)]/5 blur-[120px]" />
      <div className="pointer-events-none fixed bottom-0 left-60 z-0 h-[400px] w-[400px] rounded-full bg-[var(--secondary)]/4 blur-[100px]" />

      {/* Desktop sidebar — hidden on mobile via Sidebar component */}
      <Sidebar />

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main
          className="flex-1 overflow-y-auto p-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6"
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <BottomTabBar
        onAddPress={() => setShowAddModal(true)}
        onMorePress={() => setShowMoreDrawer(true)}
      />

      {/* More drawer (mobile) */}
      {showMoreDrawer && (
        <MobileMoreDrawer onClose={() => setShowMoreDrawer(false)} />
      )}

      {/* Global +Add modal (opened from bottom tab bar) */}
      {showAddModal && (
        <AddTransactionModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}

