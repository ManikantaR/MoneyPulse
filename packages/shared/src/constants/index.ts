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
  { name: 'Gas & Fuel',          icon: '⛽', color: '#ef4444', parentName: 'Gas/Auto', sortOrder: 1 },
  { name: 'Auto Repair',         icon: '🔧', color: '#dc2626', parentName: 'Gas/Auto', sortOrder: 2 },
  { name: 'Parking & Tolls',     icon: '🅿️', color: '#f87171', parentName: 'Gas/Auto', sortOrder: 3 },
  { name: 'Car Payment',         icon: '🚘', color: '#fca5a5', parentName: 'Gas/Auto', sortOrder: 4 },
  { name: 'Auto Insurance',      icon: '🛡️', color: '#fca5a5', parentName: 'Gas/Auto', sortOrder: 5 },
  { name: 'Car Wash',            icon: '🚿', color: '#fecaca', parentName: 'Gas/Auto', sortOrder: 6 },
  { name: 'Registration & DMV',  icon: '📋', color: '#fee2e2', parentName: 'Gas/Auto', sortOrder: 7 },
  { name: 'Ride Share',          icon: '🚖', color: '#fee2e2', parentName: 'Gas/Auto', sortOrder: 8 },

  // ── Shopping ──────────────────────────────────────────────
  { name: 'Shopping',            icon: '🛍️', color: '#3b82f6', sortOrder: 5 },
  { name: 'Clothing',            icon: '👗', color: '#60a5fa', parentName: 'Shopping', sortOrder: 1 },
  { name: 'Home Goods',          icon: '🏠', color: '#93c5fd', parentName: 'Shopping', sortOrder: 2 },
  { name: 'Online Shopping',     icon: '📦', color: '#bfdbfe', parentName: 'Shopping', sortOrder: 3 },

  // ── Memberships ───────────────────────────────────────────
  { name: 'Memberships',         icon: '🪙', color: '#d97706', sortOrder: 5 },
  { name: 'Warehouse Clubs',     icon: '🏪', color: '#b45309', parentName: 'Memberships', sortOrder: 1 },
  { name: 'Professional Orgs',   icon: '🤝', color: '#d97706', parentName: 'Memberships', sortOrder: 2 },
  { name: 'Clubs & Associations',icon: '🏅', color: '#fbbf24', parentName: 'Memberships', sortOrder: 3 },

  // ── Electronics ───────────────────────────────────────────
  { name: 'Electronics',         icon: '💻', color: '#2563eb', sortOrder: 6 },
  { name: 'Cameras',             icon: '📷', color: '#3b82f6', parentName: 'Electronics', sortOrder: 1 },
  { name: 'Smart Home',          icon: '🏡', color: '#60a5fa', parentName: 'Electronics', sortOrder: 2 },
  { name: 'Gaming',              icon: '🎮', color: '#93c5fd', parentName: 'Electronics', sortOrder: 3 },

  // ── Travel ────────────────────────────────────────────────
  { name: 'Travel',              icon: '✈️', color: '#8b5cf6', sortOrder: 7 },
  { name: 'Flights',             icon: '🛫', color: '#7c3aed', parentName: 'Travel', sortOrder: 1 },
  { name: 'Hotels & Lodging',    icon: '🏨', color: '#8b5cf6', parentName: 'Travel', sortOrder: 2 },
  { name: 'Car Rental',          icon: '🚗', color: '#a78bfa', parentName: 'Travel', sortOrder: 3 },
  { name: 'Public Transit',      icon: '🚌', color: '#c4b5fd', parentName: 'Travel', sortOrder: 4 },

  // ── Entertainment ─────────────────────────────────────────
  { name: 'Entertainment',       icon: '🎬', color: '#ec4899', sortOrder: 8 },
  { name: 'Movies & Shows',      icon: '🍿', color: '#db2777', parentName: 'Entertainment', sortOrder: 1 },
  { name: 'Concerts & Events',   icon: '🎤', color: '#ec4899', parentName: 'Entertainment', sortOrder: 2 },
  { name: 'Sports Events',       icon: '🏟️', color: '#f472b6', parentName: 'Entertainment', sortOrder: 3 },
  { name: 'Bars & Nightlife',    icon: '🍻', color: '#fbcfe8', parentName: 'Entertainment', sortOrder: 4 },

  // ── Dining ────────────────────────────────────────────────── (subcategories added)
  { name: 'Coffee & Tea',        icon: '☕', color: '#f59e0b', parentName: 'Dining', sortOrder: 1 },
  { name: 'Fast Food',           icon: '🍔', color: '#fbbf24', parentName: 'Dining', sortOrder: 2 },
  { name: 'Restaurants',         icon: '🍽️', color: '#fcd34d', parentName: 'Dining', sortOrder: 3 },

  // ── Subscriptions ─────────────────────────────────────────
  { name: 'Subscriptions',       icon: '📱', color: '#6366f1', sortOrder: 9 },
  { name: 'Streaming Services',  icon: '📺', color: '#4f46e5', parentName: 'Subscriptions', sortOrder: 1 },
  { name: 'Software & Apps',     icon: '💾', color: '#6366f1', parentName: 'Subscriptions', sortOrder: 2 },
  { name: 'News & Magazines',    icon: '📰', color: '#818cf8', parentName: 'Subscriptions', sortOrder: 3 },

  // ── Utilities ─────────────────────────────────────────────
  { name: 'Utilities',           icon: '💡', color: '#14b8a6', sortOrder: 10 },
  { name: 'Electric',            icon: '⚡', color: '#0d9488', parentName: 'Utilities', sortOrder: 1 },
  { name: 'Water & Sewer',       icon: '💧', color: '#14b8a6', parentName: 'Utilities', sortOrder: 2 },
  { name: 'Natural Gas',         icon: '🔥', color: '#2dd4bf', parentName: 'Utilities', sortOrder: 3 },
  { name: 'Internet & Cable',    icon: '📡', color: '#5eead4', parentName: 'Utilities', sortOrder: 4 },
  { name: 'Phone',               icon: '📞', color: '#99f6e4', parentName: 'Utilities', sortOrder: 5 },
  { name: 'Trash & Recycling',   icon: '🗑️', color: '#ccfbf1', parentName: 'Utilities', sortOrder: 6 },

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
  { name: 'Home Insurance',      icon: '🏡', color: '#475569', parentName: 'Insurance', sortOrder: 1 },
  { name: 'Life Insurance',      icon: '❤️', color: '#64748b', parentName: 'Insurance', sortOrder: 2 },
  { name: 'Health Insurance',    icon: '💙', color: '#94a3b8', parentName: 'Insurance', sortOrder: 3 },

  // ── Taxes ─────────────────────────────────────────────────
  { name: 'Taxes',               icon: '🏛️', color: '#b91c1c', sortOrder: 15 },
  { name: 'Property Tax',        icon: '📋', color: '#dc2626', parentName: 'Taxes', sortOrder: 1 },
  { name: 'Income Tax',          icon: '💹', color: '#ef4444', parentName: 'Taxes', sortOrder: 2 },
  { name: 'Tax Preparation',     icon: '📝', color: '#f87171', parentName: 'Taxes', sortOrder: 3 },

  // ── Software & Tech ───────────────────────────────────────
  { name: 'Software & Tech',     icon: '🖥️', color: '#0891b2', sortOrder: 15 },
  { name: 'Productivity Tools',  icon: '⚙️', color: '#0e7490', parentName: 'Software & Tech', sortOrder: 1 },
  { name: 'Design Tools',        icon: '🎨', color: '#0891b2', parentName: 'Software & Tech', sortOrder: 2 },
  { name: 'Cloud Storage',       icon: '☁️', color: '#22d3ee', parentName: 'Software & Tech', sortOrder: 3 },
  { name: 'Security Software',   icon: '🔒', color: '#67e8f9', parentName: 'Software & Tech', sortOrder: 4 },

  // ── Business Expenses ─────────────────────────────────────
  { name: 'Business Expenses',   icon: '💼', color: '#0369a1', sortOrder: 16 },
  { name: 'Work Meals',          icon: '🍱', color: '#0284c7', parentName: 'Business Expenses', sortOrder: 1 },
  { name: 'Work Books & Training',icon: '📘', color: '#0369a1', parentName: 'Business Expenses', sortOrder: 2 },
  { name: 'Office Supplies',     icon: '🗂️', color: '#0ea5e9', parentName: 'Business Expenses', sortOrder: 3 },
  { name: 'Work Equipment',      icon: '🖨️', color: '#38bdf8', parentName: 'Business Expenses', sortOrder: 4 },
  { name: 'Conferences & Travel',icon: '🗺️', color: '#7dd3fc', parentName: 'Business Expenses', sortOrder: 5 },
  { name: 'Reimbursements',      icon: '💵', color: '#bae6fd', parentName: 'Business Expenses', sortOrder: 6 },

  // ── Education ─────────────────────────────────────────────
  { name: 'Education',           icon: '📚', color: '#0ea5e9', sortOrder: 17 },
  { name: 'Tuition & Fees',      icon: '🎓', color: '#0284c7', parentName: 'Education', sortOrder: 1 },
  { name: 'Books & Supplies',    icon: '📖', color: '#38bdf8', parentName: 'Education', sortOrder: 2 },
  { name: 'School Activities',   icon: '🏫', color: '#7dd3fc', parentName: 'Education', sortOrder: 3 },
  { name: 'Online Courses',      icon: '🎧', color: '#bae6fd', parentName: 'Education', sortOrder: 4 },

  // ── Music & Arts ──────────────────────────────────────────
  { name: 'Music & Arts',        icon: '🎵', color: '#db2777', sortOrder: 18 },
  { name: 'Instrument Rental',   icon: '🎸', color: '#be185d', parentName: 'Music & Arts', sortOrder: 1 },
  { name: 'Lessons & Classes',   icon: '🎼', color: '#ec4899', parentName: 'Music & Arts', sortOrder: 2 },

  // ── Kids & Family ─────────────────────────────────────────
  { name: 'Kids & Family',       icon: '👪', color: '#f97316', sortOrder: 19 },
  { name: 'Sports & Activities', icon: '⚽', color: '#ea580c', parentName: 'Kids & Family', sortOrder: 1 },
  { name: 'Toys & Games',        icon: '🧸', color: '#fb923c', parentName: 'Kids & Family', sortOrder: 2 },
  { name: 'Kids Clothing',       icon: '👕', color: '#fdba74', parentName: 'Kids & Family', sortOrder: 3 },

  // ── Childcare ─────────────────────────────────────────────
  { name: 'Childcare',           icon: '🍼', color: '#fb923c', sortOrder: 20 },

  // ── Fitness ───────────────────────────────────────────────
  { name: 'Fitness',             icon: '💪', color: '#84cc16', sortOrder: 21 },
  { name: 'Gym & Membership',    icon: '🏋️', color: '#65a30d', parentName: 'Fitness', sortOrder: 1 },
  { name: 'Sports Equipment',    icon: '🏅', color: '#a3e635', parentName: 'Fitness', sortOrder: 2 },

  // ── Pets ──────────────────────────────────────────────────
  { name: 'Pets',                icon: '🐾', color: '#92400e', sortOrder: 22 },
  { name: 'Vet & Medical',       icon: '💉', color: '#78350f', parentName: 'Pets', sortOrder: 1 },
  { name: 'Pet Food & Supplies', icon: '🦴', color: '#a16207', parentName: 'Pets', sortOrder: 2 },

  // ── Personal ──────────────────────────────────────────────
  { name: 'Personal',            icon: '👤', color: '#d946ef', sortOrder: 23 },
  { name: 'Haircut & Salon',     icon: '💇', color: '#c026d3', parentName: 'Personal', sortOrder: 1 },
  { name: 'Spa & Beauty',        icon: '💅', color: '#d946ef', parentName: 'Personal', sortOrder: 2 },
  { name: 'Personal Care',       icon: '🧴', color: '#e879f9', parentName: 'Personal', sortOrder: 3 },

  // ── Gifts & Donations ─────────────────────────────────────
  { name: 'Gifts & Donations',   icon: '🎁', color: '#e879f9', sortOrder: 24 },
  { name: 'Gifts',               icon: '🎀', color: '#d946ef', parentName: 'Gifts & Donations', sortOrder: 1 },
  { name: 'Charity & Donations', icon: '💝', color: '#f0abfc', parentName: 'Gifts & Donations', sortOrder: 2 },

  // ── Savings & Investments ─────────────────────────────────
  { name: 'Savings & Investments', icon: '📈', color: '#059669', sortOrder: 25 },

  // ── Transfers ─────────────────────────────────────────────
  { name: 'Transfers',           icon: '🔄', color: '#6b7280', sortOrder: 26 },

  // ── Credit Card Payment ───────────────────────────────────
  { name: 'Credit Card Payment', icon: '💳', color: '#0891b2', sortOrder: 27 },
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
