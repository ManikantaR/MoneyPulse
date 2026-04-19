/**
 * Default merchant-to-category rules.
 * Pattern matches against transaction description or merchant name (case-insensitive).
 * Organized by category for readability.
 *
 * match_type: 'contains' | 'starts_with' | 'exact' | 'regex'
 * field: 'description' | 'merchant' (where 'merchant' matches transactions.merchant_name)
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
  { pattern: 'payroll', matchType: 'contains', field: 'description', categoryName: 'Paycheck', priority: 10 },
  { pattern: 'direct dep', matchType: 'contains', field: 'description', categoryName: 'Paycheck', priority: 10 },
  { pattern: 'salary', matchType: 'contains', field: 'description', categoryName: 'Paycheck', priority: 10 },
  { pattern: 'bonus', matchType: 'contains', field: 'description', categoryName: 'Bonus', priority: 15 },
  { pattern: 'interest paid', matchType: 'contains', field: 'description', categoryName: 'Dividends', priority: 10 },
  { pattern: 'dividend', matchType: 'contains', field: 'description', categoryName: 'Dividends', priority: 10 },
  { pattern: 'tax refund', matchType: 'contains', field: 'description', categoryName: 'Tax Refund', priority: 10 },
  { pattern: 'irs treas', matchType: 'contains', field: 'description', categoryName: 'Tax Refund', priority: 10 },
  { pattern: 'freelance', matchType: 'contains', field: 'description', categoryName: 'Freelance', priority: 15 },
  { pattern: 'rental income', matchType: 'contains', field: 'description', categoryName: 'Rental Income', priority: 15 },

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
  { pattern: 'autozone', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'jiffy lube', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'midas', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'firestone', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'pep boys', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'napa auto', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'o\'reilly auto', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'valvoline', matchType: 'contains', field: 'description', categoryName: 'Auto Repair', priority: 20 },
  { pattern: 'parking', matchType: 'contains', field: 'description', categoryName: 'Parking & Tolls', priority: 25 },
  { pattern: 'toll', matchType: 'contains', field: 'description', categoryName: 'Parking & Tolls', priority: 25 },
  { pattern: 'ez pass', matchType: 'contains', field: 'description', categoryName: 'Parking & Tolls', priority: 20 },
  { pattern: 'sunpass', matchType: 'contains', field: 'description', categoryName: 'Parking & Tolls', priority: 20 },

  // ── Shopping ───────────────────────────────────────────────
  { pattern: 'amazon', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 25 },
  { pattern: 'target', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 25 },
  { pattern: 'ikea', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'etsy', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'ebay', matchType: 'contains', field: 'description', categoryName: 'Shopping', priority: 20 },
  { pattern: 'nordstrom', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },
  { pattern: 'gap ', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 25 },
  { pattern: 'old navy', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },
  { pattern: 'zara', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },
  { pattern: 'h&m', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },
  { pattern: 'tj maxx', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },
  { pattern: 'ross stores', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },
  { pattern: 'marshalls', matchType: 'contains', field: 'description', categoryName: 'Clothing', priority: 20 },

  // ── Electronics ────────────────────────────────────────────
  { pattern: 'best buy', matchType: 'contains', field: 'description', categoryName: 'Electronics', priority: 15 },
  { pattern: 'apple store', matchType: 'contains', field: 'description', categoryName: 'Electronics', priority: 15 },
  { pattern: 'micro center', matchType: 'contains', field: 'description', categoryName: 'Electronics', priority: 15 },
  { pattern: 'newegg', matchType: 'contains', field: 'description', categoryName: 'Electronics', priority: 15 },
  { pattern: 'b&h photo', matchType: 'contains', field: 'description', categoryName: 'Electronics', priority: 15 },
  { pattern: 'adorama', matchType: 'contains', field: 'description', categoryName: 'Electronics', priority: 15 },

  // ── Home & Garden ──────────────────────────────────────────
  { pattern: 'home depot', matchType: 'contains', field: 'description', categoryName: 'Home & Garden', priority: 15 },
  { pattern: 'lowes', matchType: 'contains', field: 'description', categoryName: 'Home & Garden', priority: 15 },
  { pattern: 'ace hardware', matchType: 'contains', field: 'description', categoryName: 'Home & Garden', priority: 15 },
  { pattern: 'true value', matchType: 'contains', field: 'description', categoryName: 'Home & Garden', priority: 15 },
  { pattern: 'menards', matchType: 'contains', field: 'description', categoryName: 'Home & Garden', priority: 15 },
  { pattern: 'tractor supply', matchType: 'contains', field: 'description', categoryName: 'Home & Garden', priority: 15 },
  { pattern: 'nursery', matchType: 'contains', field: 'description', categoryName: 'Lawn & Garden', priority: 20 },
  { pattern: 'garden center', matchType: 'contains', field: 'description', categoryName: 'Lawn & Garden', priority: 20 },

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
  { pattern: 'cvs', matchType: 'contains', field: 'description', categoryName: 'Pharmacy', priority: 15 },
  { pattern: 'walgreens', matchType: 'contains', field: 'description', categoryName: 'Pharmacy', priority: 15 },
  { pattern: 'pharmacy', matchType: 'contains', field: 'description', categoryName: 'Pharmacy', priority: 20 },
  { pattern: 'rx ', matchType: 'contains', field: 'description', categoryName: 'Pharmacy', priority: 25 },
  { pattern: 'medical', matchType: 'contains', field: 'description', categoryName: 'Doctor & Hospital', priority: 25 },
  { pattern: 'hospital', matchType: 'contains', field: 'description', categoryName: 'Doctor & Hospital', priority: 20 },
  { pattern: 'physician', matchType: 'contains', field: 'description', categoryName: 'Doctor & Hospital', priority: 20 },
  { pattern: 'urgent care', matchType: 'contains', field: 'description', categoryName: 'Doctor & Hospital', priority: 15 },
  { pattern: 'dental', matchType: 'contains', field: 'description', categoryName: 'Dental', priority: 15 },
  { pattern: 'dentist', matchType: 'contains', field: 'description', categoryName: 'Dental', priority: 15 },
  { pattern: 'orthodont', matchType: 'contains', field: 'description', categoryName: 'Dental', priority: 15 },
  { pattern: 'optometrist', matchType: 'contains', field: 'description', categoryName: 'Vision', priority: 15 },
  { pattern: 'lenscrafters', matchType: 'contains', field: 'description', categoryName: 'Vision', priority: 15 },
  { pattern: 'eye care', matchType: 'contains', field: 'description', categoryName: 'Vision', priority: 15 },
  { pattern: 'vision center', matchType: 'contains', field: 'description', categoryName: 'Vision', priority: 15 },
  { pattern: 'kaiser', matchType: 'contains', field: 'description', categoryName: 'Healthcare', priority: 20 },
  { pattern: 'therapist', matchType: 'contains', field: 'description', categoryName: 'Mental Health', priority: 15 },
  { pattern: 'counseling', matchType: 'contains', field: 'description', categoryName: 'Mental Health', priority: 20 },
  { pattern: 'betterhelp', matchType: 'contains', field: 'description', categoryName: 'Mental Health', priority: 15 },

  // ── Housing ────────────────────────────────────────────────
  { pattern: 'mortgage', matchType: 'contains', field: 'description', categoryName: 'Mortgage', priority: 10 },
  { pattern: 'rent payment', matchType: 'contains', field: 'description', categoryName: 'Rent', priority: 10 },
  { pattern: 'hoa', matchType: 'contains', field: 'description', categoryName: 'HOA Fees', priority: 15 },
  { pattern: 'home warranty', matchType: 'contains', field: 'description', categoryName: 'Home Maintenance', priority: 20 },
  { pattern: 'plumber', matchType: 'contains', field: 'description', categoryName: 'Home Maintenance', priority: 20 },
  { pattern: 'electrician', matchType: 'contains', field: 'description', categoryName: 'Home Maintenance', priority: 20 },

  // ── Taxes ──────────────────────────────────────────────────
  { pattern: 'property tax', matchType: 'contains', field: 'description', categoryName: 'Property Tax', priority: 10 },
  { pattern: 'county tax', matchType: 'contains', field: 'description', categoryName: 'Property Tax', priority: 10 },
  { pattern: 'irs', matchType: 'contains', field: 'description', categoryName: 'Income Tax', priority: 15 },
  { pattern: 'state tax', matchType: 'contains', field: 'description', categoryName: 'Income Tax', priority: 15 },
  { pattern: 'turbotax', matchType: 'contains', field: 'description', categoryName: 'Taxes', priority: 20 },
  { pattern: 'h&r block', matchType: 'contains', field: 'description', categoryName: 'Taxes', priority: 20 },

  // ── Insurance ──────────────────────────────────────────────
  { pattern: 'geico', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'state farm', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'allstate', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'progressive', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 20 },
  { pattern: 'insurance', matchType: 'contains', field: 'description', categoryName: 'Insurance', priority: 30 },

  // ── Education ──────────────────────────────────────────────
  { pattern: 'tuition', matchType: 'contains', field: 'description', categoryName: 'Tuition & Fees', priority: 15 },
  { pattern: 'university', matchType: 'contains', field: 'description', categoryName: 'Tuition & Fees', priority: 20 },
  { pattern: 'college', matchType: 'contains', field: 'description', categoryName: 'Tuition & Fees', priority: 20 },
  { pattern: 'barnes & noble', matchType: 'contains', field: 'description', categoryName: 'Books & Supplies', priority: 20 },
  { pattern: 'textbook', matchType: 'contains', field: 'description', categoryName: 'Books & Supplies', priority: 20 },
  { pattern: 'chegg', matchType: 'contains', field: 'description', categoryName: 'Books & Supplies', priority: 20 },

  // ── Music & Arts ───────────────────────────────────────────
  { pattern: 'guitar center', matchType: 'contains', field: 'description', categoryName: 'Music & Arts', priority: 15 },
  { pattern: 'sam ash', matchType: 'contains', field: 'description', categoryName: 'Music & Arts', priority: 15 },
  { pattern: 'music lesson', matchType: 'contains', field: 'description', categoryName: 'Lessons & Classes', priority: 15 },
  { pattern: 'piano lesson', matchType: 'contains', field: 'description', categoryName: 'Lessons & Classes', priority: 15 },
  { pattern: 'instrument rental', matchType: 'contains', field: 'description', categoryName: 'Instrument Rental', priority: 15 },

  // ── Kids & Family ──────────────────────────────────────────
  { pattern: 'taekwondo', matchType: 'contains', field: 'description', categoryName: 'Sports & Activities', priority: 15 },
  { pattern: 'karate', matchType: 'contains', field: 'description', categoryName: 'Sports & Activities', priority: 15 },
  { pattern: 'little league', matchType: 'contains', field: 'description', categoryName: 'Sports & Activities', priority: 15 },
  { pattern: 'ymca', matchType: 'contains', field: 'description', categoryName: 'Sports & Activities', priority: 20 },
  { pattern: 'toys r us', matchType: 'contains', field: 'description', categoryName: 'Toys & Games', priority: 15 },
  { pattern: 'lego', matchType: 'contains', field: 'description', categoryName: 'Toys & Games', priority: 20 },
  { pattern: 'build-a-bear', matchType: 'contains', field: 'description', categoryName: 'Toys & Games', priority: 15 },
  { pattern: 'children\'s place', matchType: 'contains', field: 'description', categoryName: 'Kids Clothing', priority: 15 },
  { pattern: 'carter\'s', matchType: 'contains', field: 'description', categoryName: 'Kids Clothing', priority: 15 },
  { pattern: 'oshkosh', matchType: 'contains', field: 'description', categoryName: 'Kids Clothing', priority: 15 },

  // ── Childcare ──────────────────────────────────────────────
  { pattern: 'kindercare', matchType: 'contains', field: 'description', categoryName: 'Childcare', priority: 15 },
  { pattern: 'bright horizons', matchType: 'contains', field: 'description', categoryName: 'Childcare', priority: 15 },
  { pattern: 'childcare', matchType: 'contains', field: 'description', categoryName: 'Childcare', priority: 20 },
  { pattern: 'daycare', matchType: 'contains', field: 'description', categoryName: 'Childcare', priority: 20 },

  // ── Fitness ────────────────────────────────────────────────
  { pattern: 'planet fitness', matchType: 'contains', field: 'description', categoryName: 'Gym & Membership', priority: 15 },
  { pattern: 'la fitness', matchType: 'contains', field: 'description', categoryName: 'Gym & Membership', priority: 15 },
  { pattern: 'anytime fitness', matchType: 'contains', field: 'description', categoryName: 'Gym & Membership', priority: 15 },
  { pattern: 'equinox', matchType: 'contains', field: 'description', categoryName: 'Gym & Membership', priority: 15 },
  { pattern: 'orangetheory', matchType: 'contains', field: 'description', categoryName: 'Gym & Membership', priority: 15 },
  { pattern: 'peloton', matchType: 'contains', field: 'description', categoryName: 'Fitness', priority: 20 },
  { pattern: 'crossfit', matchType: 'contains', field: 'description', categoryName: 'Gym & Membership', priority: 15 },

  // ── Pets ───────────────────────────────────────────────────
  { pattern: 'petco', matchType: 'contains', field: 'description', categoryName: 'Pet Food & Supplies', priority: 15 },
  { pattern: 'petsmart', matchType: 'contains', field: 'description', categoryName: 'Pet Food & Supplies', priority: 15 },
  { pattern: 'chewy', matchType: 'contains', field: 'description', categoryName: 'Pet Food & Supplies', priority: 15 },
  { pattern: 'banfield', matchType: 'contains', field: 'description', categoryName: 'Vet & Medical', priority: 15 },
  { pattern: 'vca animal', matchType: 'contains', field: 'description', categoryName: 'Vet & Medical', priority: 15 },
  { pattern: 'veterinar', matchType: 'contains', field: 'description', categoryName: 'Vet & Medical', priority: 20 },

  // ── Gifts & Donations ─────────────────────────────────────
  { pattern: 'red cross', matchType: 'contains', field: 'description', categoryName: 'Charity & Donations', priority: 15 },
  { pattern: 'united way', matchType: 'contains', field: 'description', categoryName: 'Charity & Donations', priority: 15 },
  { pattern: 'goodwill', matchType: 'contains', field: 'description', categoryName: 'Charity & Donations', priority: 15 },
  { pattern: 'salvation army', matchType: 'contains', field: 'description', categoryName: 'Charity & Donations', priority: 15 },
  { pattern: 'habitat for humanity', matchType: 'contains', field: 'description', categoryName: 'Charity & Donations', priority: 15 },
  { pattern: 'donation', matchType: 'contains', field: 'description', categoryName: 'Charity & Donations', priority: 25 },
  { pattern: 'hallmark', matchType: 'contains', field: 'description', categoryName: 'Gifts', priority: 20 },

  // ── Savings & Investments ──────────────────────────────────
  { pattern: 'fidelity', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: 'vanguard', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: 'schwab', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: 'robinhood', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: 'e*trade', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: '401k', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: 'wealthfront', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },
  { pattern: 'betterment', matchType: 'contains', field: 'description', categoryName: 'Savings & Investments', priority: 15 },

  // ── Transfers (low priority — generic) ─────────────────────
  { pattern: 'transfer', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 50 },
  { pattern: 'zelle', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'venmo', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'cash app', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },
  { pattern: 'paypal', matchType: 'contains', field: 'description', categoryName: 'Transfers', priority: 30 },

  // ── Credit Card Payment ────────────────────────────────────
  { pattern: 'payment - thank you', matchType: 'contains', field: 'description', categoryName: 'Credit Card Payment', priority: 10 },
  { pattern: 'payment thank you', matchType: 'contains', field: 'description', categoryName: 'Credit Card Payment', priority: 10 },
  { pattern: 'autopay payment', matchType: 'contains', field: 'description', categoryName: 'Credit Card Payment', priority: 10 },
  { pattern: 'int sch pymt', matchType: 'contains', field: 'description', categoryName: 'Credit Card Payment', priority: 10 },
  { pattern: 'online payment', matchType: 'contains', field: 'description', categoryName: 'Credit Card Payment', priority: 15 },
];
