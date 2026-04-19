'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Upload,
  Landmark,
  Tags,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Wallet,
} from 'lucide-react';

/** Navigation item definition for the sidebar. */
interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/accounts', label: 'Accounts', icon: Landmark },
  { href: '/budgets', label: 'Budgets', icon: Wallet },
  { href: '/categories', label: 'Categories', icon: Tags },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/** Collapsible sidebar with icon+label navigation. */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-[var(--border)] bg-[var(--card)] transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-16 items-center gap-3 border-b border-[var(--border)] px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg">
          <TrendingUp className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <span className="block text-base font-extrabold tracking-tight text-[var(--primary)]">
              MoneyPulse
            </span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)] opacity-70">
              Wealth Management
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-[var(--accent)] text-[var(--primary)] shadow-[0_0_12px_rgba(0,0,0,0.06)] dark:shadow-[0_0_15px_rgba(189,157,255,0.08)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
                collapsed && 'justify-center px-0',
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-12 items-center justify-center border-t border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="h-5 w-5" />
        ) : (
          <ChevronLeft className="h-5 w-5" />
        )}
      </button>
    </aside>
  );
}
