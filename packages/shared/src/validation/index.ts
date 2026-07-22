import { z } from 'zod/v4';
import { MIN_PASSWORD_LENGTH } from '../constants/index.js';

// ── Auth ────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
  displayName: z.string().min(1).max(100),
});

export const inviteUserSchema = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(100),
  role: z.enum(['admin', 'member']),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
});

// ── Accounts ────────────────────────────────────────────────

export const createAccountSchema = z.object({
  institution: z.enum(['boa', 'chase', 'amex', 'citi', 'other']),
  accountType: z.enum([
    'checking',
    'savings',
    'credit_card',
    'edu_529',
    'brokerage',
    'cash_sweep',
  ]),
  nickname: z.string().min(1).max(100),
  lastFour: z
    .string()
    .length(4)
    .regex(/^\d{4}$/),
  startingBalanceCents: z.int(),
  creditLimitCents: z.int().nullable().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();

// ── CSV Format Config ────────────────────────────────────────

export const csvFormatConfigSchema = z
  .object({
    delimiter: z.string().min(1).max(5).default(','),
    dateColumn: z.string().min(1).max(200),
    dateFormat: z.enum([
      'MM/DD/YYYY',
      'M/D/YYYY',
      'DD/MM/YYYY',
      'YYYY-MM-DD',
      'MM-DD-YYYY',
    ]),
    descriptionColumn: z.string().min(1).max(200),
    amountColumn: z.string().max(200).nullable().default(null),
    debitColumn: z.string().max(200).nullable().default(null),
    creditColumn: z.string().max(200).nullable().default(null),
    signConvention: z.enum(['negative_debit', 'positive_debit', 'split_columns']),
    externalIdColumn: z.string().max(200).nullable().default(null),
    skipRows: z.int().min(0).max(20).default(0),
    merchantColumn: z.string().max(200).nullable().default(null),
    balanceColumn: z.string().max(200).nullable().default(null),
  })
  .refine(
    (d: { signConvention: string; debitColumn: string | null; creditColumn: string | null }) =>
      d.signConvention !== 'split_columns' ||
      (d.debitColumn !== null && d.creditColumn !== null),
    {
      message:
        'debitColumn and creditColumn are required when signConvention is "split_columns"',
      path: ['debitColumn'],
    },
  );

export type CsvFormatConfigInput = z.infer<typeof csvFormatConfigSchema>;



export const createTransactionSchema = z.object({
  accountId: z.uuid(),
  date: z.iso.date(),
  description: z.string().min(1).max(500),
  amountCents: z.int(),
  categoryId: z.uuid().nullable().optional(),
  merchantName: z.string().max(200).nullable().optional(),
  isCredit: z.boolean(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  originalAmountCents: z.int().positive().nullable().optional(),
  currencyCode: z.string().length(3).regex(/^[A-Z]{3}$/).nullable().optional(),
}).refine(
  (d) => (d.originalAmountCents != null) === (d.currencyCode != null),
  { message: 'originalAmountCents and currencyCode must both be set or both be null' },
);

export const updateTransactionSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  categoryId: z.uuid().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  originalAmountCents: z.int().positive().nullable().optional(),
  currencyCode: z.string().length(3).regex(/^[A-Z]{3}$/).nullable().optional(),
}).refine(
  (d) => (d.originalAmountCents != null) === (d.currencyCode != null),
  { message: 'originalAmountCents and currencyCode must both be set or both be null' },
);

export const splitTransactionSchema = z.object({
  splits: z
    .array(
      z.object({
        amountCents: z.int(),
        categoryId: z.uuid(),
        description: z.string().max(500).optional(),
      }),
    )
    .min(2),
});

export const bulkCategorizeSchema = z.object({
  transactionIds: z.array(z.uuid()).min(1).max(500),
  categoryId: z.uuid(),
});

export const transactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
  accountId: z.uuid().optional(),
  categoryId: z.union([z.uuid(), z.literal('__uncategorized__')]).optional(),
  uploadId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  isCredit: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  excludeTransfers: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  sortBy: z.enum(['date', 'amount', 'description', 'category']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ── Categories ──────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().min(1).max(50),
  icon: z.string().max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  parentId: z.uuid().nullable().optional(),
  sortOrder: z.int().min(0).optional(),
  isTransfer: z.boolean().optional(),
  bucket: z.enum(['needs', 'wants', 'savings_debt']).nullable().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const reorderCategoriesSchema = z.object({
  items: z
    .array(z.object({ id: z.uuid(), sortOrder: z.int().min(0) }))
    .min(1),
});

// ── Categorization Rules ────────────────────────────────────

export const createRuleSchema = z.object({
  pattern: z.string().min(1).max(500),
  matchType: z.enum(['contains', 'starts_with', 'exact', 'regex']),
  field: z.enum(['description', 'merchant']),
  categoryId: z.uuid(),
  priority: z.int().min(0).max(100).optional(),
});

export const updateRuleSchema = createRuleSchema.partial();

// ── Budgets ─────────────────────────────────────────────────

export const createBudgetSchema = z.object({
  categoryId: z.uuid(),
  amountCents: z.int().min(1),
  period: z.enum(['monthly', 'weekly']),
  householdId: z.uuid().nullable().optional(),
});

export const updateBudgetSchema = createBudgetSchema.partial();

// ── Savings Goals ───────────────────────────────────────────

export const createSavingsGoalSchema = z.object({
  name: z.string().min(1).max(100),
  targetAmountCents: z.int().min(1),
  targetDate: z.iso.date().nullable().optional(),
});

export const updateSavingsGoalSchema = createSavingsGoalSchema.partial();

// ── User Settings ───────────────────────────────────────────

export const updateUserSettingsSchema = z.object({
  timezone: z.string().max(50).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  enableCloudAi: z.boolean().optional(),
  haWebhookUrl: z.url().nullable().optional(),
  weeklyDigestEnabled: z.boolean().optional(),
  dailyDigestEnabled: z.boolean().optional(),
  monthlyDigestEnabled: z.boolean().optional(),
  advisorDigestEnabled: z.boolean().optional(),
  telegramNotificationsEnabled: z.boolean().optional(),
  notificationEmail: z.email().nullable().optional(),
  firebaseUid: z.string().max(128).nullable().optional(),
  dailyBriefEnabled: z.boolean().optional(),
  dailyBriefHour: z.number().int().min(0).max(23).optional(),
  proactiveAdvisorEnabled: z.boolean().optional(),
});

export const sendDigestSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']),
});

// ── File Upload ─────────────────────────────────────────────

export const uploadFileSchema = z.object({
  accountId: z.uuid(),
});

// ── Analytics ───────────────────────────────────────────────

export const analyticsQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  household: z.coerce.boolean().default(false),
});

export const spendingTrendQuerySchema = analyticsQuerySchema.extend({
  granularity: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

export const topMerchantsQuerySchema = analyticsQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const savingsRateQuerySchema = analyticsQuerySchema.extend({
  months: z.coerce.number().int().min(1).max(60).optional(),
});

export const budgetPlanQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM'),
});

export const forecastQuerySchema = z.object({
  days: z.coerce.number().int().refine((v) => [30, 60, 90].includes(v), {
    message: 'days must be 30, 60, or 90',
  }).default(90),
});

// Export inferred types
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type SplitTransactionInput = z.infer<typeof splitTransactionSchema>;
export type BulkCategorizeInput = z.infer<typeof bulkCategorizeSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type CreateSavingsGoalInput = z.infer<typeof createSavingsGoalSchema>;
export type UpdateSavingsGoalInput = z.infer<typeof updateSavingsGoalSchema>;
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
export type UploadFileInput = z.infer<typeof uploadFileSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type SpendingTrendQuery = z.infer<typeof spendingTrendQuerySchema>;
export type TopMerchantsQuery = z.infer<typeof topMerchantsQuerySchema>;
export type ForecastQuery = z.infer<typeof forecastQuerySchema>;
export type SavingsRateQuery = z.infer<typeof savingsRateQuerySchema>;
export type BudgetPlanQuery = z.infer<typeof budgetPlanQuerySchema>;

// ── Recurring Bills ──────────────────────────────────────────

export const billFrequencyEnum = z.enum([
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'semi_annual',
  'annual',
]);

export const updateBillSchema = z.object({
  normalizedName: z.string().min(1).max(200).optional(),
  expectedAmountCents: z.number().int().positive().optional(),
  amountTolerancePercent: z.number().int().min(0).max(50).optional(),
  frequency: billFrequencyEnum.optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

export type UpdateBillInput = z.infer<typeof updateBillSchema>;

// ── Investment Accounts ──────────────────────────────────────

export const createInvestmentAccountSchema = z.object({
  institution: z.string().min(1).max(100),
  accountType: z.string().min(1).max(50),
  nickname: z.string().min(1).max(100),
});

export const updateInvestmentAccountSchema = createInvestmentAccountSchema.partial();

export const addSnapshotSchema = z.object({
  balanceCents: z.int().min(0),
  date: z.iso.date().optional(),
});

export type CreateInvestmentAccountInput = z.infer<typeof createInvestmentAccountSchema>;
export type UpdateInvestmentAccountInput = z.infer<typeof updateInvestmentAccountSchema>;
export type AddSnapshotInput = z.infer<typeof addSnapshotSchema>;

// ── Investment Holdings (12.2) ───────────────────────────────
// User-declared ticker + share count as-of a date. Edits APPEND a new row
// (history kept) — same append-only pattern as investment snapshots above.

export const addHoldingSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((s) => s.toUpperCase()),
  shareCount: z.number().positive(),
  asOf: z.iso.date(),
  notes: z.string().max(500).optional(),
});

export type AddHoldingInput = z.infer<typeof addHoldingSchema>;

// ── Loans (mortgage / auto payoff tracker) ───────────────────

export const createLoanSchema = z.object({
  name: z.string().min(1).max(100),
  lenderPattern: z.string().min(1).max(200),
  loanType: z.enum(['mortgage', 'auto', 'personal', 'student', 'other']).default('mortgage'),
  originalBalanceCents: z.int().positive(),
  aprBps: z.int().min(0).max(100000),
  termMonths: z.int().positive().max(600).optional(),
  startDate: z.iso.date(),
  scheduledPaymentCents: z.int().positive(),
  extraPrincipalPattern: z.string().max(200).nullable().optional(),
});

export const updateLoanSchema = createLoanSchema.partial();

export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type UpdateLoanInput = z.infer<typeof updateLoanSchema>;

// ── Rate watchlist (12.3) ─────────────────────────────────────

export const createRateWatchlistSchema = z.object({
  institution: z.string().min(1).max(200),
  productType: z.enum(['hysa', 'cd', 'mmf', 'treasury']),
  apyBps: z.int().min(0).max(100000),
  termMonths: z.int().positive().max(600).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const updateRateWatchlistSchema = createRateWatchlistSchema.partial();

export type CreateRateWatchlistInput = z.infer<typeof createRateWatchlistSchema>;
export type UpdateRateWatchlistInput = z.infer<typeof updateRateWatchlistSchema>;

// ── Suitability Settings & Investment Policy (12.4) ─────────────
// Every successful write creates a new *version* (see schema.ts) — this is the input
// shape for that write, not a partial patch of an existing row.

export const targetAllocationEntrySchema = z.object({
  assetClass: z.string().min(1).max(60),
  targetPercent: z.number().min(0).max(100),
});

export const suitabilitySettingsInputSchema = z.object({
  emergencyFundTargetMonths: z.int().min(0).max(60).default(6),
  liquidityHorizonMonths: z.int().min(0).max(600).nullable().optional(),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive']).nullable().optional(),
  taxState: z.string().length(2).nullable().optional(),
  monthlyInvestingTargetCents: z.int().min(0).nullable().optional(),
  targetAllocation: z.array(targetAllocationEntrySchema).default([]),
  tickerAssetClassMap: z.record(z.string(), z.string()).default({}),
  dcaDayOfMonth: z.int().min(1).max(28).nullable().optional(),
  dcaAmountCents: z.int().min(0).nullable().optional(),
});

export type SuitabilitySettingsInput = z.infer<typeof suitabilitySettingsInputSchema>;
export type TargetAllocationEntry = z.infer<typeof targetAllocationEntrySchema>;

// ── Paycheck Profiles (11.11 — take-home pay modeling) ──────
// Effective-dated: a new row is created whenever gross pay, withholdings, or
// deductions change (raise, benefits election, etc). Rows are never mutated to
// reflect a real-world pay change — `update` is only for correcting entry mistakes.

export const createPaycheckProfileSchema = z.object({
  effectiveDate: z.iso.date(),
  payFrequency: z.enum(['weekly', 'biweekly', 'semi_monthly', 'monthly']),
  grossPayCents: z.int().positive(),
  federalTaxCents: z.int().min(0).default(0),
  stateTaxCents: z.int().min(0).default(0),
  socialSecurityCents: z.int().min(0).default(0),
  medicareCents: z.int().min(0).default(0),
  pretax401kCents: z.int().min(0).default(0),
  hsaCents: z.int().min(0).default(0),
  medicalPremiumCents: z.int().min(0).default(0),
  dentalPremiumCents: z.int().min(0).default(0),
  visionPremiumCents: z.int().min(0).default(0),
  commuterCents: z.int().min(0).default(0),
  parkingCents: z.int().min(0).default(0),
  otherPretaxCents: z.int().min(0).default(0),
  supplementalLifeCents: z.int().min(0).default(0),
  legalCents: z.int().min(0).default(0),
  accidentInsuranceCents: z.int().min(0).default(0),
  otherPosttaxCents: z.int().min(0).default(0),
  esppContributionCents: z.int().min(0).default(0),
  esppDiscountPercent: z.int().min(0).max(100).nullable().optional(),
  employer401kMatchCents: z.int().min(0).default(0),
  employerHealthContributionCents: z.int().min(0).default(0),
  notes: z.string().max(1000).nullable().optional(),
});

export const updatePaycheckProfileSchema = createPaycheckProfileSchema.partial();

export type CreatePaycheckProfileInput = z.infer<typeof createPaycheckProfileSchema>;
export type UpdatePaycheckProfileInput = z.infer<typeof updatePaycheckProfileSchema>;
