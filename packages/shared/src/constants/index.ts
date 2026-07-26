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
  isTransfer?: boolean; // if true, excluded from income/expense reports (e.g. CC payments, transfers)
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
  { name: 'Fuel',                icon: '⛽', color: '#ef4444', parentName: 'Gas/Auto', sortOrder: 4 },

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
  { name: 'Streaming',           icon: '📺', color: '#818cf8', parentName: 'Subscriptions', sortOrder: 1 },
  { name: 'Music',               icon: '🎵', color: '#a78bfa', parentName: 'Subscriptions', sortOrder: 2 },
  { name: 'AI & Software',       icon: '🤖', color: '#7c3aed', parentName: 'Subscriptions', sortOrder: 3 },
  { name: 'Cloud Storage',       icon: '☁️', color: '#c4b5fd', parentName: 'Subscriptions', sortOrder: 4 },
  { name: 'News & Media',        icon: '📰', color: '#8b5cf6', parentName: 'Subscriptions', sortOrder: 5 },
  { name: 'Gaming Subs',         icon: '🎮', color: '#ddd6fe', parentName: 'Subscriptions', sortOrder: 6 },

  // ── Utilities ─────────────────────────────────────────────
  { name: 'Utilities',           icon: '💡', color: '#14b8a6', sortOrder: 10 },
  { name: 'Electric',            icon: '⚡', color: '#0d9488', parentName: 'Utilities', sortOrder: 1 },
  { name: 'Water',               icon: '💧', color: '#2dd4bf', parentName: 'Utilities', sortOrder: 2 },
  { name: 'Gas',                 icon: '🔥', color: '#5eead4', parentName: 'Utilities', sortOrder: 3 },
  { name: 'Phone',               icon: '📱', color: '#99f6e4', parentName: 'Utilities', sortOrder: 4 },
  { name: 'Internet',            icon: '🌐', color: '#ccfbf1', parentName: 'Utilities', sortOrder: 5 },
  { name: 'Trash & Sewer',       icon: '🗑️', color: '#f0fdfa', parentName: 'Utilities', sortOrder: 6 },

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
  { name: '529 College Savings',   icon: '🎓', color: '#10b981', parentName: 'Savings & Investments', sortOrder: 1, isTransfer: true },
  { name: 'Retirement (401k/IRA)', icon: '🏦', color: '#047857', parentName: 'Savings & Investments', sortOrder: 2, isTransfer: true },
  { name: 'Brokerage',             icon: '📊', color: '#34d399', parentName: 'Savings & Investments', sortOrder: 3, isTransfer: true },
  { name: 'Emergency Fund',        icon: '🛟', color: '#6ee7b7', parentName: 'Savings & Investments', sortOrder: 4, isTransfer: true },

  // ── Transfers ─────────────────────────────────────────────
  { name: 'Transfers',           icon: '🔄', color: '#6b7280', sortOrder: 25, isTransfer: true },

  // ── Credit Card Payment ───────────────────────────────────
  { name: 'Credit Card Payment', icon: '💳', color: '#0891b2', sortOrder: 26, isTransfer: true },

  // ── Investment Contribution ───────────────────────────────
  { name: 'Investment Contribution', icon: '💹', color: '#3b82f6', sortOrder: 27, isTransfer: true },

  // ── Family Support ────────────────────────────────────────
  { name: 'Family Support', icon: '🤝', color: '#f97316', sortOrder: 28 },
];

export const INSTITUTIONS: { value: Institution; label: string }[] = [
  { value: 'boa', label: 'Bank of America' },
  { value: 'chase', label: 'Chase' },
  { value: 'amex', label: 'American Express' },
  { value: 'citi', label: 'Citi' },
  { value: 'other', label: 'Other' },
];

/**
 * Default merchant aliases seeded as global (userId=NULL) entries.
 * Users can add their own via the UI which take priority.
 * The normalizer checks aliases BEFORE falling back to rule-based cleanup.
 */
export type SeedMerchantAlias = {
  pattern: string;
  matchType: 'contains' | 'startsWith' | 'exact';
  displayName: string;
};

export const DEFAULT_MERCHANT_ALIASES: SeedMerchantAlias[] = [
  // Grocery & Retail
  { pattern: 'costco', matchType: 'contains', displayName: 'Costco' },
  { pattern: 'walmart', matchType: 'contains', displayName: 'Walmart' },
  { pattern: 'target', matchType: 'contains', displayName: 'Target' },
  { pattern: 'whole foods', matchType: 'contains', displayName: 'Whole Foods' },
  { pattern: 'trader joe', matchType: 'contains', displayName: "Trader Joe's" },
  { pattern: 'aldi', matchType: 'contains', displayName: 'ALDI' },
  { pattern: 'kroger', matchType: 'contains', displayName: 'Kroger' },
  { pattern: 'publix', matchType: 'contains', displayName: 'Publix' },
  { pattern: 'safeway', matchType: 'contains', displayName: 'Safeway' },
  { pattern: 'sam\'s club', matchType: 'contains', displayName: "Sam's Club" },
  { pattern: 'bj\'s', matchType: 'contains', displayName: "BJ's Wholesale" },
  { pattern: 'cvs', matchType: 'contains', displayName: 'CVS' },
  { pattern: 'walgreens', matchType: 'contains', displayName: 'Walgreens' },
  // Food & Dining
  { pattern: 'starbucks', matchType: 'contains', displayName: 'Starbucks' },
  { pattern: 'dunkin', matchType: 'contains', displayName: "Dunkin'" },
  { pattern: 'chick-fil-a', matchType: 'contains', displayName: 'Chick-fil-A' },
  { pattern: 'mcdonalds', matchType: 'contains', displayName: "McDonald's" },
  { pattern: "mcdonald's", matchType: 'contains', displayName: "McDonald's" },
  { pattern: 'chipotle', matchType: 'contains', displayName: 'Chipotle' },
  { pattern: 'panera', matchType: 'contains', displayName: 'Panera Bread' },
  { pattern: 'chilis', matchType: 'contains', displayName: "Chili's" },
  { pattern: 'dominos', matchType: 'contains', displayName: "Domino's" },
  { pattern: 'doordash', matchType: 'contains', displayName: 'DoorDash' },
  { pattern: 'uber eats', matchType: 'contains', displayName: 'Uber Eats' },
  { pattern: 'grubhub', matchType: 'contains', displayName: 'Grubhub' },
  // Tech & Subscriptions
  { pattern: 'amazon web services', matchType: 'contains', displayName: 'AWS' },
  { pattern: 'amzn', matchType: 'startsWith', displayName: 'Amazon' },
  { pattern: 'amazon', matchType: 'contains', displayName: 'Amazon' },
  { pattern: 'netflix', matchType: 'contains', displayName: 'Netflix' },
  { pattern: 'spotify', matchType: 'contains', displayName: 'Spotify' },
  { pattern: 'hulu', matchType: 'contains', displayName: 'Hulu' },
  { pattern: 'disney+', matchType: 'contains', displayName: 'Disney+' },
  { pattern: 'apple', matchType: 'startsWith', displayName: 'Apple' },
  { pattern: 'google', matchType: 'startsWith', displayName: 'Google' },
  { pattern: 'microsoft', matchType: 'contains', displayName: 'Microsoft' },
  { pattern: 'openai', matchType: 'contains', displayName: 'OpenAI' },
  { pattern: 'chatgpt', matchType: 'contains', displayName: 'ChatGPT' },
  { pattern: 'github', matchType: 'contains', displayName: 'GitHub' },
  { pattern: 'youtube', matchType: 'contains', displayName: 'YouTube' },
  // Transportation
  { pattern: 'uber', matchType: 'startsWith', displayName: 'Uber' },
  { pattern: 'lyft', matchType: 'contains', displayName: 'Lyft' },
  { pattern: 'shell', matchType: 'startsWith', displayName: 'Shell' },
  { pattern: 'exxon', matchType: 'contains', displayName: 'Exxon' },
  { pattern: 'chevron', matchType: 'contains', displayName: 'Chevron' },
  { pattern: 'wawa', matchType: 'contains', displayName: 'Wawa' },
  // Utilities & Services
  { pattern: 'comcast', matchType: 'contains', displayName: 'Comcast/Xfinity' },
  { pattern: 'xfinity', matchType: 'contains', displayName: 'Comcast/Xfinity' },
  { pattern: 'verizon', matchType: 'contains', displayName: 'Verizon' },
  { pattern: 'at&t', matchType: 'contains', displayName: 'AT&T' },
  { pattern: 't-mobile', matchType: 'contains', displayName: 'T-Mobile' },
  // Home & Hardware
  { pattern: 'home depot', matchType: 'contains', displayName: 'Home Depot' },
  { pattern: 'lowes', matchType: 'contains', displayName: "Lowe's" },
  { pattern: 'ikea', matchType: 'contains', displayName: 'IKEA' },
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

/**
 * Watchdog detector thresholds (11.5). Every magic number a detector rule
 * uses lives here so a future settings UI can expose it without touching
 * detector logic.
 */
export const WATCHDOG_THRESHOLDS = {
  /** Duplicate charge: max gap between two matching charges. */
  DUPLICATE_WINDOW_HOURS: 48,
  /** Subscription price creep: min deviation from trailing modal amount. */
  PRICE_CREEP_MIN_PERCENT: 0.02, // 2%
  PRICE_CREEP_MIN_ABS_CENTS: 100, // $1.00
  /** New recurring merchant: minimum occurrences before it's "recurring". */
  RECURRING_MIN_OCCURRENCES: 3,
  /** Recurring interval tolerance (days) when comparing successive gaps. */
  RECURRING_INTERVAL_TOLERANCE_DAYS: 5,
  /** Budget pace: earliest day-of-period the projection is trusted. */
  BUDGET_PACE_MIN_DAY: 7,
  /** Budget pace: projected-spend / budget ratio that triggers the alert. */
  BUDGET_PACE_PROJECTION_RATIO: 1.1, // 110%
  /** Statistical anomaly: z-score threshold. */
  STAT_ANOMALY_Z_THRESHOLD: 3,
  /** Statistical anomaly: minimum sample size before a baseline is trusted. */
  STAT_ANOMALY_MIN_SAMPLES: 20,
  /** Statistical anomaly: minimum absolute amount before bothering to flag. */
  STAT_ANOMALY_MIN_AMOUNT_CENTS: 2_500, // $25.00
  /** Statistical anomaly: trailing window used to build the baseline. */
  STAT_ANOMALY_WINDOW_MONTHS: 6,
} as const;

/**
 * Description substrings indicating a fee, interest charge, or penalty.
 * Matched case-insensitively against the transaction description.
 */
export const FEE_DESCRIPTION_PATTERNS: string[] = [
  'overdraft fee',
  'nsf fee',
  'late fee',
  'annual fee',
  'maintenance fee',
  'service fee',
  'atm fee',
  'foreign transaction fee',
  'interest charge',
  'finance charge',
  'penalty',
  'insufficient funds',
  'returned item fee',
  'wire transfer fee',
];

/**
 * Category names where a "fee" description is expected/legitimate and should
 * NOT be flagged (e.g. a categorized loan-interest line item the user already
 * tracks deliberately).
 */
export const EXPECTED_FEE_CATEGORY_NAMES: string[] = [
  'Mortgage',
  'Loan Interest',
];

// ── Market Data (11.6) ──────────────────────────────────────

/** A single market_metrics series this app tracks, keyed by metric_key. */
export type MarketSeriesDef = {
  metricKey: string;
  source: 'eia' | 'fred' | 'treasury';
  unit: string;
  /** How often the underlying series actually updates — used to skip a daily
   *  refresh call for a weekly/monthly series that hasn't rolled over yet. */
  cadence: 'daily' | 'weekly' | 'monthly';
  description: string;
};

export const MARKET_SERIES: MarketSeriesDef[] = [
  {
    metricKey: 'gas_retail_regular',
    source: 'eia',
    unit: 'usd_per_gallon',
    cadence: 'weekly',
    description: 'Regular gasoline retail price ($/gal), state from MARKET_GAS_STATE',
  },
  {
    metricKey: 'electricity_residential',
    source: 'eia',
    unit: 'cents_per_kwh',
    cadence: 'monthly',
    description: 'Residential electricity price (¢/kWh), state from MARKET_GAS_STATE',
  },
  {
    metricKey: 'mortgage_30y',
    source: 'fred',
    unit: 'percent',
    cadence: 'weekly',
    description: '30-year fixed mortgage rate (FRED MORTGAGE30US)',
  },
  {
    metricKey: 'cpi_all_urban',
    source: 'fred',
    unit: 'index',
    cadence: 'monthly',
    description: 'Consumer Price Index, all urban consumers (FRED CPIAUCSL)',
  },
  {
    metricKey: 'fed_funds_rate',
    source: 'fred',
    unit: 'percent',
    cadence: 'monthly',
    description: 'Effective federal funds rate (FRED FEDFUNDS)',
  },
  // 12.3: US Treasury par yield curve (fiscaldata.treasury.gov), daily. Interest is
  // exempt from state (not federal) tax — see `stateTaxExempt` on market_metrics.
  {
    metricKey: 'treasury_bill_4w',
    source: 'treasury',
    unit: 'percent',
    cadence: 'daily',
    description: '4-week Treasury bill yield (Daily Treasury Par Yield Curve Rates)',
  },
  {
    metricKey: 'treasury_bill_13w',
    source: 'treasury',
    unit: 'percent',
    cadence: 'daily',
    description: '13-week Treasury bill yield (Daily Treasury Par Yield Curve Rates)',
  },
  {
    metricKey: 'treasury_bill_26w',
    source: 'treasury',
    unit: 'percent',
    cadence: 'daily',
    description: '26-week Treasury bill yield (Daily Treasury Par Yield Curve Rates)',
  },
  {
    metricKey: 'treasury_bill_52w',
    source: 'treasury',
    unit: 'percent',
    cadence: 'daily',
    description: '52-week Treasury bill yield (Daily Treasury Par Yield Curve Rates)',
  },
  {
    metricKey: 'treasury_note_2y',
    source: 'treasury',
    unit: 'percent',
    cadence: 'daily',
    description: '2-year Treasury note yield (Daily Treasury Par Yield Curve Rates)',
  },
  {
    metricKey: 'treasury_note_10y',
    source: 'treasury',
    unit: 'percent',
    cadence: 'daily',
    description: '10-year Treasury note yield (Daily Treasury Par Yield Curve Rates)',
  },
];

/** Treasury series keys eligible for rate-watchlist auto-population (short-duration,
 *  parking-spot-comparable maturities — the 2y/10y notes are excluded, they're not a
 *  cash-parking alternative). */
export const TREASURY_WATCHLIST_SERIES = [
  'treasury_bill_4w',
  'treasury_bill_13w',
  'treasury_bill_26w',
  'treasury_bill_52w',
];

/** Rate-watchlist row goes stale (nag surfaced) after this many days without an
 *  update — env-overridable via `WATCHLIST_STALE_DAYS`. */
export const DEFAULT_WATCHLIST_STALE_DAYS = 45;

/** Interest-credit transaction description patterns (case-insensitive substring
 *  match) used to derive earned APY — mirrors the categorization-rule convention of
 *  simple substring matching rather than a full regex engine. */
export const INTEREST_CREDIT_PATTERNS = ['INTEREST PAID', 'INTEREST PAYMENT', 'DIVIDEND'];

/** FRED series ID used as the HYSA-comparable benchmark — env-overridable per the
 *  spec (`MARKET_HYSA_FRED_SERIES`). No FRED series *is* an actual HYSA APY; FEDFUNDS
 *  (effective federal funds rate) is the standard public proxy online-savings yields
 *  track closely, so it's the default. Verify against https://fred.stlouisfed.org
 *  once you have a key if you want a closer benchmark (e.g. a short T-bill series). */
export const DEFAULT_HYSA_FRED_SERIES = 'FEDFUNDS';

// ── Market-joined insights (11.7) ────────────────────────────
// Every rule/threshold these market-vs-personal detectors use lives here so a
// future settings UI can expose overrides without touching detector logic.
export const MARKET_INSIGHT_THRESHOLDS = {
  /** Refi watcher: min (loan APR − market rate) spread, in percentage points, to fire. */
  REFI_SPREAD_THRESHOLD_PP: 0.75,
  /** Idle cash: default buffer is 1x trailing-3-month avg monthly expenses. */
  IDLE_CASH_BUFFER_MONTHS: 1,
  /** Idle cash: min foregone $/yr (in cents) before bothering to flag. */
  IDLE_CASH_MIN_FOREGONE_CENTS_PER_YEAR: 10_000, // $100/yr
  /** Fuel/power vs market: min divergence (percentage points) between personal MoM% and market MoM%. */
  FUEL_POWER_DIVERGENCE_PP: 10,
  /** Fuel vs market: minimum fuel transactions this month before trusting the MoM%. */
  FUEL_MIN_TXNS: 3,
  /** Gas dip note: min week-over-week % move in state gas price to fire a brief update. */
  GAS_WOW_PERCENT: 3,
} as const;

// ── Monthly Close: target bands & calculation version (13.1) ────
// Bands are expressed in basis points (1% = 100 bps) to match the *_bps columns on
// monthly_financial_snapshots — never floats for ratios. All bands are inclusive of
// their lower bound and exclusive of their upper bound. Defaults per
// specs/PHASE13-MONTHLY-CLOSE-SPEC.md, as narrowed by epic #158 decision #10
// (single expense-ratio band for v1 — no fixed/variable split yet).

/** Liquid assets / net worth. Green band centered on a 30% default target. */
export const LIQUID_NET_WORTH_RATIO_TARGET_BPS = {
  DEFAULT_TARGET_BPS: 3000,
  GREEN_MIN_BPS: 2500,
  GREEN_MAX_BPS: 3500,
  YELLOW_LOW_MIN_BPS: 1500,
  YELLOW_HIGH_MAX_BPS: 4500,
  RED_MAX_BPS: 1500,
} as const;

/** Total liabilities / total assets. */
export const DEBT_ASSET_RATIO_TARGET_BPS = {
  GREEN_MAX_BPS: 2500,
  YELLOW_MAX_BPS: 4000,
} as const;

/** Required monthly debt payments / take-home income. */
export const DEBT_PAYMENT_INCOME_RATIO_TARGET_BPS = {
  GREEN_MAX_BPS: 2500,
  YELLOW_MAX_BPS: 3500,
} as const;

/** Expenses / take-home income. Single band for v1 (decision #10). */
export const EXPENSE_RATIO_TARGET_BPS = {
  GREEN_MAX_BPS: 6000,
  YELLOW_MAX_BPS: 7500,
} as const;

/** Bumped whenever the monthly-close aggregate/ratio calculation logic changes, so
 *  a frozen snapshot can be compared against the version that produced it (same
 *  convention as the recommendation-engine `*_CALCULATION_VERSION` constants). */
export const MONTHLY_CLOSE_CALCULATION_VERSION = 'monthly-close-v1';
