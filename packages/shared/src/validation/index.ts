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
  accountType: z.enum(['checking', 'savings', 'credit_card']),
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
});

export const updateTransactionSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  categoryId: z.uuid().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

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
  categoryId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
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
  notificationEmail: z.email().nullable().optional(),
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
