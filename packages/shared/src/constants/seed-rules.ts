/**
 * Default merchant-to-category rules.
 * Pattern matches against transaction description (case-insensitive).
 * Organized by category for readability.
 *
 * match_type: 'contains' | 'starts_with' | 'exact' | 'regex'
 * field: 'description' | 'merchant'
 */
export interface SeedRule {
  pattern: string;
  matchType: 'contains' | 'starts_with' | 'exact' | 'regex';
  field: 'description' | 'merchant';
  categoryName: string; // resolved to category_id at seed time
  priority: number; // lower = higher priority
}

export const SEED_RULES: SeedRule[] = [
  // ── Income ─────────────────────────────────────────────────
  { pattern: 'payroll', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'direct dep', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'salary', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'interest paid', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },
  { pattern: 'dividend', matchType: 'contains', field: 'description', categoryName: 'Income', priority: 10 },

  // ── Groceries ──────────────────────────────────────────────
  { pattern: 'whole foods', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'trader joe', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'kroger', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'safeway', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'publix', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'aldi', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'costco', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'walmart', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 25 },
  { pattern: 'h-e-b', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'wegmans', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'sprouts', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },
  { pattern: 'food lion', matchType: 'contains', field: 'description', categoryName: 'Groceries', priority: 20 },

  // ── Dining ─────────────────────────────────────────────────
  { pattern: 'starbucks', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'chipotle', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'mcdonald', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'uber eats', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'doordash', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'grubhub', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'panera', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'chick-fil-a', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'subway', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'dominos', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'pizza hut', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'taco bell', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'wendys', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'dunkin', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'panda express', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },
  { pattern: 'five guys', matchType: 'contains', field: 'description', categoryName: 'Dining', priority: 20 },

  // ── Gas/Auto ───────────────────────────────────────────────
  { pattern: 'shell oil', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'exxon', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'chevron', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'bp ', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'marathon petro', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'sunoco', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'speedway', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'autozone', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },
  { pattern: 'jiffy lube', matchType: 'contains', field: 'description', categoryName: 'Gas/Auto', priority: 20 },

  // ── Shopping ───────────────────────────────────────────────
  { pattern: 'amazon', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 25 },
  { pattern: 'target', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 25 },
  { pattern: 'best buy', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'home depot', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'lowes', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'ikea', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'etsy', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'ebay', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },

  // ── Travel ─────────────────────────────────────────────────
  { pattern: 'delta air', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'united air', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'american air', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'southwest', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'marriott', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'hilton', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'airbnb', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'uber trip', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },
  { pattern: 'lyft', matchType: 'contains', field: 'description', categoryName: 'Travel', priority: 20 },

  // ── Entertainment ──────────────────────────────────────────
  { pattern: 'amc theater', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },
  { pattern: 'regal cinema', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },
  { pattern: 'ticketmaster', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },
  { pattern: 'stubhub', matchType: 'contains', field: 'description', categoryName: 'Entertainment', priority: 20 },

  // ── Subscriptions ──────────────────────────────────────────
  { pattern: 'netflix', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'spotify', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'hulu', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'disney+', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'apple.com/bill', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'amazon prime', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 15 },
  { pattern: 'youtube premium', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'hbo max', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'max.com', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'paramount+', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },
  { pattern: 'chatgpt', matchType: 'contains', field: 'description', categoryName: 'Subscriptions', priority: 20 },

  // ── Utilities ──────────────────────────────────────────────
  { pattern: 'at&t', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'verizon', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 't-mobile', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'comcast', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'xfinity', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'duke energy', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'water utility', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 20 },
  { pattern: 'electric', matchType: 'contains', field: 'description', categoryName: 'Utilities', priority: 30 },

  // ── Healthcare ─────────────────────────────────────────────
  { pattern: 'cvs', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },
  { pattern: 'walgreens', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },
  { pattern: 'pharmacy', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 25 },
  { pattern: 'medical', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 25 },
  { pattern: 'dental', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 25 },
  { pattern: 'kaiser', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },

  // ── Housing ────────────────────────────────────────────────
  { pattern: 'mortgage', matchType: 'contains', field: 'description', categoryName: 'Housing', priority: 20 },
  { pattern: 'rent payment', matchType: 'contains', field: 'description', categoryName: 'Housing', priority: 20 },
  { pattern: 'hoa', matchType: 'contains', field: 'description', categoryName: 'Housing', priority: 25 },

  // ── Insurance ──────────────────────────────────────────────
  { pattern: 'geico', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'state farm', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'allstate', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'progressive', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'insurance', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 30 },

  // ── Transfers (low priority — generic) ─────────────────────
  { pattern: 'transfer', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 50 },
  { pattern: 'zelle', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'venmo', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'cash app', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'paypal', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
];
