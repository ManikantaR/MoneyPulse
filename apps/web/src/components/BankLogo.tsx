'use client';

import { cn } from '@/lib/utils';

/** Known bank institution → emoji/color mappings. */
const BANK_MAP: Record<string, { emoji: string; bg: string }> = {
  'bank of america': { emoji: '🏦', bg: 'bg-red-100 dark:bg-red-900/30' },
  boa: { emoji: '🏦', bg: 'bg-red-100 dark:bg-red-900/30' },
  chase: { emoji: '🏛️', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  'jp morgan': { emoji: '🏛️', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  amex: { emoji: '💳', bg: 'bg-sky-100 dark:bg-sky-900/30' },
  'american express': { emoji: '💳', bg: 'bg-sky-100 dark:bg-sky-900/30' },
  citi: { emoji: '🏢', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  citibank: { emoji: '🏢', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  wells: { emoji: '🐴', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  'wells fargo': { emoji: '🐴', bg: 'bg-yellow-100 dark:bg-yellow-900/30' },
  capital: { emoji: '🅲', bg: 'bg-red-50 dark:bg-red-900/20' },
  'capital one': { emoji: '🅲', bg: 'bg-red-50 dark:bg-red-900/20' },
  discover: { emoji: '🔶', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  usaa: { emoji: '🦅', bg: 'bg-blue-100 dark:bg-blue-900/30' },
};

function resolveBank(institution: string): { emoji: string; bg: string } {
  const lower = institution.toLowerCase().trim();
  if (BANK_MAP[lower]) return BANK_MAP[lower];
  for (const [key, val] of Object.entries(BANK_MAP)) {
    if (lower.includes(key)) return val;
  }
  return { emoji: '🏦', bg: 'bg-gray-100 dark:bg-gray-800' };
}

interface BankLogoProps {
  institution: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Emoji-based bank logo with a tinted background circle. */
export function BankLogo({ institution, size = 'md', className }: BankLogoProps) {
  const { emoji, bg } = resolveBank(institution);
  const sizeClasses = {
    sm: 'h-7 w-7 text-sm',
    md: 'h-9 w-9 text-base',
    lg: 'h-11 w-11 text-lg',
  };

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        bg,
        sizeClasses[size],
        className,
      )}
      title={institution}
    >
      {emoji}
    </span>
  );
}
