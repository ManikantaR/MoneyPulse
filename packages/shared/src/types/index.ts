export type UserRole = 'admin' | 'member';
export type ThemePreference = 'light' | 'dark' | 'system';
export type AccountType = 'checking' | 'savings' | 'credit_card';
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
  | 'bulk_categorized'
  | 'budget_exceeded'
  | 'file_imported';

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

export interface UserSettings {
  id: string;
  userId: string;
  timezone: string;
  theme: ThemePreference;
  enableCloudAi: boolean;
  haWebhookUrl: string | null;
  weeklyDigestEnabled: boolean;
  notificationEmail: string | null;
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
  isCredit: boolean;
  isManual: boolean;
  tags: string[];
  sourceFileId: string | null;
  parentTransactionId: string | null;
  isSplitParent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  parentId: string | null;
  sortOrder: number;
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
