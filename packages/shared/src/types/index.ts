export type UserRole = 'admin' | 'member';
export type ThemePreference = 'light' | 'dark' | 'system';
export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'edu_529'
  | 'brokerage'
  | 'cash_sweep';
export type InvestmentAccountType = 'brokerage' | 'retirement' | 'stock_plan';
export type FileType = 'csv' | 'excel' | 'pdf';
export type UploadStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type BudgetPeriod = 'monthly' | 'weekly';
export type RuleMatchType = 'contains' | 'startsWith' | 'regex' | 'exact';
export type RuleField = 'description' | 'merchant';
export type Institution = 'boa' | 'chase' | 'amex' | 'citi' | 'other';

export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'password_changed'
  | 'role_changed'
  | 'transaction_edited'
  | 'transaction_split'
  | 'transaction_split_edited'
  | 'bulk_categorized'
  | 'auto_categorize'
  | 'budget_exceeded'
  | 'file_imported'
  | 'csv_exported'
  | 'file_uploaded'
  | 'file_deleted';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  householdId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Household {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type DigestPeriod = 'daily' | 'weekly' | 'monthly';

export interface UserSettings {
  id: string;
  userId: string;
  timezone: string;
  theme: ThemePreference;
  enableCloudAi: boolean;
  haWebhookUrl: string | null;
  weeklyDigestEnabled: boolean;
  dailyDigestEnabled: boolean;
  monthlyDigestEnabled: boolean;
  advisorDigestEnabled: boolean;
  telegramNotificationsEnabled: boolean;
  notificationEmail: string | null;
  firebaseUid: string | null;
  dailyBriefEnabled: boolean;
  dailyBriefHour: number;
  proactiveAdvisorEnabled: boolean;
}

export interface Account {
  id: string;
  userId: string;
  institution: Institution;
  accountType: AccountType;
  nickname: string;
  lastFour: string;
  startingBalanceCents: number;
  creditLimitCents: number | null;
  /** Basis points (e.g. 450 = 4.50% APY). Only meaningful for interest-bearing types. */
  interestRateBps: number | null;
  /** Annual fee in cents. Only meaningful for accountType = 'credit_card'. */
  annualFeeCents: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  userId: string;
  externalId: string | null;
  txnHash: string;
  date: string;
  description: string;
  originalDescription: string;
  amountCents: number;
  categoryId: string | null;
  merchantName: string | null;
  normalizedMerchantName: string | null;
  isCredit: boolean;
  isManual: boolean;
  tags: string[];
  sourceFileId: string | null;
  parentTransactionId: string | null;
  isSplitParent: boolean;
  originalAmountCents: number | null;
  currencyCode: string | null;
  createdAt: string;
  updatedAt: string;
  /** Number of receipt/bill attachments. Only present on list responses. */
  attachmentCount?: number;
}

export interface TransactionAttachment {
  id: string;
  transactionId: string;
  userId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

export type BillFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semi_annual'
  | 'annual';

export interface RecurringBill {
  id: string;
  userId: string;
  merchantPattern: string;
  normalizedName: string;
  categoryId: string | null;
  expectedAmountCents: number;
  amountTolerancePercent: number;
  frequency: BillFrequency;
  nextExpectedDate: string | null;
  lastSeenDate: string | null;
  lastAmountCents: number | null;
  isActive: boolean;
  isConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LoanType = 'mortgage' | 'auto' | 'personal' | 'student' | 'other';

/** A tracked amortizing loan (mortgage / auto / etc.) for payoff tracking. */
export interface Loan {
  id: string;
  userId: string;
  name: string;
  lenderPattern: string;
  loanType: LoanType;
  originalBalanceCents: number;
  aprBps: number;
  termMonths: number | null;
  startDate: string;
  scheduledPaymentCents: number;
  extraPrincipalPattern: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A recurring bill projected as a subscription with annualized cost and price-change detection. */
export interface SubscriptionItem {
  id: string;
  name: string;
  amountCents: number;
  frequency: BillFrequency;
  annualCostCents: number;
  /** Most recently seen charge amount (may differ from amountCents if price changed). */
  lastAmountCents: number | null;
  /** True when lastAmountCents exceeds the upper tolerance of expectedAmountCents. */
  priceIncreased: boolean;
  categoryId: string | null;
  nextExpectedDate: string | null;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  parentId: string | null;
  sortOrder: number;
  isTransfer: boolean;
  bucket: 'needs' | 'wants' | 'savings_debt' | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaycheckProfile {
  id: string;
  userId: string;
  effectiveDate: string;
  payFrequency: 'weekly' | 'biweekly' | 'semi_monthly' | 'monthly';
  grossPayCents: number;
  federalTaxCents: number;
  stateTaxCents: number;
  socialSecurityCents: number;
  medicareCents: number;
  pretax401kCents: number;
  hsaCents: number;
  medicalPremiumCents: number;
  dentalPremiumCents: number;
  visionPremiumCents: number;
  commuterCents: number;
  parkingCents: number;
  otherPretaxCents: number;
  supplementalLifeCents: number;
  legalCents: number;
  accidentInsuranceCents: number;
  otherPosttaxCents: number;
  esppContributionCents: number;
  esppDiscountPercent: number | null;
  employer401kMatchCents: number;
  employerHealthContributionCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategorizationRule {
  id: string;
  userId: string;
  pattern: string;
  matchType: RuleMatchType;
  field: RuleField;
  categoryId: string;
  priority: number;
  isAiGenerated: boolean;
  confidence: number | null;
}

export interface Budget {
  id: string;
  userId: string | null;
  householdId: string | null;
  categoryId: string;
  amountCents: number;
  period: BudgetPeriod;
  createdAt: string;
  updatedAt: string;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileUpload {
  id: string;
  userId: string;
  accountId: string;
  filename: string;
  fileType: FileType;
  fileHash: string;
  status: UploadStatus;
  rowsImported: number;
  rowsSkipped: number;
  rowsErrored: number;
  errorLog: FileUploadError[];
  archivedPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileUploadError {
  row: number;
  error: string;
  raw: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  webhookSent: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: {
    database: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
    ollama: 'connected' | 'unavailable' | 'external';
  };
  version: string;
}

// ── Ingestion Types ─────────────────────────────────────────

export interface ParsedTransaction {
  externalId: string | null;
  date: string; // ISO date string YYYY-MM-DD
  description: string;
  amountCents: number; // always positive
  isCredit: boolean;
  merchantName: string | null;
  runningBalanceCents: number | null;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: FileUploadError[];
  detectedInstitution: Institution | null;
}

export interface CsvFormatConfig {
  delimiter: string; // default ','
  dateColumn: string; // column name or index
  dateFormat: string; // e.g., 'MM/DD/YYYY', 'YYYY-MM-DD'
  descriptionColumn: string;
  amountColumn: string | null; // single amount column (null if split)
  debitColumn: string | null; // for split debit/credit
  creditColumn: string | null; // for split debit/credit
  signConvention: 'negative_debit' | 'positive_debit' | 'split_columns';
  externalIdColumn: string | null; // optional bank txn reference
  skipRows: number; // header rows to skip (0 = first row is header)
  merchantColumn: string | null;
  balanceColumn: string | null;
}

export const DEFAULT_CSV_FORMAT: CsvFormatConfig = {
  delimiter: ',',
  dateColumn: 'Date',
  dateFormat: 'MM/DD/YYYY',
  descriptionColumn: 'Description',
  amountColumn: 'Amount',
  debitColumn: null,
  creditColumn: null,
  signConvention: 'negative_debit',
  externalIdColumn: null,
  skipRows: 0,
  merchantColumn: null,
  balanceColumn: null,
};

// API response wrappers
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error: string;
}

// ── Auth Types ──────────────────────────────────────────────

export interface AuthTokenPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
  householdId: string | null;
  mustChangePassword: boolean;
}

export interface AuthResponse {
  user: User;
  mustChangePassword: boolean;
}

export interface MeResponse {
  user: User;
  settings: UserSettings | null;
  household: Household | null;
  mustChangePassword: boolean;
}

export interface InviteResponse {
  user: User;
  temporaryPassword: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface InvestmentAccount {
  id: string;
  userId: string;
  institution: string;
  accountType: string;
  nickname: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Latest snapshot balance in cents (null if no snapshot yet). */
  latestBalanceCents: number | null;
  /** Date of the latest snapshot. */
  latestSnapshotDate: string | null;
}

export interface InvestmentSnapshot {
  id: string;
  investmentAccountId: string;
  date: string;
  balanceCents: number;
  createdAt: string;
}

/** User-declared ticker + share count as-of a date. Append-only: an edit is a new row. */
export interface InvestmentHolding {
  id: string;
  investmentAccountId: string;
  ticker: string;
  shareCount: string;
  asOf: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One EOD close price for a ticker, from an autonomous market-data refresh. */
export interface SecurityPrice {
  ticker: string;
  priceDate: string;
  closeCents: number;
  currency: string;
  source: string;
  fetchedAt: string;
}

/** One priced (or unpriced) holding line in a portfolio value breakdown. */
export interface PortfolioValueHolding {
  investmentAccountId: string;
  ticker: string;
  shareCount: string;
  asOf: string;
  /** True when this holding's as-of date is older than staleDays. */
  isStale: boolean;
  priceDate: string | null;
  closeCents: number | null;
  /** Null when no price data is available yet for this ticker. */
  marketValueCents: number | null;
}

/** Total portfolio market value + per-holding breakdown (shares x latest EOD close). */
export interface PortfolioValue {
  totalCents: number;
  holdings: PortfolioValueHolding[];
  /** True if any holding is older than staleDays — declared shares may be stale. */
  staleFound: boolean;
  /** True if any held ticker has no price data yet (excluded from totalCents). */
  missingPriceFound: boolean;
  staleDays: number;
}

/** One ticker's share of total portfolio market value. */
export interface AllocationEntry {
  ticker: string;
  valueCents: number;
  pct: number;
}

/** Portfolio allocation: percent of total market value held in each ticker. */
export interface Allocation {
  totalCents: number;
  allocations: AllocationEntry[];
  staleFound: boolean;
  missingPriceFound: boolean;
  staleDays: number;
}

// ── Monthly Close: Manual Assets, Loan Balance Snapshots, Monthly Financial
// Snapshots (13.1) ────────────────────────────────────────────
// User-scoped only — no household_id (household scope deferred per epic #158
// decision #5).

export type ManualAssetType = 'home' | 'car' | 'gold' | 'other';
export type ManualAssetLiquidityClass = 'liquid' | 'semi_liquid' | 'illiquid';
export type ManualAssetSnapshotSource = 'manual' | 'estimate' | 'imported';
export type LoanBalanceSnapshotSource = 'amortized' | 'manual_statement';
export type MonthlyCloseStatus = 'draft' | 'confirmed';
export type TargetStatusLevel = 'green' | 'yellow' | 'red' | 'info' | 'unknown';

export interface ManualAsset {
  id: string;
  userId: string;
  name: string;
  assetType: ManualAssetType;
  liquidityClass: ManualAssetLiquidityClass;
  isDepreciating: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ManualAssetSnapshot {
  id: string;
  manualAssetId: string;
  snapshotMonth: string; // first day of month
  valueCents: number;
  source: ManualAssetSnapshotSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanBalanceSnapshot {
  id: string;
  loanId: string;
  snapshotMonth: string; // first day of month
  balanceCents: number;
  source: LoanBalanceSnapshotSource;
  verifiedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Frozen monthly household close: balance sheet, income statement, and ratios for
 *  one calendar month. Confirmed rows stay editable — `isEdited`/`editedAt` are the
 *  lightweight audit trail (no separate events table, per epic #158 decision #6). */
export interface MonthlyFinancialSnapshot {
  id: string;
  userId: string;
  snapshotMonth: string; // first day of month
  status: MonthlyCloseStatus;

  takeHomeIncomeCents: number;
  grossIncomeCents: number | null;
  expenseCents: number;
  fixedExpenseCents: number;
  variableExpenseCents: number;

  cashSavingsCents: number;
  investmentContributionCents: number;
  debtPrincipalPaidCents: number;
  extraDebtPrincipalPaidCents: number;

  liquidAssetCents: number;
  investmentAssetCents: number;
  manualAssetCents: number;
  totalAssetCents: number;

  creditCardLiabilityCents: number;
  loanLiabilityCents: number;
  totalLiabilityCents: number;
  netWorthCents: number;

  savingsRateBps: number | null;
  investingRateBps: number | null;
  debtPaydownRateBps: number | null;
  wealthBuildingRateBps: number | null;
  expenseRatioBps: number | null;
  liquidNetWorthRatioBps: number | null;
  debtAssetRatioBps: number | null;
  debtPaymentIncomeRatioBps: number | null;

  targetStatus: Record<string, TargetStatusLevel>;
  freshness: Record<string, unknown>;
  calculationVersion: string;
  notes: string | null;
  aiReview: string | null;
  editedAt: string | null;
  isEdited: boolean;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Rollup shape returned by `GET /monthly-close` list + detail endpoints. */
export interface MonthlyCloseSummary {
  month: string;
  status: MonthlyCloseStatus;
  headline: {
    expensesCents: number;
    netWorthCents: number;
    savingsRateBps: number | null;
    investingRateBps: number | null;
    debtPaydownRateBps: number | null;
    liquidNetWorthRatioBps: number | null;
  };
  // MonthlyCloseSection shape is defined in a later 13.x slice (grid/UI-facing);
  // left as unknown[] here since this issue is schema-only.
  sections: unknown[];
  targetStatus: Record<string, TargetStatusLevel>;
  freshness: {
    isComplete: boolean;
    missingManualAssets: string[];
    staleAccounts: string[];
    unverifiedLoans: string[];
    missingInvestmentPrices: string[];
  };
  notes: string | null;
  aiReview: string | null;
}
