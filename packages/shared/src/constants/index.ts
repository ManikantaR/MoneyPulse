import type { Institution } from '../types/index.js';

/**
 * Seed-time category definition.
 * Use `parentName` to declare hierarchy without knowing UUIDs at definition time.
 * The seed script resolves `parentName` → `parentId` in a two-pass insert.
 */
export type SeedCategory = {
  name: string;
  icon: string;
  color: string;
  parentName?: string; // if set, this category is nested under the named parent
  sortOrder: number;
};

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  // ── Income ────────────────────────────────────────────────
  { name: 'Income',              icon: '💰', color: '#22c55e', sortOrder: 1 },
  { name: 'Paycheck',            icon: '💵', color: '#16a34a', parentName: 'Income', sortOrder: 1 },
  { name: 'Freelance',           icon: '🖥️', color: '#4ade80', parentName: 'Income', sortOrder: 2 },
  { name: 'Bonus',               icon: '🎉', color: '#86efac', parentName: 'Income', sortOrder: 3 },
  { name: 'Tax Refund',          icon: '💸', color: '#bbf7d0', parentName: 'Income', sortOrder: 4 },
  { name: 'Dividends',           icon: '📊', color: '#6ee7b7', parentName: 'Income', sortOrder: 5 },
  { name: 'Rental Income',       icon: '🏘️', color: '#a7f3d0', parentName: 'Income', sortOrder: 6 },

  // ── Groceries ─────────────────────────────────────────────
  { name: 'Groceries',           icon: '🛒', color: '#16a34a', sortOrder: 2 },

  // ── Dining ────────────────────────────────────────────────
  { name: 'Dining',              icon: '🍽️', color: '#f59e0b', sortOrder: 3 },

  // ── Gas/Auto ──────────────────────────────────────────────
  { name: 'Gas/Auto',            icon: '⛽', color: '#ef4444', sortOrder: 4 },
  { name: 'Auto Repair',         icon: '🔧', color: '#dc2626', parentName: 'Gas/Auto', sortOrder: 1 },
  { name: 'Parking & Tolls',     icon: '🅿️', color: '#f87171', parentName: 'Gas/Auto', sortOrder: 2 },
  { name: 'Car Payment',         icon: '🚘', color: '#fca5a5', parentName: 'Gas/Auto', sortOrder: 3 },

  // ── Shopping ──────────────────────────────────────────────
  { name: 'Shopping',            icon: '🛍️', color: '#3b82f6', sortOrder: 5 },
  { name: 'Clothing',            icon: '👗', color: '#60a5fa', parentName: 'Shopping', sortOrder: 1 },

  // ── Electronics ───────────────────────────────────────────
  { name: 'Electronics',         icon: '💻', color: '#2563eb', sortOrder: 6 },
  { name: 'Cameras',             icon: '📷', color: '#3b82f6', parentName: 'Electronics', sortOrder: 1 },
  { name: 'Smart Home',          icon: '🏡', color: '#60a5fa', parentName: 'Electronics', sortOrder: 2 },
  { name: 'Gaming',              icon: '🎮', color: '#93c5fd', parentName: 'Electronics', sortOrder: 3 },

  // ── Travel ────────────────────────────────────────────────
  { name: 'Travel',              icon: '✈️', color: '#8b5cf6', sortOrder: 7 },

  // ── Entertainment ─────────────────────────────────────────
  { name: 'Entertainment',       icon: '🎬', color: '#ec4899', sortOrder: 8 },

  // ── Subscriptions ─────────────────────────────────────────
  { name: 'Subscriptions',       icon: '📱', color: '#6366f1', sortOrder: 9 },

  // ── Utilities ─────────────────────────────────────────────
  { name: 'Utilities',           icon: '💡', color: '#14b8a6', sortOrder: 10 },

  // ── Healthcare ────────────────────────────────────────────
  { name: 'Healthcare',          icon: '🏥', color: '#f43f5e', sortOrder: 11 },
  { name: 'Doctor & Hospital',   icon: '🩺', color: '#fb7185', parentName: 'Healthcare', sortOrder: 1 },
  { name: 'Dental',              icon: '🦷', color: '#fda4af', parentName: 'Healthcare', sortOrder: 2 },
  { name: 'Vision',              icon: '👓', color: '#fecdd3', parentName: 'Healthcare', sortOrder: 3 },
  { name: 'Pharmacy',            icon: '💊', color: '#ffe4e6', parentName: 'Healthcare', sortOrder: 4 },
  { name: 'Mental Health',       icon: '🧘', color: '#fda4af', parentName: 'Healthcare', sortOrder: 5 },

  // ── Housing ───────────────────────────────────────────────
  { name: 'Housing',             icon: '🏠', color: '#a855f7', sortOrder: 12 },
  { name: 'Mortgage',            icon: '🏦', color: '#9333ea', parentName: 'Housing', sortOrder: 1 },
  { name: 'Rent',                icon: '🔑', color: '#c084fc', parentName: 'Housing', sortOrder: 2 },
  { name: 'HOA Fees',            icon: '📜', color: '#d8b4fe', parentName: 'Housing', sortOrder: 3 },
  { name: 'Home Maintenance',    icon: '🔩', color: '#e9d5ff', parentName: 'Housing', sortOrder: 4 },

  // ── Home & Garden ─────────────────────────────────────────
  { name: 'Home & Garden',       icon: '🌿', color: '#65a30d', sortOrder: 13 },
  { name: 'Lawn & Garden',       icon: '🌱', color: '#4d7c0f', parentName: 'Home & Garden', sortOrder: 1 },
  { name: 'Home Improvement',    icon: '🔨', color: '#84cc16', parentName: 'Home & Garden', sortOrder: 2 },
  { name: 'Furniture & Decor',   icon: '🛋️', color: '#a3e635', parentName: 'Home & Garden', sortOrder: 3 },

  // ── Insurance ─────────────────────────────────────────────
  { name: 'Insurance',           icon: '🛡️', color: '#64748b', sortOrder: 14 },

  // ── Taxes ─────────────────────────────────────────────────
  { name: 'Taxes',               icon: '🏛️', color: '#b91c1c', sortOrder: 15 },
  { name: 'Property Tax',        icon: '📋', color: '#dc2626', parentName: 'Taxes', sortOrder: 1 },
  { name: 'Income Tax',          icon: '💹', color: '#ef4444', parentName: 'Taxes', sortOrder: 2 },

  // ── Education ─────────────────────────────────────────────
  { name: 'Education',           icon: '📚', color: '#0ea5e9', sortOrder: 16 },
  { name: 'Tuition & Fees',      icon: '🎓', color: '#0284c7', parentName: 'Education', sortOrder: 1 },
  { name: 'Books & Supplies',    icon: '📖', color: '#38bdf8', parentName: 'Education', sortOrder: 2 },
  { name: 'School Activities',   icon: '🏫', color: '#7dd3fc', parentName: 'Education', sortOrder: 3 },

  // ── Music & Arts ──────────────────────────────────────────
  { name: 'Music & Arts',        icon: '🎵', color: '#db2777', sortOrder: 17 },
  { name: 'Instrument Rental',   icon: '🎸', color: '#be185d', parentName: 'Music & Arts', sortOrder: 1 },
  { name: 'Lessons & Classes',   icon: '🎼', color: '#ec4899', parentName: 'Music & Arts', sortOrder: 2 },

  // ── Kids & Family ─────────────────────────────────────────
  { name: 'Kids & Family',       icon: '👪', color: '#f97316', sortOrder: 18 },
  { name: 'Sports & Activities', icon: '⚽', color: '#ea580c', parentName: 'Kids & Family', sortOrder: 1 },
  { name: 'Toys & Games',        icon: '🧸', color: '#fb923c', parentName: 'Kids & Family', sortOrder: 2 },
  { name: 'Kids Clothing',       icon: '👕', color: '#fdba74', parentName: 'Kids & Family', sortOrder: 3 },

  // ── Childcare ─────────────────────────────────────────────
  { name: 'Childcare',           icon: '🍼', color: '#fb923c', sortOrder: 19 },

  // ── Fitness ───────────────────────────────────────────────
  { name: 'Fitness',             icon: '💪', color: '#84cc16', sortOrder: 20 },
  { name: 'Gym & Membership',    icon: '🏋️', color: '#65a30d', parentName: 'Fitness', sortOrder: 1 },
  { name: 'Sports Equipment',    icon: '🏅', color: '#a3e635', parentName: 'Fitness', sortOrder: 2 },

  // ── Pets ──────────────────────────────────────────────────
  { name: 'Pets',                icon: '🐾', color: '#92400e', sortOrder: 21 },
  { name: 'Vet & Medical',       icon: '💉', color: '#78350f', parentName: 'Pets', sortOrder: 1 },
  { name: 'Pet Food & Supplies', icon: '🦴', color: '#a16207', parentName: 'Pets', sortOrder: 2 },

  // ── Personal ──────────────────────────────────────────────
  { name: 'Personal',            icon: '👤', color: '#d946ef', sortOrder: 22 },

  // ── Gifts & Donations ─────────────────────────────────────
  { name: 'Gifts & Donations',   icon: '🎁', color: '#e879f9', sortOrder: 23 },
  { name: 'Gifts',               icon: '🎀', color: '#d946ef', parentName: 'Gifts & Donations', sortOrder: 1 },
  { name: 'Charity & Donations', icon: '💝', color: '#f0abfc', parentName: 'Gifts & Donations', sortOrder: 2 },

  // ── Savings & Investments ─────────────────────────────────
  { name: 'Savings & Investments', icon: '📈', color: '#059669', sortOrder: 24 },

  // ── Transfers ─────────────────────────────────────────────
  { name: 'Transfers',           icon: '🔄', color: '#6b7280', sortOrder: 25 },

  // ── Credit Card Payment ───────────────────────────────────
  { name: 'Credit Card Payment', icon: '💳', color: '#0891b2', sortOrder: 26 },
];

export const INSTITUTIONS: { value: Institution; label: string }[] = [
  { value: 'boa', label: 'Bank of America' },
  { value: 'chase', label: 'Chase' },
  { value: 'amex', label: 'American Express' },
  { value: 'citi', label: 'Citi' },
  { value: 'other', label: 'Other' },
];

export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const UPLOAD_DIR = '/tmp/moneypulse/uploads';
export const WATCH_FOLDER_DIR = '/config/watch-folder';
export const INGESTION_QUEUE = 'ingestion';
export const AI_BATCH_SIZE = 20;
export const MIN_PASSWORD_LENGTH = 16;
export const BCRYPT_COST_FACTOR = 12;
export const LOGIN_RATE_LIMIT = { ttl: 60, limit: 5 };
export const API_RATE_LIMIT = { ttl: 60, limit: 100 };
export const ANALYTICS_CACHE_TTL_SECONDS = 300; // 5 minutes
export const BACKUP_RETENTION_DAYS = 30;
export const APP_VERSION = '1.0.0';

export { SEED_RULES } from './seed-rules.js';
export type { SeedRule } from './seed-rules.js';
