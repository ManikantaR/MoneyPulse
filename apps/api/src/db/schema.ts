import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  bigserial,
  uniqueIndex,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ── Enums ───────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['admin', 'member']);
export const accountTypeEnum = pgEnum('account_type', [
  'checking',
  'savings',
  'credit_card',
]);
export const institutionEnum = pgEnum('institution', [
  'boa',
  'chase',
  'amex',
  'citi',
  'other',
]);
export const fileTypeEnum = pgEnum('file_type', ['csv', 'excel', 'pdf']);
export const uploadStatusEnum = pgEnum('upload_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);
export const budgetPeriodEnum = pgEnum('budget_period', ['monthly', 'weekly']);
export const ruleMatchTypeEnum = pgEnum('rule_match_type', [
  'contains',
  'starts_with',
  'regex',
  'exact',
]);
export const ruleFieldEnum = pgEnum('rule_field', ['description', 'merchant']);
export const themeEnum = pgEnum('theme', ['light', 'dark', 'system']);

// ── Households ──────────────────────────────────────────────

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Users ───────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  role: userRoleEnum('role').notNull().default('member'),
  householdId: uuid('household_id').references(() => households.id),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  firebaseUid: varchar('firebase_uid', { length: 128 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── User Settings ───────────────────────────────────────────

export const userSettings = pgTable('user_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  timezone: varchar('timezone', { length: 50 })
    .notNull()
    .default('America/New_York'),
  theme: themeEnum('theme').notNull().default('system'),
  enableCloudAi: boolean('enable_cloud_ai').notNull().default(false),
  haWebhookUrl: text('ha_webhook_url'),
  weeklyDigestEnabled: boolean('weekly_digest_enabled')
    .notNull()
    .default(false),
  notificationEmail: varchar('notification_email', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Accounts ────────────────────────────────────────────────

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  institution: institutionEnum('institution').notNull(),
  accountType: accountTypeEnum('account_type').notNull(),
  nickname: varchar('nickname', { length: 100 }).notNull(),
  lastFour: varchar('last_four', { length: 4 }).notNull(),
  startingBalanceCents: integer('starting_balance_cents').notNull().default(0),
  creditLimitCents: integer('credit_limit_cents'),
  csvFormatConfig: jsonb('csv_format_config'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── Categories ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const categories: any = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull(),
  icon: varchar('icon', { length: 10 }).notNull(),
  color: varchar('color', { length: 7 }).notNull(),
  parentId: uuid('parent_id').references((): any => categories.id),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── File Uploads ────────────────────────────────────────────

export const fileUploads = pgTable('file_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  filename: varchar('filename', { length: 500 }).notNull(),
  fileType: fileTypeEnum('file_type').notNull(),
  fileHash: varchar('file_hash', { length: 64 }).notNull(),
  status: uploadStatusEnum('status').notNull().default('pending'),
  rowsImported: integer('rows_imported').notNull().default(0),
  rowsSkipped: integer('rows_skipped').notNull().default(0),
  rowsErrored: integer('rows_errored').notNull().default(0),
  errorLog: jsonb('error_log').default([]),
  archivedPath: text('archived_path'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Transactions ────────────────────────────────────────────

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    externalId: varchar('external_id', { length: 255 }),
    txnHash: varchar('txn_hash', { length: 64 }).notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    description: text('description').notNull(),
    originalDescription: text('original_description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    categoryId: uuid('category_id').references(() => categories.id),
    merchantName: varchar('merchant_name', { length: 200 }),
    isCredit: boolean('is_credit').notNull().default(false),
    isManual: boolean('is_manual').notNull().default(false),
    tags: text('tags').array().default([]),
    sourceFileId: uuid('source_file_id').references(() => fileUploads.id),
    parentTransactionId: uuid('parent_transaction_id'),
    isSplitParent: boolean('is_split_parent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('idx_txn_account_external_id').on(
      table.accountId,
      table.externalId,
    ),
    uniqueIndex('idx_txn_account_hash').on(table.accountId, table.txnHash),
    index('idx_txn_user_date').on(table.userId, table.date),
    index('idx_txn_category').on(table.categoryId),
    index('idx_txn_parent').on(table.parentTransactionId),
  ],
);

// ── Categorization Rules ────────────────────────────────────

export const categorizationRules = pgTable('categorization_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  pattern: text('pattern').notNull(),
  matchType: ruleMatchTypeEnum('match_type').notNull(),
  field: ruleFieldEnum('field').notNull().default('description'),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  priority: integer('priority').notNull().default(0),
  isAiGenerated: boolean('is_ai_generated').notNull().default(false),
  confidence: real('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── Budgets ─────────────────────────────────────────────────

export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  householdId: uuid('household_id').references(() => households.id),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  amountCents: integer('amount_cents').notNull(),
  period: budgetPeriodEnum('period').notNull().default('monthly'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── Savings Goals ───────────────────────────────────────────

export const savingsGoals = pgTable('savings_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  name: varchar('name', { length: 100 }).notNull(),
  targetAmountCents: integer('target_amount_cents').notNull(),
  currentAmountCents: integer('current_amount_cents').notNull().default(0),
  targetDate: timestamp('target_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── Notifications ───────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  webhookSent: boolean('webhook_sent').notNull().default(false),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Audit Logs ──────────────────────────────────────────────

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    action: varchar('action', { length: 50 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_audit_user').on(table.userId),
    index('idx_audit_action').on(table.action),
    index('idx_audit_created').on(table.createdAt),
  ],
);

// ── Investment Accounts (Phase 8) ───────────────────────────

export const investmentAccounts = pgTable('investment_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  institution: varchar('institution', { length: 100 }).notNull(),
  accountType: varchar('account_type', { length: 50 }).notNull(),
  nickname: varchar('nickname', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const investmentSnapshots = pgTable('investment_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  investmentAccountId: uuid('investment_account_id')
    .notNull()
    .references(() => investmentAccounts.id),
  date: timestamp('date', { withTimezone: true }).notNull(),
  balanceCents: integer('balance_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── AI Prompt Logs ──────────────────────────────────────────

export const aiPromptTypeEnum = pgEnum('ai_prompt_type', [
  'categorization',
  'pdf_parse',
]);

export const aiPromptLogs = pgTable(
  'ai_prompt_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    promptType: aiPromptTypeEnum('prompt_type').notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    inputText: text('input_text').notNull(),
    outputText: text('output_text'),
    tokenCountIn: integer('token_count_in'),
    tokenCountOut: integer('token_count_out'),
    latencyMs: integer('latency_ms'),
    transactionsCount: integer('transactions_count'),
    categoriesAssigned: integer('categories_assigned'),
    avgConfidence: real('avg_confidence'),
    piiDetected: boolean('pii_detected').notNull().default(false),
    piiTypesFound: jsonb('pii_types_found').default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_ai_log_user').on(table.userId),
    index('idx_ai_log_type').on(table.promptType),
    index('idx_ai_log_created').on(table.createdAt),
  ],
);

// ── Sync Outbox (Phase 6.7) ───────────────────────────────

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 80 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    householdId: uuid('household_id').references(() => households.id),
    payloadJson: jsonb('payload_json').notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    idempotencyKey: varchar('idempotency_key', { length: 128 })
      .notNull()
      .unique(),
    status: varchar('status', { length: 24 }).notNull().default('pending'),
    policyPassed: boolean('policy_passed'),
    policyReason: text('policy_reason'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    lastErrorMessage: text('last_error_message'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_outbox_status_next_attempt').on(table.status, table.nextAttemptAt),
    index('idx_outbox_user_created').on(table.userId, table.createdAt),
    index('idx_outbox_aggregate').on(table.aggregateType, table.aggregateId),
  ],
);

export const syncAuditLogs = pgTable(
  'sync_audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    outboxEventId: uuid('outbox_event_id')
      .notNull()
      .references(() => outboxEvents.id),
    userId: uuid('user_id').references(() => users.id),
    action: varchar('action', { length: 40 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    policyPassed: boolean('policy_passed').notNull(),
    policyReason: text('policy_reason'),
    signatureKid: varchar('signature_kid', { length: 64 }),
    attemptNo: integer('attempt_no').notNull(),
    httpStatus: integer('http_status'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_sync_audit_outbox').on(table.outboxEventId),
    index('idx_sync_audit_created').on(table.createdAt),
  ],
);

// ── Relations ───────────────────────────────────────────────

export const householdRelations = relations(households, ({ many }) => ({
  users: many(users),
  budgets: many(budgets),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  household: one(households, {
    fields: [users.householdId],
    references: [households.id],
  }),
  settings: one(userSettings, {
    fields: [users.id],
    references: [userSettings.userId],
  }),
  accounts: many(accounts),
  transactions: many(transactions),
  budgets: many(budgets),
  savingsGoals: many(savingsGoals),
  notifications: many(notifications),
}));

export const accountRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
  transactions: many(transactions),
  fileUploads: many(fileUploads),
}));

export const transactionRelations = relations(
  transactions,
  ({ one, many }) => ({
    account: one(accounts, {
      fields: [transactions.accountId],
      references: [accounts.id],
    }),
    user: one(users, {
      fields: [transactions.userId],
      references: [users.id],
    }),
    category: one(categories, {
      fields: [transactions.categoryId],
      references: [categories.id],
    }),
    sourceFile: one(fileUploads, {
      fields: [transactions.sourceFileId],
      references: [fileUploads.id],
    }),
    parent: one(transactions, {
      fields: [transactions.parentTransactionId],
      references: [transactions.id],
      relationName: 'splitChildren',
    }),
    children: many(transactions, { relationName: 'splitChildren' }),
  }),
);

export const categoryRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'subcategories',
  }),
  children: many(categories, { relationName: 'subcategories' }),
  transactions: many(transactions),
  budgets: many(budgets),
  rules: many(categorizationRules),
}));

export const budgetRelations = relations(budgets, ({ one }) => ({
  user: one(users, {
    fields: [budgets.userId],
    references: [users.id],
  }),
  household: one(households, {
    fields: [budgets.householdId],
    references: [households.id],
  }),
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));
