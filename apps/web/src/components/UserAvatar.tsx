'use client';

import { cn } from '@/lib/utils';

interface UserAvatarProps {
  displayName: string;
  email?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Initials-based user avatar with a gradient background. */
export function UserAvatar({ displayName, size = 'md', className }: UserAvatarProps) {
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sizeClasses = {
    sm: 'h-7 w-7 text-[10px]',
    md: 'h-9 w-9 text-xs',
    lg: 'h-11 w-11 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--secondary)] font-bold text-white',
        sizeClasses[size],
        className,
      )}
      title={displayName}
    >
      {initials || '?'}
    </span>
  );
}
