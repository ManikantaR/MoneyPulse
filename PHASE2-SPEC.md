# Phase 2: Bank Accounts & CSV/Excel Ingestion — Implementation Spec

**Dependencies**: Phase 1 (auth, users, audit, Redis, Zod pipe)

## Decisions Summary

| #   | Decision                  | Choice                                             |
| --- | ------------------------- | -------------------------------------------------- |
| 1   | CSV parser library        | `csv-parse` (Node.js streaming)                    |
| 2   | Generic CSV format config | Per-account column in DB (`csvFormatConfig` jsonb) |
| 3   | Watch folder              | Inside API container via `chokidar`                |
| 4   | Account slug              | Include `last_four` (e.g., `bofa-checking-1234`)   |
| 5   | BullMQ workers            | Same NestJS process                                |
| 6   | Partial import            | Import all valid rows, log errors in jsonb         |

---

## File Inventory

### Backend (apps/api/)

| #   | File                                             | Purpose                                 |
| --- | ------------------------------------------------ | --------------------------------------- |
| 1   | `src/accounts/accounts.module.ts`                | Account module wiring                   |
| 2   | `src/accounts/accounts.service.ts`               | Account CRUD + slug generation          |
| 3   | `src/accounts/accounts.controller.ts`            | REST endpoints for bank accounts        |
| 4   | `src/ingestion/ingestion.module.ts`              | Ingestion module wiring                 |
| 5   | `src/ingestion/ingestion.service.ts`             | Upload orchestration + status           |
| 6   | `src/ingestion/ingestion.controller.ts`          | File upload + status endpoints          |
| 7   | `src/ingestion/parsers/base.parser.ts`           | Abstract base parser interface          |
| 8   | `src/ingestion/parsers/boa.parser.ts`            | Bank of America CSV parser              |
| 9   | `src/ingestion/parsers/chase-cc.parser.ts`       | Chase credit card CSV parser            |
| 10  | `src/ingestion/parsers/chase-checking.parser.ts` | Chase checking CSV parser               |
| 11  | `src/ingestion/parsers/amex.parser.ts`           | American Express CSV parser             |
| 12  | `src/ingestion/parsers/citi.parser.ts`           | Citi CSV parser                         |
| 13  | `src/ingestion/parsers/generic-csv.parser.ts`    | Configurable generic CSV parser         |
| 14  | `src/ingestion/parsers/excel.parser.ts`          | Excel → rows → delegate to CSV logic    |
| 15  | `src/ingestion/parsers/parser-registry.ts`       | Parser selection by institution/headers |
| 16  | `src/ingestion/dedup.service.ts`                 | Hash-based + external_id dedup          |
| 17  | `src/ingestion/archiver.service.ts`              | Move imported files to .archived/       |
| 18  | `src/ingestion/watcher.service.ts`               | Chokidar watch-folder auto-import       |
| 19  | `src/transactions/transactions.module.ts`        | Transactions module                     |
| 20  | `src/transactions/transactions.service.ts`       | Transaction CRUD                        |
| 21  | `src/transactions/transactions.controller.ts`    | Transaction REST endpoints              |
| 22  | `src/jobs/ingestion.processor.ts`                | BullMQ job processor for file parsing   |
| 23  | `src/app.module.ts`                              | **MODIFY** — import new modules         |

### Shared Package

| #   | File                                     | Purpose                                                 |
| --- | ---------------------------------------- | ------------------------------------------------------- |
| 24  | `packages/shared/src/types/index.ts`     | **MODIFY** — add `ParsedTransaction`, `CsvFormatConfig` |
| 25  | `packages/shared/src/constants/index.ts` | **MODIFY** — add `UPLOAD_DIR`, `WATCH_FOLDER_DIR`       |

### Tests

| #   | File                                                                     | Purpose                              |
| --- | ------------------------------------------------------------------------ | ------------------------------------ |
| 26  | `apps/api/src/ingestion/parsers/__tests__/boa.parser.spec.ts`            | BofA parser unit tests               |
| 27  | `apps/api/src/ingestion/parsers/__tests__/chase-cc.parser.spec.ts`       | Chase CC parser unit tests           |
| 28  | `apps/api/src/ingestion/parsers/__tests__/chase-checking.parser.spec.ts` | Chase checking parser tests          |
| 29  | `apps/api/src/ingestion/parsers/__tests__/amex.parser.spec.ts`           | Amex parser unit tests               |
| 30  | `apps/api/src/ingestion/parsers/__tests__/citi.parser.spec.ts`           | Citi parser unit tests               |
| 31  | `apps/api/src/ingestion/parsers/__tests__/generic-csv.parser.spec.ts`    | Generic parser tests                 |
| 32  | `apps/api/src/ingestion/__tests__/dedup.service.spec.ts`                 | Dedup engine tests                   |
| 33  | `apps/api/test/ingestion.e2e-spec.ts`                                    | E2E: upload → parse → dedup → verify |
| 34  | `config/sample-data/boa-checking.csv`                                    | Test fixture                         |
| 35  | `config/sample-data/chase-cc.csv`                                        | Test fixture                         |
| 36  | `config/sample-data/chase-checking.csv`                                  | Test fixture                         |
| 37  | `config/sample-data/amex.csv`                                            | Test fixture                         |
| 38  | `config/sample-data/citi.csv`                                            | Test fixture                         |

---

## New Dependencies

```bash
# apps/api
cd apps/api && pnpm add csv-parse xlsx multer chokidar date-fns @nestjs/bullmq bullmq && pnpm add -D @types/multer
```

| Package          | Purpose                             |
| ---------------- | ----------------------------------- |
| `csv-parse`      | Streaming CSV parser                |
| `xlsx`           | Excel file reading (SheetJS)        |
| `multer`         | Multipart file upload handling      |
| `chokidar`       | File system watcher for auto-import |
| `date-fns`       | Date parsing in generic CSV parser  |
| `@nestjs/bullmq` | NestJS BullMQ integration          |
| `bullmq`         | Job queue for async file processing |

---

## 1. Shared Types — New Types

**File: `packages/shared/src/types/index.ts`** — ADD:

```typescript
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
```

## 2. Shared Constants — ADD:

```typescript
// In packages/shared/src/constants/index.ts
export const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/moneypulse/uploads';
export const WATCH_FOLDER_DIR =
  process.env.WATCH_FOLDER_DIR || '/config/watch-folder';
export const INGESTION_QUEUE = 'ingestion';
export const AI_BATCH_SIZE = parseInt(process.env.AI_BATCH_SIZE || '20', 10);
```

---

## 3. DB Schema — Modify accounts table

**No migration needed** — `csvFormatConfig` is added as a new nullable jsonb column.

Add to `apps/api/src/db/schema.ts` in the `accounts` table:

```typescript
// Add this column to the accounts table definition:
csvFormatConfig: jsonb('csv_format_config'),  // nullable — only set for 'other' institution
```

**Migration** (add via `drizzle-kit generate`):

```sql
ALTER TABLE accounts ADD COLUMN csv_format_config jsonb;
```

---

## 4. Account Service

### `src/accounts/accounts.service.ts`

```typescript
import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from '@moneypulse/shared';

@Injectable()
export class AccountsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async create(userId: string, input: CreateAccountInput) {
    const rows = await this.db
      .insert(schema.accounts)
      .values({
        userId,
        institution: input.institution,
        accountType: input.accountType,
        nickname: input.nickname,
        lastFour: input.lastFour,
        startingBalanceCents: input.startingBalanceCents,
        creditLimitCents: input.creditLimitCents ?? null,
      })
      .returning();
    return rows[0];
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByUser(userId: string) {
    return this.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
        ),
      )
      .orderBy(schema.accounts.createdAt);
  }

  async findByHousehold(householdId: string) {
    // Join users to get accounts for all household members
    return this.db
      .select({
        account: schema.accounts,
        ownerName: schema.users.displayName,
      })
      .from(schema.accounts)
      .innerJoin(schema.users, eq(schema.accounts.userId, schema.users.id))
      .where(
        and(
          eq(schema.users.householdId, householdId),
          isNull(schema.accounts.deletedAt),
        ),
      )
      .orderBy(schema.accounts.createdAt);
  }

  async update(id: string, userId: string, input: UpdateAccountInput) {
    const account = await this.findById(id);
    if (!account) throw new NotFoundException('Account not found');
    if (account.userId !== userId)
      throw new NotFoundException('Account not found');

    const rows = await this.db
      .update(schema.accounts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.accounts.id, id))
      .returning();
    return rows[0];
  }

  async softDelete(id: string, userId: string): Promise<void> {
    const account = await this.findById(id);
    if (!account) throw new NotFoundException('Account not found');
    if (account.userId !== userId)
      throw new NotFoundException('Account not found');

    await this.db
      .update(schema.accounts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.accounts.id, id));
  }

  async updateCsvFormatConfig(id: string, config: any): Promise<void> {
    await this.db
      .update(schema.accounts)
      .set({ csvFormatConfig: config, updatedAt: new Date() })
      .where(eq(schema.accounts.id, id));
  }

  /**
   * Generate a slug for watch-folder from account nickname + lastFour.
   * "BofA Checking" + "1234" → "bofa-checking-1234"
   */
  generateSlug(nickname: string, lastFour: string): string {
    return (
      nickname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      lastFour
    );
  }
}
```

### `src/accounts/accounts.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createAccountSchema, updateAccountSchema } from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateAccountInput,
  UpdateAccountInput,
} from '@moneypulse/shared';

@ApiTags('Accounts')
@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a bank account' })
  async create(
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.create(user.sub, body);
    return { data: account };
  }

  @Get()
  @ApiOperation({ summary: 'List user accounts (+ household if member)' })
  async list(@CurrentUser() user: AuthTokenPayload) {
    const accounts = await this.accountsService.findByUser(user.sub);
    return { data: accounts };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.findById(id);
    if (!account || account.userId !== user.sub) {
      return { data: null };
    }
    return { data: account };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update account' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccountInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.update(id, user.sub, body);
    return { data: account };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete account' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    await this.accountsService.softDelete(id, user.sub);
    return { data: { deleted: true } };
  }

  @Patch(':id/csv-format')
  @ApiOperation({ summary: 'Set custom CSV format config for generic account' })
  async setCsvFormat(
    @Param('id') id: string,
    @Body() body: any, // CsvFormatConfig — validated manually
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const account = await this.accountsService.findById(id);
    if (!account || account.userId !== user.sub) {
      return { data: null };
    }
    await this.accountsService.updateCsvFormatConfig(id, body);
    return { data: { updated: true } };
  }
}
```

### `src/accounts/accounts.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
```

---

## 5. Parser Base Interface

### `src/ingestion/parsers/base.parser.ts`

```typescript
import type {
  ParsedTransaction,
  FileUploadError,
  Institution,
} from '@moneypulse/shared';

export interface ParseResult {
  transactions: ParsedTransaction[];
  errors: FileUploadError[];
}

export interface BankParser {
  /** Institution this parser handles */
  institution: Institution;

  /**
   * Check if this parser can handle the given CSV headers.
   * Returns true if headers match the expected pattern.
   */
  canParse(headers: string[]): boolean;

  /**
   * Parse CSV rows into transactions.
   * @param rows - Array of row objects (header → value).
   * @param rowOffset - Starting row number for error reporting (accounts for header rows).
   */
  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult;
}

/**
 * Utility: Parse a date string in MM/DD/YYYY format to YYYY-MM-DD.
 */
export function parseDateMMDDYYYY(dateStr: string): string | null {
  const match = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const m = month.padStart(2, '0');
  const d = day.padStart(2, '0');
  // Validate date
  const parsed = new Date(`${year}-${m}-${d}`);
  if (isNaN(parsed.getTime())) return null;
  return `${year}-${m}-${d}`;
}

/**
 * Utility: Parse a dollar amount string to cents (integer).
 * Handles: "1,234.56", "-85.23", "$1,234.56", "(85.23)" for negative.
 */
export function parseAmountToCents(amountStr: string): number | null {
  if (!amountStr || !amountStr.trim()) return null;
  let cleaned = amountStr.trim().replace(/[$,]/g, '');

  // Handle parentheses for negative: (85.23) → -85.23
  const parenMatch = cleaned.match(/^\((.+)\)$/);
  if (parenMatch) {
    cleaned = '-' + parenMatch[1];
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return Math.round(num * 100);
}

/**
 * Utility: Normalize a description for hashing/matching.
 * Lowercase, collapse whitespace, strip trailing reference numbers.
 */
export function normalizeDescription(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

---

## 6. Bank of America Parser

### `src/ingestion/parsers/boa.parser.ts`

```typescript
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  BankParser,
  ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Bank of America CSV Parser
 *
 * Format:
 *   Date,Reference Number,Description,Amount,Running Bal.
 *   03/15/2026,1234567890,WHOLE FOODS MARKET,-85.23,4234.56
 *
 * Sign convention: negative = debit, positive = credit
 */
export class BoaParser implements BankParser {
  institution = 'boa' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('amount') &&
      (normalized.includes('reference number') ||
        normalized.includes('running bal.'))
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Date'] || row['date'];
        const date = parseDateMMDDYYYY(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const amountStr = row['Amount'] || row['amount'];
        const amountCents = parseAmountToCents(amountStr);
        if (amountCents === null) {
          errors.push({
            row: rowNum,
            error: `Invalid amount: "${amountStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const description = (
          row['Description'] ||
          row['description'] ||
          ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        const externalId =
          (row['Reference Number'] || row['reference number'] || '').trim() ||
          null;
        const balanceStr = row['Running Bal.'] || row['running bal.'] || '';
        const runningBalanceCents = parseAmountToCents(balanceStr);

        // BofA: negative = debit, positive = credit
        const isCredit = amountCents > 0;

        transactions.push({
          externalId,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: normalizeDescription(description),
          runningBalanceCents,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }
}
```

---

## 7. Chase Credit Card Parser

### `src/ingestion/parsers/chase-cc.parser.ts`

```typescript
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  BankParser,
  ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Chase Credit Card CSV Parser
 *
 * Format:
 *   Transaction Date,Post Date,Description,Category,Type,Amount
 *   03/15/2026,03/16/2026,STARBUCKS STORE 12345,Food & Drink,Sale,-5.75
 *
 * Sign: negative = charge, positive = payment/credit
 */
export class ChaseCcParser implements BankParser {
  institution = 'chase' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('transaction date') &&
      normalized.includes('post date') &&
      normalized.includes('description') &&
      normalized.includes('type') &&
      normalized.includes('amount') &&
      !normalized.includes('debit') // Distinguish from Chase checking
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Transaction Date'] || row['transaction date'];
        const date = parseDateMMDDYYYY(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const amountStr = row['Amount'] || row['amount'];
        const amountCents = parseAmountToCents(amountStr);
        if (amountCents === null) {
          errors.push({
            row: rowNum,
            error: `Invalid amount: "${amountStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const description = (
          row['Description'] ||
          row['description'] ||
          ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        // Chase CC: negative = charge (debit), positive = payment/credit
        const isCredit = amountCents > 0;

        transactions.push({
          externalId: null, // Chase CC has no reference number
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: normalizeDescription(description),
          runningBalanceCents: null,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }
}
```

---

## 8. Chase Checking Parser

### `src/ingestion/parsers/chase-checking.parser.ts`

```typescript
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  BankParser,
  ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Chase Checking CSV Parser
 *
 * Format:
 *   Transaction Date,Posting Date,Description,Category,Debit,Credit,Balance
 *   03/15/2026,03/15/2026,AMAZON.COM,Shopping,45.99,,3200.00
 *
 * Sign: Separate unsigned Debit/Credit columns (one populated per row)
 */
export class ChaseCheckingParser implements BankParser {
  institution = 'chase' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('transaction date') &&
      (normalized.includes('posting date') ||
        normalized.includes('post date')) &&
      normalized.includes('debit') &&
      normalized.includes('credit') &&
      normalized.includes('balance')
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Transaction Date'] || row['transaction date'];
        const date = parseDateMMDDYYYY(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const debitStr = (row['Debit'] || row['debit'] || '').trim();
        const creditStr = (row['Credit'] || row['credit'] || '').trim();

        let amountCents: number;
        let isCredit: boolean;

        if (debitStr && !creditStr) {
          amountCents = parseAmountToCents(debitStr) ?? 0;
          isCredit = false;
        } else if (creditStr && !debitStr) {
          amountCents = parseAmountToCents(creditStr) ?? 0;
          isCredit = true;
        } else if (debitStr && creditStr) {
          // Both populated — unusual, treat larger as primary
          const d = parseAmountToCents(debitStr) ?? 0;
          const c = parseAmountToCents(creditStr) ?? 0;
          if (d >= c) {
            amountCents = d;
            isCredit = false;
          } else {
            amountCents = c;
            isCredit = true;
          }
        } else {
          errors.push({
            row: rowNum,
            error: 'No debit or credit amount',
            raw: JSON.stringify(row),
          });
          continue;
        }

        const description = (
          row['Description'] ||
          row['description'] ||
          ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        const balanceStr = row['Balance'] || row['balance'] || '';
        const runningBalanceCents = parseAmountToCents(balanceStr);

        transactions.push({
          externalId: null,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: normalizeDescription(description),
          runningBalanceCents,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }
}
```

---

## 9. American Express Parser

### `src/ingestion/parsers/amex.parser.ts`

```typescript
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  BankParser,
  ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Amex CSV Parser
 *
 * Format:
 *   Date,Description,Amount
 *   03/15/2026,UBER EATS,34.50
 *
 * Sign: **POSITIVE = charge** (opposite of BofA/Chase!), negative = credit/refund
 * Only 3 columns — detect by column count + absence of other headers.
 */
export class AmexParser implements BankParser {
  institution = 'amex' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.length <= 4 && // Amex has 3 columns (sometimes a trailing empty)
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('amount') &&
      !normalized.includes('reference number') && // Not BofA
      !normalized.includes('post date') && // Not Chase
      !normalized.includes('status') // Not Citi
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Date'] || row['date'];
        const date = parseDateMMDDYYYY(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const amountStr = row['Amount'] || row['amount'];
        const amountCents = parseAmountToCents(amountStr);
        if (amountCents === null) {
          errors.push({
            row: rowNum,
            error: `Invalid amount: "${amountStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const description = (
          row['Description'] ||
          row['description'] ||
          ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        // AMEX: positive = charge (debit!), negative = credit/refund
        // This is OPPOSITE of BofA/Chase
        const isCredit = amountCents < 0;

        transactions.push({
          externalId: null,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: normalizeDescription(description),
          runningBalanceCents: null,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }
}
```

---

## 10. Citi Parser

### `src/ingestion/parsers/citi.parser.ts`

```typescript
import type { ParsedTransaction, FileUploadError } from '@moneypulse/shared';
import {
  BankParser,
  ParseResult,
  parseDateMMDDYYYY,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';

/**
 * Citi CSV Parser
 *
 * Format:
 *   Status,Date,Description,Debit,Credit
 *   Cleared,03/15/2026,TARGET STORE 1234,89.50,
 *
 * Sign: Separate unsigned Debit/Credit columns (like Chase checking)
 * Identified by "Status" column presence.
 */
export class CitiParser implements BankParser {
  institution = 'citi' as const;

  canParse(headers: string[]): boolean {
    const normalized = headers.map((h) => h.trim().toLowerCase());
    return (
      normalized.includes('status') &&
      normalized.includes('date') &&
      normalized.includes('description') &&
      normalized.includes('debit') &&
      normalized.includes('credit')
    );
  }

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        const dateStr = row['Date'] || row['date'];
        const date = parseDateMMDDYYYY(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}"`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        const debitStr = (row['Debit'] || row['debit'] || '').trim();
        const creditStr = (row['Credit'] || row['credit'] || '').trim();

        let amountCents: number;
        let isCredit: boolean;

        if (debitStr) {
          amountCents = parseAmountToCents(debitStr) ?? 0;
          isCredit = false;
        } else if (creditStr) {
          amountCents = parseAmountToCents(creditStr) ?? 0;
          isCredit = true;
        } else {
          errors.push({
            row: rowNum,
            error: 'No debit or credit amount',
            raw: JSON.stringify(row),
          });
          continue;
        }

        const description = (
          row['Description'] ||
          row['description'] ||
          ''
        ).trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        transactions.push({
          externalId: null,
          date,
          description,
          amountCents: Math.abs(amountCents),
          isCredit,
          merchantName: normalizeDescription(description),
          runningBalanceCents: null,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }
}
```

---

## 11. Generic CSV Parser

### `src/ingestion/parsers/generic-csv.parser.ts`

Uses `CsvFormatConfig` from the account to parse arbitrary CSV layouts.

```typescript
import type {
  ParsedTransaction,
  FileUploadError,
  CsvFormatConfig,
} from '@moneypulse/shared';
import {
  ParseResult,
  parseAmountToCents,
  normalizeDescription,
} from './base.parser';
import { parse as parseDate, format as formatDate } from 'date-fns';

/**
 * Generic CSV Parser — configurable per-account.
 * Uses CsvFormatConfig stored on the account to map columns.
 */
export class GenericCsvParser {
  constructor(private config: CsvFormatConfig) {}

  parseRows(rows: Record<string, string>[], rowOffset: number): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const errors: FileUploadError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + rowOffset;

      try {
        // Parse date
        const dateStr = (row[this.config.dateColumn] || '').trim();
        const date = this.parseConfigDate(dateStr);
        if (!date) {
          errors.push({
            row: rowNum,
            error: `Invalid date: "${dateStr}" (expected ${this.config.dateFormat})`,
            raw: JSON.stringify(row),
          });
          continue;
        }

        // Parse amount based on sign convention
        let amountCents: number;
        let isCredit: boolean;

        if (this.config.signConvention === 'split_columns') {
          const debitStr = (row[this.config.debitColumn!] || '').trim();
          const creditStr = (row[this.config.creditColumn!] || '').trim();

          if (debitStr) {
            amountCents = parseAmountToCents(debitStr) ?? 0;
            isCredit = false;
          } else if (creditStr) {
            amountCents = parseAmountToCents(creditStr) ?? 0;
            isCredit = true;
          } else {
            errors.push({
              row: rowNum,
              error: 'No debit or credit',
              raw: JSON.stringify(row),
            });
            continue;
          }
        } else {
          const amountStr = (row[this.config.amountColumn!] || '').trim();
          const rawCents = parseAmountToCents(amountStr);
          if (rawCents === null) {
            errors.push({
              row: rowNum,
              error: `Invalid amount: "${amountStr}"`,
              raw: JSON.stringify(row),
            });
            continue;
          }

          if (this.config.signConvention === 'negative_debit') {
            // Negative = debit, positive = credit (BofA, Chase CC)
            isCredit = rawCents > 0;
          } else {
            // positive_debit: positive = debit (Amex)
            isCredit = rawCents < 0;
          }
          amountCents = Math.abs(rawCents);
        }

        // Description
        const description = (row[this.config.descriptionColumn] || '').trim();
        if (!description) {
          errors.push({
            row: rowNum,
            error: 'Empty description',
            raw: JSON.stringify(row),
          });
          continue;
        }

        // Optional fields
        const externalId = this.config.externalIdColumn
          ? (row[this.config.externalIdColumn] || '').trim() || null
          : null;
        const merchantName = this.config.merchantColumn
          ? (row[this.config.merchantColumn] || '').trim() || null
          : normalizeDescription(description);
        const runningBalanceCents = this.config.balanceColumn
          ? parseAmountToCents(row[this.config.balanceColumn] || '')
          : null;

        transactions.push({
          externalId,
          date,
          description,
          amountCents,
          isCredit,
          merchantName,
          runningBalanceCents,
        });
      } catch (err: any) {
        errors.push({
          row: rowNum,
          error: err.message,
          raw: JSON.stringify(row),
        });
      }
    }

    return { transactions, errors };
  }

  /**
   * Parse date using the configured format.
   * Supports: MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, M/D/YYYY
   */
  private parseConfigDate(dateStr: string): string | null {
    if (!dateStr) return null;

    try {
      const formatMap: Record<string, string> = {
        'MM/DD/YYYY': 'MM/dd/yyyy',
        'M/D/YYYY': 'M/d/yyyy',
        'DD/MM/YYYY': 'dd/MM/yyyy',
        'YYYY-MM-DD': 'yyyy-MM-dd',
        'MM-DD-YYYY': 'MM-dd-yyyy',
      };

      const dateFnsFormat = formatMap[this.config.dateFormat];
      if (!dateFnsFormat) return null;

      const parsed = parseDate(dateStr.trim(), dateFnsFormat, new Date());
      if (isNaN(parsed.getTime())) return null;

      return formatDate(parsed, 'yyyy-MM-dd');
    } catch {
      return null;
    }
  }
}
```

---

## 12. Excel Parser

### `src/ingestion/parsers/excel.parser.ts`

```typescript
import * as XLSX from 'xlsx';

/**
 * Excel Parser — reads .xlsx/.xls file buffer and converts
 * the first sheet to an array of row objects (header-keyed).
 * Then delegates to the appropriate CSV parser.
 */
export function parseExcelToRows(buffer: Buffer): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    raw: false, // return strings, not parsed numbers
    defval: '', // empty cells → empty string
  });

  if (jsonRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = Object.keys(jsonRows[0]);
  const rows = jsonRows.map((row) => {
    const stringRow: Record<string, string> = {};
    for (const key of headers) {
      stringRow[key] = String(row[key] ?? '');
    }
    return stringRow;
  });

  return { headers, rows };
}
```

---

## 13. Parser Registry

### `src/ingestion/parsers/parser-registry.ts`

```typescript
import type { Institution, CsvFormatConfig } from '@moneypulse/shared';
import { BankParser } from './base.parser';
import { BoaParser } from './boa.parser';
import { ChaseCcParser } from './chase-cc.parser';
import { ChaseCheckingParser } from './chase-checking.parser';
import { AmexParser } from './amex.parser';
import { CitiParser } from './citi.parser';
import { GenericCsvParser } from './generic-csv.parser';

const BANK_PARSERS: BankParser[] = [
  new BoaParser(),
  new ChaseCcParser(),
  new ChaseCheckingParser(),
  new AmexParser(),
  new CitiParser(),
];

/**
 * Select the best parser for the given CSV headers and account institution.
 *
 * Priority:
 * 1. If institution is known (not 'other'), try that bank's parser first.
 * 2. Auto-detect by scanning all parsers' canParse().
 * 3. Fall back to GenericCsvParser if account has csvFormatConfig.
 * 4. Throw if no parser matches.
 */
export function selectParser(
  headers: string[],
  institution: Institution,
  csvFormatConfig?: CsvFormatConfig | null,
): BankParser | GenericCsvParser {
  // Try institution-specific parser first
  if (institution !== 'other') {
    const match = BANK_PARSERS.find(
      (p) => p.institution === institution && p.canParse(headers),
    );
    if (match) return match;
  }

  // Auto-detect from headers
  const detected = BANK_PARSERS.find((p) => p.canParse(headers));
  if (detected) return detected;

  // Fall back to generic parser
  if (csvFormatConfig) {
    return new GenericCsvParser(csvFormatConfig);
  }

  throw new Error(
    `No parser found for headers: [${headers.join(', ')}]. ` +
      'Set a custom CSV format config on this account for generic parsing.',
  );
}
```

---

## 14. Dedup Service

### `src/ingestion/dedup.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { ParsedTransaction } from '@moneypulse/shared';

export interface DedupResult {
  newTransactions: ParsedTransaction[];
  skippedCount: number;
}

@Injectable()
export class DedupService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Filter out duplicate transactions.
   *
   * Dedup strategies (in priority order):
   * 1. external_id match: if bank provides a reference number, check (account_id, external_id)
   * 2. Hash match: SHA256(date + amountCents + normalized_description + account_id)
   */
  async dedup(
    accountId: string,
    transactions: ParsedTransaction[],
  ): Promise<DedupResult> {
    if (transactions.length === 0) {
      return { newTransactions: [], skippedCount: 0 };
    }

    // Build hashes for all incoming transactions
    const incoming = transactions.map((txn) => ({
      ...txn,
      hash: this.computeHash(accountId, txn),
    }));

    // Batch lookup: get existing hashes and external_ids for this account
    const existingHashes = await this.getExistingHashes(accountId);
    const existingExternalIds = await this.getExistingExternalIds(accountId);

    const newTransactions: ParsedTransaction[] = [];
    let skippedCount = 0;

    for (const item of incoming) {
      // Check external_id first (more reliable)
      if (item.externalId && existingExternalIds.has(item.externalId)) {
        skippedCount++;
        continue;
      }

      // Check hash
      if (existingHashes.has(item.hash)) {
        skippedCount++;
        continue;
      }

      // New transaction — add hash to set to catch intra-batch dupes
      existingHashes.add(item.hash);
      if (item.externalId) existingExternalIds.add(item.externalId);

      newTransactions.push(item);
    }

    return { newTransactions, skippedCount };
  }

  /**
   * Compute SHA256 hash for dedup: date + amount + normalized_description + account_id
   */
  computeHash(accountId: string, txn: ParsedTransaction): string {
    const input = [
      accountId,
      txn.date,
      txn.amountCents.toString(),
      txn.description.trim().toLowerCase().replace(/\s+/g, ' '),
      txn.isCredit ? 'credit' : 'debit',
    ].join('|');

    return createHash('sha256').update(input).digest('hex');
  }

  private async getExistingHashes(accountId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ txnHash: schema.transactions.txnHash })
      .from(schema.transactions)
      .where(eq(schema.transactions.accountId, accountId));
    return new Set(rows.map((r: any) => r.txnHash));
  }

  private async getExistingExternalIds(
    accountId: string,
  ): Promise<Set<string>> {
    const rows = await this.db
      .select({ externalId: schema.transactions.externalId })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.accountId, accountId),
          // Only non-null external IDs
        ),
      );
    return new Set(
      rows
        .map((r: any) => r.externalId)
        .filter((id: string | null): id is string => id !== null),
    );
  }
}
```

---

## 15. Archiver Service

### `src/ingestion/archiver.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rename } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { WATCH_FOLDER_DIR } from '@moneypulse/shared';

@Injectable()
export class ArchiverService {
  private readonly logger = new Logger(ArchiverService.name);

  /**
   * Move a successfully imported file to the .archived/ subfolder.
   * Path: {watch-folder}/{account-slug}/.archived/{filename}_{timestamp}
   */
  async archiveFile(filePath: string): Promise<string> {
    const dir = dirname(filePath);
    const file = basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivedDir = join(dir, '.archived');

    await mkdir(archivedDir, { recursive: true });

    const archivedFilename = `${file}_${timestamp}`;
    const archivedPath = join(archivedDir, archivedFilename);

    await rename(filePath, archivedPath);
    this.logger.log(`Archived: ${filePath} → ${archivedPath}`);

    return archivedPath;
  }
}
```

---

## 16. Ingestion Service (Upload Orchestrator)

### `src/ingestion/ingestion.service.ts`

```typescript
import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  INGESTION_QUEUE,
  UPLOAD_DIR,
  MAX_UPLOAD_SIZE_BYTES,
} from '@moneypulse/shared';
import type { FileType } from '@moneypulse/shared';

@Injectable()
export class IngestionService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
  ) {}

  /**
   * Handle file upload:
   * 1. Compute SHA256 hash → reject duplicate file
   * 2. Save to UPLOAD_DIR
   * 3. Create file_uploads record (status: pending)
   * 4. Enqueue BullMQ job
   */
  async uploadFile(
    userId: string,
    accountId: string,
    file: Express.Multer.File,
  ) {
    // Determine file type
    const fileType = this.detectFileType(file.originalname);

    // Compute SHA256
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // Check for duplicate file
    const existing = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.fileHash, fileHash))
      .limit(1);

    if (existing.length > 0) {
      throw new BadRequestException(
        `This file has already been uploaded (matched by SHA256 hash). Upload ID: ${existing[0].id}`,
      );
    }

    // Save file to disk
    const uploadDir = join(UPLOAD_DIR, userId);
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, `${fileHash}_${file.originalname}`);
    await writeFile(filePath, file.buffer);

    // Create DB record
    const rows = await this.db
      .insert(schema.fileUploads)
      .values({
        userId,
        accountId,
        filename: file.originalname,
        fileType,
        fileHash,
        status: 'pending',
      })
      .returning();

    const upload = rows[0];

    // Enqueue processing job
    await this.ingestionQueue.add(
      'parse-file',
      {
        uploadId: upload.id,
        userId,
        accountId,
        filePath,
        fileType,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return upload;
  }

  /**
   * Get upload status (polling endpoint).
   */
  async getUploadStatus(uploadId: string) {
    const rows = await this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.id, uploadId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('Upload not found');
    return rows[0];
  }

  /**
   * List uploads for a user.
   */
  async listUploads(userId: string) {
    return this.db
      .select()
      .from(schema.fileUploads)
      .where(eq(schema.fileUploads.userId, userId))
      .orderBy(schema.fileUploads.createdAt);
  }

  /**
   * Update upload status (called by job processor).
   */
  async updateUploadStatus(
    uploadId: string,
    data: {
      status?: string;
      rowsImported?: number;
      rowsSkipped?: number;
      rowsErrored?: number;
      errorLog?: any[];
      archivedPath?: string;
    },
  ) {
    await this.db
      .update(schema.fileUploads)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.fileUploads.id, uploadId));
  }

  private detectFileType(filename: string): FileType {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'csv') return 'csv';
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    if (ext === 'pdf') return 'pdf';
    throw new BadRequestException(
      `Unsupported file type: .${ext}. Allowed: .csv, .xlsx, .xls, .pdf`,
    );
  }
}
```

---

## 17. Ingestion Controller

### `src/ingestion/ingestion.controller.ts`

```typescript
import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { IngestionService } from './ingestion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MAX_UPLOAD_SIZE_BYTES } from '@moneypulse/shared';
import type { AuthTokenPayload } from '@moneypulse/shared';

@ApiTags('Uploads')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Upload a bank statement file (CSV/Excel/PDF)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        const allowed = /\.(csv|xlsx|xls|pdf)$/i;
        if (!allowed.test(file.originalname)) {
          return cb(new BadRequestException('File type not allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('accountId') accountId: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!accountId) throw new BadRequestException('accountId is required');

    const upload = await this.ingestionService.uploadFile(
      user.sub,
      accountId,
      file,
    );
    return { data: upload };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get upload status (polling)' })
  async getStatus(@Param('id') id: string) {
    const upload = await this.ingestionService.getUploadStatus(id);
    return { data: upload };
  }

  @Get()
  @ApiOperation({ summary: 'List all uploads for current user' })
  async list(@CurrentUser() user: AuthTokenPayload) {
    const uploads = await this.ingestionService.listUploads(user.sub);
    return { data: uploads };
  }
}
```

---

## 18. BullMQ Job Processor

### `src/jobs/ingestion.processor.ts`

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { selectParser } from '../ingestion/parsers/parser-registry';
import { parseExcelToRows } from '../ingestion/parsers/excel.parser';
import { DedupService } from '../ingestion/dedup.service';
import { ArchiverService } from '../ingestion/archiver.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { AuditService } from '../audit/audit.service';
import type { ParsedTransaction } from '@moneypulse/shared';

interface IngestionJobData {
  uploadId: string;
  userId: string;
  accountId: string;
  filePath: string;
  fileType: 'csv' | 'excel' | 'pdf';
}

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly dedupService: DedupService,
    private readonly archiverService: ArchiverService,
    private readonly ingestionService: IngestionService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    const { uploadId, userId, accountId, filePath, fileType } = job.data;
    this.logger.log(`Processing upload ${uploadId}: ${filePath}`);

    try {
      // Mark as processing
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'processing',
      });

      // Get account info for parser selection
      const account = await this.getAccount(accountId);
      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      // Read file
      const buffer = await readFile(filePath);

      // Parse file → rows
      let headers: string[];
      let rows: Record<string, string>[];

      if (fileType === 'excel') {
        const result = parseExcelToRows(buffer);
        headers = result.headers;
        rows = result.rows;
      } else if (fileType === 'csv') {
        const records = parse(buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: true,
        });
        headers = records.length > 0 ? Object.keys(records[0]) : [];
        rows = records;
      } else if (fileType === 'pdf') {
        // PDF parsing is handled by the Python microservice (Phase 4)
        // For now, mark as failed with a message
        await this.ingestionService.updateUploadStatus(uploadId, {
          status: 'failed',
          errorLog: [
            {
              row: 0,
              error: 'PDF parsing requires the PDF parser service (Phase 4)',
              raw: '',
            },
          ],
        });
        return;
      } else {
        throw new Error(`Unsupported file type: ${fileType}`);
      }

      if (rows.length === 0) {
        await this.ingestionService.updateUploadStatus(uploadId, {
          status: 'completed',
          rowsImported: 0,
          rowsSkipped: 0,
          rowsErrored: 0,
        });
        return;
      }

      // Select parser
      const parser = selectParser(
        headers,
        account.institution,
        account.csvFormatConfig,
      );

      // Parse rows → transactions
      const parseResult = parser.parseRows(rows, 2); // row 2 = first data row (header is row 1)

      // Dedup
      const dedupResult = await this.dedupService.dedup(
        accountId,
        parseResult.transactions,
      );

      // Insert new transactions
      if (dedupResult.newTransactions.length > 0) {
        await this.insertTransactions(
          dedupResult.newTransactions,
          accountId,
          userId,
          uploadId,
        );
      }

      // Archive the file
      let archivedPath: string | null = null;
      try {
        archivedPath = await this.archiverService.archiveFile(filePath);
      } catch (err) {
        this.logger.warn(`Failed to archive file: ${err}`);
      }

      // Update status
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'completed',
        rowsImported: dedupResult.newTransactions.length,
        rowsSkipped: dedupResult.skippedCount,
        rowsErrored: parseResult.errors.length,
        errorLog: parseResult.errors,
        archivedPath,
      });

      // Audit log
      await this.auditService.log({
        userId,
        action: 'file_imported',
        entityType: 'file_upload',
        entityId: uploadId,
        newValue: {
          filename: filePath,
          imported: dedupResult.newTransactions.length,
          skipped: dedupResult.skippedCount,
          errors: parseResult.errors.length,
        },
      });

      this.logger.log(
        `Upload ${uploadId} complete: ${dedupResult.newTransactions.length} imported, ` +
          `${dedupResult.skippedCount} skipped, ${parseResult.errors.length} errors`,
      );
    } catch (err: any) {
      this.logger.error(`Upload ${uploadId} failed: ${err.message}`, err.stack);
      await this.ingestionService.updateUploadStatus(uploadId, {
        status: 'failed',
        errorLog: [{ row: 0, error: err.message, raw: '' }],
      });
      throw err; // Let BullMQ handle retries
    }
  }

  private async getAccount(accountId: string) {
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async insertTransactions(
    transactions: ParsedTransaction[],
    accountId: string,
    userId: string,
    sourceFileId: string,
  ): Promise<void> {
    // Batch insert in chunks of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = transactions.slice(i, i + BATCH_SIZE);
      await this.db.insert(schema.transactions).values(
        batch.map((txn) => ({
          accountId,
          userId,
          externalId: txn.externalId,
          txnHash: this.dedupService.computeHash(accountId, txn),
          date: new Date(txn.date),
          description: txn.description,
          originalDescription: txn.description,
          amountCents: txn.amountCents,
          isCredit: txn.isCredit,
          merchantName: txn.merchantName,
          sourceFileId,
          tags: [],
        })),
      );
    }
  }
}
```

---

## 19. Transaction Service

### `src/transactions/transactions.service.ts`

```typescript
import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import {
  eq,
  and,
  isNull,
  desc,
  asc,
  ilike,
  sql,
  between,
  count,
} from 'drizzle-orm';
import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  TransactionQuery,
  SplitTransactionInput,
  BulkCategorizeInput,
} from '@moneypulse/shared';
import { createHash } from 'crypto';

@Injectable()
export class TransactionsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Manual transaction entry (cash purchases, etc.)
   */
  async create(userId: string, input: CreateTransactionInput) {
    const txnHash = createHash('sha256')
      .update(
        `${input.accountId}|${input.date}|${input.amountCents}|${input.description}|manual`,
      )
      .digest('hex');

    const rows = await this.db
      .insert(schema.transactions)
      .values({
        accountId: input.accountId,
        userId,
        txnHash,
        date: new Date(input.date),
        description: input.description,
        originalDescription: input.description,
        amountCents: input.amountCents,
        categoryId: input.categoryId ?? null,
        merchantName: input.merchantName ?? null,
        isCredit: input.isCredit,
        isManual: true,
        tags: input.tags ?? [],
      })
      .returning();
    return rows[0];
  }

  /**
   * Paginated, filterable transaction list.
   */
  async findAll(
    userId: string,
    query: TransactionQuery,
    householdId?: string | null,
  ) {
    const conditions = [isNull(schema.transactions.deletedAt)];

    // User or household scope
    if (householdId) {
      // Household: get all user IDs in household
      const members = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.householdId, householdId));
      const memberIds = members.map((m: any) => m.id);
      if (memberIds.length > 0) {
        conditions.push(sql`${schema.transactions.userId} = ANY(${memberIds})`);
      }
    } else {
      conditions.push(eq(schema.transactions.userId, userId));
    }

    // Filters
    if (query.accountId)
      conditions.push(eq(schema.transactions.accountId, query.accountId));
    if (query.categoryId)
      conditions.push(eq(schema.transactions.categoryId, query.categoryId));
    if (query.from && query.to) {
      conditions.push(
        between(
          schema.transactions.date,
          new Date(query.from),
          new Date(query.to),
        ),
      );
    }
    if (query.search) {
      conditions.push(
        ilike(schema.transactions.description, `%${query.search}%`),
      );
    }

    // Exclude split parents from list (show children instead)
    conditions.push(eq(schema.transactions.isSplitParent, false));

    const whereCondition = and(...conditions);

    // Count
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.transactions)
      .where(whereCondition);

    // Sort
    const sortColumn =
      {
        date: schema.transactions.date,
        amount: schema.transactions.amountCents,
        description: schema.transactions.description,
      }[query.sortBy] ?? schema.transactions.date;

    const sortFn = query.sortOrder === 'asc' ? asc : desc;

    // Fetch page
    const offset = (query.page - 1) * query.pageSize;
    const data = await this.db
      .select()
      .from(schema.transactions)
      .where(whereCondition)
      .orderBy(sortFn(sortColumn))
      .limit(query.pageSize)
      .offset(offset);

    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: offset + data.length < total,
    };
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, id),
          isNull(schema.transactions.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Update editable fields: description, category, tags.
   * Amount and date are immutable.
   */
  async update(id: string, userId: string, input: UpdateTransactionInput) {
    const txn = await this.findById(id);
    if (!txn || txn.userId !== userId)
      throw new NotFoundException('Transaction not found');

    const rows = await this.db
      .update(schema.transactions)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.transactions.id, id))
      .returning();
    return rows[0];
  }

  /**
   * Soft delete a transaction.
   */
  async softDelete(id: string, userId: string): Promise<void> {
    const txn = await this.findById(id);
    if (!txn || txn.userId !== userId)
      throw new NotFoundException('Transaction not found');

    await this.db
      .update(schema.transactions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.transactions.id, id));
  }

  /**
   * Split a transaction into children.
   * Parent gets isSplitParent=true, children created.
   * Sum of children must equal parent amount.
   */
  async splitTransaction(
    id: string,
    userId: string,
    input: SplitTransactionInput,
  ) {
    const parent = await this.findById(id);
    if (!parent || parent.userId !== userId) throw new NotFoundException();

    // Validate split amounts sum to parent
    const splitTotal = input.splits.reduce((sum, s) => sum + s.amountCents, 0);
    if (splitTotal !== parent.amountCents) {
      throw new BadRequestException(
        `Split amounts (${splitTotal}) must equal parent amount (${parent.amountCents})`,
      );
    }

    // Mark parent as split
    await this.db
      .update(schema.transactions)
      .set({ isSplitParent: true, updatedAt: new Date() })
      .where(eq(schema.transactions.id, id));

    // Create children
    const children = await this.db
      .insert(schema.transactions)
      .values(
        input.splits.map((split, idx) => ({
          accountId: parent.accountId,
          userId,
          txnHash: createHash('sha256')
            .update(`${parent.id}|split|${idx}`)
            .digest('hex'),
          date: parent.date,
          description: split.description || parent.description,
          originalDescription: parent.originalDescription,
          amountCents: split.amountCents,
          categoryId: split.categoryId,
          isCredit: parent.isCredit,
          parentTransactionId: parent.id,
          sourceFileId: parent.sourceFileId,
          tags: [],
        })),
      )
      .returning();

    return { parent: { ...parent, isSplitParent: true }, children };
  }

  /**
   * Bulk categorize multiple transactions.
   */
  async bulkCategorize(userId: string, input: BulkCategorizeInput) {
    const updated = await this.db
      .update(schema.transactions)
      .set({ categoryId: input.categoryId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.transactions.userId, userId),
          sql`${schema.transactions.id} = ANY(${input.transactionIds})`,
          isNull(schema.transactions.deletedAt),
        ),
      )
      .returning({ id: schema.transactions.id });

    return { updatedCount: updated.length };
  }
}
```

### `src/transactions/transactions.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createTransactionSchema,
  updateTransactionSchema,
  splitTransactionSchema,
  bulkCategorizeSchema,
  transactionQuerySchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateTransactionInput,
  UpdateTransactionInput,
  SplitTransactionInput,
  BulkCategorizeInput,
  TransactionQuery,
} from '@moneypulse/shared';

@ApiTags('Transactions')
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(
    private readonly txnService: TransactionsService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create manual transaction' })
  async create(
    @Body(new ZodValidationPipe(createTransactionSchema))
    body: CreateTransactionInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const txn = await this.txnService.create(user.sub, body);
    return { data: txn };
  }

  @Get()
  @ApiOperation({ summary: 'List transactions (paginated, filterable)' })
  async list(
    @Query(new ZodValidationPipe(transactionQuerySchema))
    query: TransactionQuery,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    return this.txnService.findAll(user.sub, query, user.householdId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const txn = await this.txnService.findById(id);
    return { data: txn };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update transaction (description, category, tags)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTransactionSchema))
    body: UpdateTransactionInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const txn = await this.txnService.update(id, user.sub, body);

    await this.auditService.log({
      userId: user.sub,
      action: 'transaction_edited',
      entityType: 'transaction',
      entityId: id,
      newValue: body as any,
    });

    return { data: txn };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete transaction' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    await this.txnService.softDelete(id, user.sub);
    return { data: { deleted: true } };
  }

  @Post(':id/split')
  @HttpCode(201)
  @ApiOperation({ summary: 'Split transaction into children' })
  async split(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(splitTransactionSchema))
    body: SplitTransactionInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const result = await this.txnService.splitTransaction(id, user.sub, body);

    await this.auditService.log({
      userId: user.sub,
      action: 'transaction_split',
      entityType: 'transaction',
      entityId: id,
      newValue: { childCount: result.children.length },
    });

    return { data: result };
  }

  @Post('bulk-categorize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk categorize transactions' })
  async bulkCategorize(
    @Body(new ZodValidationPipe(bulkCategorizeSchema))
    body: BulkCategorizeInput,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    const result = await this.txnService.bulkCategorize(user.sub, body);

    await this.auditService.log({
      userId: user.sub,
      action: 'bulk_categorized',
      entityType: 'transaction',
      newValue: { count: result.updatedCount, categoryId: body.categoryId },
    });

    return { data: result };
  }
}
```

### `src/transactions/transactions.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

@Module({
  providers: [TransactionsService],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}
```

---

## 20. Watch Folder Service

### `src/ingestion/watcher.service.ts`

```typescript
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as chokidar from 'chokidar';
import { readFile, stat } from 'fs/promises';
import { basename, dirname, relative } from 'path';
import { createHash } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { INGESTION_QUEUE, WATCH_FOLDER_DIR } from '@moneypulse/shared';

@Injectable()
export class WatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatcherService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private readonly watchDir: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
  ) {
    this.watchDir =
      this.config.get<string>('WATCH_FOLDER_DIR') || WATCH_FOLDER_DIR;
  }

  async onModuleInit() {
    try {
      this.watcher = chokidar.watch(this.watchDir, {
        persistent: true,
        ignoreInitial: true,
        depth: 1, // {slug}/file.csv — one level deep
        ignored: /(^|[\/\\])\.archived/, // Ignore .archived folders
        awaitWriteFinish: {
          stabilityThreshold: 2000, // Wait 2s after last write
          pollInterval: 500,
        },
      });

      this.watcher.on('add', (filePath) => this.handleNewFile(filePath));
      this.logger.log(`Watch folder active: ${this.watchDir}`);
    } catch (err) {
      this.logger.warn(
        `Watch folder not available: ${err}. Auto-import disabled.`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  private async handleNewFile(filePath: string) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls', 'pdf'].includes(ext || '')) {
      this.logger.debug(`Ignoring non-data file: ${filePath}`);
      return;
    }

    this.logger.log(`New file detected: ${filePath}`);

    try {
      // Extract account slug from path: /watch-folder/{slug}/file.csv
      const relativePath = relative(this.watchDir, filePath);
      const parts = relativePath.split('/');
      if (parts.length < 2) {
        this.logger.warn(`File not in account subfolder: ${filePath}`);
        return;
      }

      const slug = parts[0];

      // Find account by slug match (nickname-lastfour pattern)
      const account = await this.findAccountBySlug(slug);
      if (!account) {
        this.logger.warn(`No account found for slug "${slug}". Skipping.`);
        return;
      }

      // Read file and compute hash
      const buffer = await readFile(filePath);
      const fileHash = createHash('sha256').update(buffer).digest('hex');

      // Check duplicate
      const existing = await this.db
        .select()
        .from(schema.fileUploads)
        .where(eq(schema.fileUploads.fileHash, fileHash))
        .limit(1);

      if (existing.length > 0) {
        this.logger.log(`Duplicate file skipped: ${filePath}`);
        return;
      }

      // Detect file type
      const fileType =
        ext === 'csv'
          ? 'csv'
          : ext === 'xlsx' || ext === 'xls'
            ? 'excel'
            : 'pdf';

      // Create upload record
      const [upload] = await this.db
        .insert(schema.fileUploads)
        .values({
          userId: account.userId,
          accountId: account.id,
          filename: basename(filePath),
          fileType,
          fileHash,
          status: 'pending',
        })
        .returning();

      // Enqueue job
      await this.ingestionQueue.add('parse-file', {
        uploadId: upload.id,
        userId: account.userId,
        accountId: account.id,
        filePath,
        fileType,
      });

      this.logger.log(
        `Auto-import queued: ${filePath} → account ${account.nickname}`,
      );
    } catch (err: any) {
      this.logger.error(`Watch folder error for ${filePath}: ${err.message}`);
    }
  }

  /**
   * Find account by matching slug pattern against nickname + lastFour.
   */
  private async findAccountBySlug(slug: string) {
    const accounts = await this.db
      .select()
      .from(schema.accounts)
      .where(isNull(schema.accounts.deletedAt));

    for (const account of accounts) {
      const accountSlug = this.generateSlug(account.nickname, account.lastFour);
      if (accountSlug === slug) return account;
    }

    return null;
  }

  private generateSlug(nickname: string, lastFour: string): string {
    return (
      nickname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      lastFour
    );
  }
}
```

---

## 21. Ingestion Module

### `src/ingestion/ingestion.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { INGESTION_QUEUE } from '@moneypulse/shared';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { DedupService } from './dedup.service';
import { ArchiverService } from './archiver.service';
import { WatcherService } from './watcher.service';
import { IngestionProcessor } from '../jobs/ingestion.processor';

@Module({
  imports: [BullModule.registerQueue({ name: INGESTION_QUEUE })],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    DedupService,
    ArchiverService,
    WatcherService,
    IngestionProcessor,
  ],
  exports: [IngestionService, DedupService],
})
export class IngestionModule {}
```

---

## 22. App Module Update

### `src/app.module.ts` — MODIFY

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    DbModule,
    RedisModule,
    AuditModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    TransactionsModule,
    IngestionModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

---

## 23. Sample Data Fixtures

### `config/sample-data/boa-checking.csv`

```csv
Date,Reference Number,Description,Amount,Running Bal.
03/15/2026,1234567890,WHOLE FOODS MARKET #10234,-85.23,4234.56
03/14/2026,1234567891,PAYROLL DIRECT DEP ACME INC,3200.00,4319.79
03/13/2026,1234567892,SHELL OIL 57442,-45.00,1119.79
03/12/2026,1234567893,AMAZON.COM*M44KL2,-29.99,1164.79
03/10/2026,1234567894,TRANSFER TO SAVINGS,-500.00,1194.78
```

### `config/sample-data/chase-cc.csv`

```csv
Transaction Date,Post Date,Description,Category,Type,Amount
03/15/2026,03/16/2026,STARBUCKS STORE 12345,Food & Drink,Sale,-5.75
03/14/2026,03/15/2026,NETFLIX.COM,Entertainment,Sale,-15.99
03/12/2026,03/13/2026,PAYMENT THANK YOU,,Payment,1500.00
03/10/2026,03/11/2026,UBER EATS,Food & Drink,Sale,-34.50
03/08/2026,03/09/2026,TARGET 00012345,Shopping,Sale,-67.89
```

### `config/sample-data/chase-checking.csv`

```csv
Transaction Date,Posting Date,Description,Category,Debit,Credit,Balance
03/15/2026,03/15/2026,AMAZON.COM,Shopping,45.99,,3200.00
03/14/2026,03/14/2026,PAYROLL,,  ,3200.00,3245.99
03/12/2026,03/12/2026,CHIPOTLE ONLINE,Food & Drink,12.50,,45.99
03/10/2026,03/10/2026,VENMO PAYMENT,,25.00,,58.49
```

### `config/sample-data/amex.csv`

```csv
Date,Description,Amount
03/15/2026,UBER EATS,34.50
03/14/2026,WHOLE FOODS MARKET,92.15
03/12/2026,AMEX PAYMENT RECEIVED,-500.00
03/10/2026,DELTA AIR LINES,285.00
03/08/2026,SPOTIFY USA,-9.99
```

### `config/sample-data/citi.csv`

```csv
Status,Date,Description,Debit,Credit
Cleared,03/15/2026,TARGET STORE 1234,89.50,
Cleared,03/14/2026,KROGER #12345,65.40,
Cleared,03/12/2026,PAYMENT RECEIVED,,500.00
Cleared,03/10/2026,AMAZON PRIME,14.99,
Pending,03/09/2026,COSTCO WHOLESALE,234.56,
```

---

## 24. Unit Tests

### `apps/api/src/ingestion/parsers/__tests__/boa.parser.spec.ts`

```typescript
import { BoaParser } from '../boa.parser';

describe('BoaParser', () => {
  const parser = new BoaParser();

  it('should identify BofA headers', () => {
    expect(
      parser.canParse([
        'Date',
        'Reference Number',
        'Description',
        'Amount',
        'Running Bal.',
      ]),
    ).toBe(true);
    expect(parser.canParse(['Date', 'Description', 'Amount'])).toBe(false); // Missing Reference Number → could be Amex
  });

  it('should parse debit transaction (negative amount)', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/15/2026',
          'Reference Number': '123',
          Description: 'WHOLE FOODS',
          Amount: '-85.23',
          'Running Bal.': '4234.56',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amountCents).toBe(8523);
    expect(result.transactions[0].isCredit).toBe(false);
    expect(result.transactions[0].externalId).toBe('123');
    expect(result.transactions[0].date).toBe('2026-03-15');
  });

  it('should parse credit transaction (positive amount)', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/14/2026',
          'Reference Number': '456',
          Description: 'PAYROLL',
          Amount: '3200.00',
          'Running Bal.': '4319.79',
        },
      ],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(320000);
  });

  it('should handle invalid date', () => {
    const result = parser.parseRows(
      [
        {
          Date: 'invalid',
          'Reference Number': '789',
          Description: 'TEST',
          Amount: '100.00',
          'Running Bal.': '0',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it('should handle empty description', () => {
    const result = parser.parseRows(
      [
        {
          Date: '03/15/2026',
          'Reference Number': '111',
          Description: '',
          Amount: '50.00',
          'Running Bal.': '0',
        },
      ],
      2,
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
```

### `apps/api/src/ingestion/parsers/__tests__/amex.parser.spec.ts`

```typescript
import { AmexParser } from '../amex.parser';

describe('AmexParser', () => {
  const parser = new AmexParser();

  it('should identify Amex headers (3 columns)', () => {
    expect(parser.canParse(['Date', 'Description', 'Amount'])).toBe(true);
  });

  it('should NOT match BofA headers', () => {
    expect(
      parser.canParse([
        'Date',
        'Reference Number',
        'Description',
        'Amount',
        'Running Bal.',
      ]),
    ).toBe(false);
  });

  it('should treat positive as debit (OPPOSITE of BofA)', () => {
    const result = parser.parseRows(
      [{ Date: '03/15/2026', Description: 'UBER EATS', Amount: '34.50' }],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(false); // positive = charge for Amex
    expect(result.transactions[0].amountCents).toBe(3450);
  });

  it('should treat negative as credit', () => {
    const result = parser.parseRows(
      [{ Date: '03/12/2026', Description: 'AMEX PAYMENT', Amount: '-500.00' }],
      2,
    );
    expect(result.transactions[0].isCredit).toBe(true);
    expect(result.transactions[0].amountCents).toBe(50000);
  });
});
```

### `apps/api/src/ingestion/__tests__/dedup.service.spec.ts`

```typescript
import { DedupService } from '../dedup.service';

describe('DedupService', () => {
  let service: DedupService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    service = new DedupService(mockDb);
    // Inject db via reflection since constructor uses @Inject
    (service as any).db = mockDb;
  });

  it('should compute deterministic hash', () => {
    const hash1 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'WHOLE FOODS',
      amountCents: 8523,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    const hash2 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'WHOLE FOODS',
      amountCents: 8523,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different amounts', () => {
    const hash1 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 100,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    const hash2 = service.computeHash('acc-1', {
      externalId: null,
      date: '2026-03-15',
      description: 'TEST',
      amountCents: 200,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    });
    expect(hash1).not.toBe(hash2);
  });

  it('should detect intra-batch duplicates', async () => {
    mockDb.where.mockResolvedValue([]); // no existing transactions

    const txn = {
      externalId: null,
      date: '2026-03-15',
      description: 'DUPLICATE',
      amountCents: 1000,
      isCredit: false,
      merchantName: null,
      runningBalanceCents: null,
    };

    const result = await service.dedup('acc-1', [txn, { ...txn }]);
    expect(result.newTransactions).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
  });
});
```

---

## 25. E2E Test

### `apps/api/test/ingestion.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';

describe('Ingestion (e2e)', () => {
  let app: INestApplication;
  let cookies: string[];
  let accountId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    // Register + login as admin
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'admin@test.com',
        password: 'a-very-secure-password-16chars',
        displayName: 'Admin',
      });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@test.com',
        password: 'a-very-secure-password-16chars',
      });
    cookies = loginRes.headers['set-cookie'] as unknown as string[];

    // Create account
    const accountRes = await request(app.getHttpServer())
      .post('/api/accounts')
      .set('Cookie', cookies)
      .send({
        institution: 'boa',
        accountType: 'checking',
        nickname: 'BofA Checking',
        lastFour: '1234',
        startingBalanceCents: 0,
      });
    accountId = accountRes.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should upload CSV and return pending status', async () => {
    const csv = readFileSync(
      join(__dirname, '../../../config/sample-data/boa-checking.csv'),
    );

    const res = await request(app.getHttpServer())
      .post('/api/uploads')
      .set('Cookie', cookies)
      .attach('file', csv, 'boa-checking.csv')
      .field('accountId', accountId)
      .expect(201);

    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.fileHash).toBeDefined();
  });

  it('should reject duplicate file upload', async () => {
    const csv = readFileSync(
      join(__dirname, '../../../config/sample-data/boa-checking.csv'),
    );

    await request(app.getHttpServer())
      .post('/api/uploads')
      .set('Cookie', cookies)
      .attach('file', csv, 'boa-checking.csv')
      .field('accountId', accountId)
      .expect(400);
  });

  it('should poll upload status', async () => {
    // List uploads to get ID
    const listRes = await request(app.getHttpServer())
      .get('/api/uploads')
      .set('Cookie', cookies)
      .expect(200);

    const uploadId = listRes.body.data[0]?.id;
    if (uploadId) {
      const statusRes = await request(app.getHttpServer())
        .get(`/api/uploads/${uploadId}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(['pending', 'processing', 'completed']).toContain(
        statusRes.body.data.status,
      );
    }
  });
});
```

---

## DB Migration Required

Add `csv_format_config` column to accounts table:

```sql
ALTER TABLE accounts ADD COLUMN csv_format_config jsonb;
```

Run: `cd apps/api && pnpm drizzle-kit generate && pnpm drizzle-kit push`

---

## Implementation Order

```
Step 1:  Install dependencies (csv-parse, xlsx, multer, chokidar)
Step 2:  Add shared types (ParsedTransaction, CsvFormatConfig)
Step 3:  Add shared constants (UPLOAD_DIR, WATCH_FOLDER_DIR, INGESTION_QUEUE)
Step 4:  Update DB schema (add csvFormatConfig to accounts) + migrate
Step 5:  Create parser utilities (base.parser.ts)
Step 6:  Create BofA parser + tests
Step 7:  Create Chase CC parser + tests
Step 8:  Create Chase checking parser + tests
Step 9:  Create Amex parser + tests
Step 10: Create Citi parser + tests
Step 11: Create generic CSV parser + tests
Step 12: Create Excel parser
Step 13: Create parser registry
Step 14: Create dedup service + tests
Step 15: Create archiver service
Step 16: Create account service + controller + module
Step 17: Create transaction service + controller + module
Step 18: Create ingestion service + controller
Step 19: Create BullMQ processor
Step 20: Create watcher service
Step 21: Create ingestion module
Step 22: Update app.module.ts (import BullModule, accounts, transactions, ingestion)
Step 23: Create sample data fixtures
Step 24: Build + verify API starts
Step 25: Run unit tests
Step 26: Run E2E tests
Step 27: Manual test: upload BofA CSV → verify DB rows
Step 28: Manual test: upload same file → verify dedup (0 new)
Step 29: Git commit
```

---

## API Endpoints Summary

| Method   | Path                                | Auth | Description                       |
| -------- | ----------------------------------- | ---- | --------------------------------- |
| `POST`   | `/api/accounts`                     | JWT  | Create bank account               |
| `GET`    | `/api/accounts`                     | JWT  | List user accounts                |
| `GET`    | `/api/accounts/:id`                 | JWT  | Get account by ID                 |
| `PATCH`  | `/api/accounts/:id`                 | JWT  | Update account                    |
| `DELETE` | `/api/accounts/:id`                 | JWT  | Soft delete account               |
| `PATCH`  | `/api/accounts/:id/csv-format`      | JWT  | Set generic CSV format config     |
| `POST`   | `/api/uploads`                      | JWT  | Upload bank statement (multipart) |
| `GET`    | `/api/uploads/:id`                  | JWT  | Get upload status (polling)       |
| `GET`    | `/api/uploads`                      | JWT  | List user uploads                 |
| `POST`   | `/api/transactions`                 | JWT  | Create manual transaction         |
| `GET`    | `/api/transactions`                 | JWT  | List transactions (paginated)     |
| `GET`    | `/api/transactions/:id`             | JWT  | Get transaction                   |
| `PATCH`  | `/api/transactions/:id`             | JWT  | Update transaction                |
| `DELETE` | `/api/transactions/:id`             | JWT  | Soft delete transaction           |
| `POST`   | `/api/transactions/:id/split`       | JWT  | Split transaction                 |
| `POST`   | `/api/transactions/bulk-categorize` | JWT  | Bulk categorize                   |

---

## Upload Pipeline Flow

```
User drops file       API receives           BullMQ Job
     │                     │                      │
     │ POST /uploads       │                      │
     │ (multipart)         │                      │
     │────────────────────>│                      │
     │                     │ SHA256 hash           │
     │                     │ Duplicate? → 400      │
     │                     │ Save to UPLOAD_DIR    │
     │                     │ INSERT file_uploads   │
     │                     │ Queue job             │
     │ { id, status:       │────────────────────>  │
     │   "pending" }       │                      │ Read file
     │<────────────────────│                      │ Parse CSV/Excel
     │                     │                      │ Select parser (auto-detect)
     │ GET /uploads/:id    │                      │ Dedup (hash + external_id)
     │ (poll every 2s)     │                      │ INSERT transactions (batch)
     │────────────────────>│                      │ Archive file
     │ { status:           │                      │ UPDATE file_uploads
     │   "processing" }    │                      │    status=completed
     │<────────────────────│                      │    rows_imported=N
     │                     │                      │    rows_skipped=M
     │ GET /uploads/:id    │                      │
     │────────────────────>│                      │
     │ { status:           │                      │
     │   "completed",      │                      │
     │   rowsImported: 5,  │                      │
     │   rowsSkipped: 0 }  │                      │
     │<────────────────────│                      │
```

---

## Post-Implementation Review Fixes

The following issues were identified in code review and addressed:

### Security Fixes

| Issue | Fix |
|-------|-----|
| **Path traversal via `file.originalname`** | Sanitize with `basename()` + strip non-alphanumeric/dot/dash chars before using in `path.join()`. Original name stored as display label only. |
| **Cross-account upload injection** | `uploadFile` now verifies the `accountId` belongs to the requesting `userId` (returns 404 to avoid enumeration). |
| **Upload status enumeration** | `getUploadStatus` scoped to `userId`; controller passes `user.sub` to the service. |
| **Manual transaction cross-account** | `transactions.create` validates `accountId` belongs to the user before inserting. |
| **Unvalidated `csvFormatConfig` JSON** | Zod schema (`csvFormatConfigSchema`) added to shared package; validated at the controller before storing. |
| **`GET /transactions/:id` without auth check** | `findByIdForUser(id, userId, householdId)` enforces ownership or household membership; returns 404 on no access. |

### Correctness Fixes

| Issue | Fix |
|-------|-----|
| **`.xls` listed as supported but exceljs only handles `.xlsx`** | `detectFileType` throws 400 for `.xls`; controller file filter also excludes `.xls`. Docstring updated. |
| **`sortBy=category` silently fell back to `date`** | `categoryId` added to `sortColumnMap`. |
| **Split already-split transaction** | Guard added: throws 400 (`BadRequestException`) if `parent.isSplitParent === true`. |
| **`rowOffset` hardcoded to 2; `skipRows` ignored** | Processor applies `account.csvFormatConfig.skipRows` to skip leading rows before passing to parser; `rowOffset` adjusted accordingly. |
| **Household accounts not returned by `GET /accounts`** | Controller now calls `findByHousehold(householdId)` when `user.householdId` is set. |

### Performance Fix

| Issue | Fix |
|-------|-----|
| **Dedup loaded ALL account hashes into memory** | `DedupService` now uses targeted `WHERE txn_hash IN (...)` and `WHERE external_id IN (...)` queries scoped to the incoming batch, leveraging existing indexes. |

### Robustness Fixes

| Issue | Fix |
|-------|-----|
| **Generic CSV parser crashed on null `debitColumn`/`creditColumn`** | Runtime guard: pushes structured error row and `continue` if `debitColumn`/`creditColumn` are null when `signConvention = split_columns`. |
| **Excel parser: empty header cells caused key collisions** | Header cells are trimmed; empty headers get a `col_N` fallback name. |
| **Watcher path separator assumed POSIX `/`** | `relativePath.replace(/\\/g, '/')` normalizes backslashes before splitting. |

### CI Fix

| Issue | Fix |
|-------|-----|
| **`PNPM_VERSION: '10'` could mismatch lockfile** | Pinned to `'10.32.1'` matching `packageManager` in `package.json`. |
