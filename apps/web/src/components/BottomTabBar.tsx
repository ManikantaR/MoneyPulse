'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tabItems, drawerItems } from '@/lib/nav-items';

interface BottomTabBarProps {
  onAddPress: () => void;
  onMorePress: () => void;
}

export function BottomTabBar({ onAddPress, onMorePress }: BottomTabBarProps) {
  const pathname = usePathname();

  const isMoreActive = drawerItems.some((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-stretch border-t border-[var(--border)] bg-[var(--card)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Mobile navigation"
    >
      {/* Tab items before the center + button */}
      {tabItems.slice(0, 2).map((item) => {
        const isActive =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[44px] text-xs font-medium transition-colors',
              isActive
                ? 'text-[var(--primary)]'
                : 'text-[var(--muted-foreground)]',
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        );
      })}

      {/* Center + Add button */}
      <div className="flex items-center justify-center px-4">
        <button
          onClick={onAddPress}
          aria-label="Add transaction"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg active:opacity-80 transition-opacity"
        >
          <Plus className="h-6 w-6" />
        </button>
      </div>

      {/* Tab items after center: Bills */}
      {tabItems.slice(2).map((item) => {
        const isActive =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[44px] text-xs font-medium transition-colors',
              isActive
                ? 'text-[var(--primary)]'
                : 'text-[var(--muted-foreground)]',
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        );
      })}

      {/* More tab */}
      <button
        onClick={onMorePress}
        aria-label="More navigation"
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[44px] text-xs font-medium transition-colors',
          isMoreActive
            ? 'text-[var(--primary)]'
            : 'text-[var(--muted-foreground)]',
        )}
      >
        <MoreHorizontal className="h-5 w-5" />
        <span>More</span>
      </button>
    </nav>
  );
}
