# Phase 8: Investment Tracking — Implementation Spec

**Dependencies**: Phase 5 (dashboard, analytics), Phase 6 (notifications)

## Decisions Summary

| #   | Decision          | Choice                                                            |
| --- | ----------------- | ----------------------------------------------------------------- |
| 1   | Data entry        | Manual balance snapshots + CSV import                             |
| 2   | Platforms         | Robinhood, Betterment, Shareworks (Morgan Stanley), T. Rowe Price |
| 3   | Parser detail     | Full parser code for all 4 platforms                              |
| 4   | Balance reminders | Monthly cron (Phase 6 reminder processor)                         |
| 5   | Net worth         | checking + savings + investments − CC balances                    |

---

## File Inventory

### Backend — Investment Module

| #   | File                                                    | Purpose                                |
| --- | ------------------------------------------------------- | -------------------------------------- |
| 1   | `src/investments/investments.module.ts`                 | Module wiring                          |
| 2   | `src/investments/investments.service.ts`                | Account + snapshot CRUD                |
| 3   | `src/investments/investments.controller.ts`             | REST endpoints                         |
| 4   | `src/investments/parsers/robinhood.parser.ts`           | Robinhood CSV parser                   |
| 5   | `src/investments/parsers/betterment.parser.ts`          | Betterment CSV parser                  |
| 6   | `src/investments/parsers/shareworks.parser.ts`          | Shareworks (Morgan Stanley) CSV parser |
| 7   | `src/investments/parsers/trowe-price.parser.ts`         | T. Rowe Price CSV parser               |
| 8   | `src/investments/parsers/investment-parser.registry.ts` | Parser registry                        |

### Frontend — Investment Pages

| #   | File                                       | Purpose                           |
| --- | ------------------------------------------ | --------------------------------- |
| 9   | `src/app/investments/page.tsx`             | Investment dashboard              |
| 10  | `src/components/InvestmentAccountCard.tsx` | Account card with balance history |
| 11  | `src/lib/hooks/useInvestments.ts`          | React Query hooks                 |

### Tests

| #   | File                                                             | Purpose                 |
| --- | ---------------------------------------------------------------- | ----------------------- |
| 12  | `apps/api/src/investments/__tests__/investments.service.spec.ts` | Service tests           |
| 13  | `apps/api/src/investments/__tests__/robinhood.parser.spec.ts`    | Robinhood parser tests  |
| 14  | `apps/api/src/investments/__tests__/betterment.parser.spec.ts`   | Betterment parser tests |
| 15  | `apps/api/test/investments.e2e-spec.ts`                          | E2E tests               |

### Sample Data

| #   | File                                        | Purpose      |
| --- | ------------------------------------------- | ------------ |
| 16  | `config/sample-data/robinhood-sample.csv`   | Test fixture |
| 17  | `config/sample-data/betterment-sample.csv`  | Test fixture |
| 18  | `config/sample-data/shareworks-sample.csv`  | Test fixture |
| 19  | `config/sample-data/trowe-price-sample.csv` | Test fixture |

---

## 1. Investment Service

### `apps/api/src/investments/investments.service.ts`

```typescript
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';

export interface CreateInvestmentAccountInput {
  institution: string;
  accountType: string;
  nickname: string;
}

export interface CreateSnapshotInput {
  investmentAccountId: string;
  date: string;
  balanceCents: number;
}

@Injectable()
export class InvestmentsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  // ── Accounts ─────────────────────────────────────────────

  async findAccounts(userId: string) {
    return this.db
      .select()
      .from(schema.investmentAccounts)
      .where(
        and(
          eq(schema.investmentAccounts.userId, userId),
          isNull(schema.investmentAccounts.deletedAt),
        ),
      )
      .orderBy(schema.investmentAccounts.nickname);
  }

  /**
   * Find accounts with latest snapshot balance.
   */
  async findAccountsWithBalance(userId: string) {
    const rows = await this.db.execute(sql`
      SELECT
        ia.id,
        ia.institution,
        ia.account_type,
        ia.nickname,
        ia.created_at,
        latest.balance_cents AS latest_balance_cents,
        latest.date AS latest_snapshot_date
      FROM ${schema.investmentAccounts} ia
      LEFT JOIN LATERAL (
        SELECT s.balance_cents, s.date
        FROM ${schema.investmentSnapshots} s
        WHERE s.investment_account_id = ia.id
        ORDER BY s.date DESC
        LIMIT 1
      ) latest ON true
      WHERE ia.user_id = ${userId}
        AND ia.deleted_at IS NULL
      ORDER BY ia.nickname
    `);
    return rows.rows ?? rows;
  }

  async createAccount(userId: string, input: CreateInvestmentAccountInput) {
    const rows = await this.db
      .insert(schema.investmentAccounts)
      .values({
        userId,
        institution: input.institution,
        accountType: input.accountType,
        nickname: input.nickname,
      })
      .returning();
    return rows[0];
  }

  async deleteAccount(id: string, userId: string) {
    const existing = await this.db
      .select()
      .from(schema.investmentAccounts)
      .where(
        and(
          eq(schema.investmentAccounts.id, id),
          eq(schema.investmentAccounts.userId, userId),
        ),
      )
      .limit(1);
    if (!existing[0])
      throw new NotFoundException('Investment account not found');

    await this.db
      .update(schema.investmentAccounts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.investmentAccounts.id, id));
  }

  // ── Snapshots ────────────────────────────────────────────

  async findSnapshots(investmentAccountId: string, limit = 52) {
    return this.db
      .select()
      .from(schema.investmentSnapshots)
      .where(
        eq(schema.investmentSnapshots.investmentAccountId, investmentAccountId),
      )
      .orderBy(desc(schema.investmentSnapshots.date))
      .limit(limit);
  }

  async createSnapshot(userId: string, input: CreateSnapshotInput) {
    // Verify account belongs to user
    const account = await this.db
      .select()
      .from(schema.investmentAccounts)
      .where(
        and(
          eq(schema.investmentAccounts.id, input.investmentAccountId),
          eq(schema.investmentAccounts.userId, userId),
        ),
      )
      .limit(1);
    if (!account[0])
      throw new NotFoundException('Investment account not found');

    const rows = await this.db
      .insert(schema.investmentSnapshots)
      .values({
        investmentAccountId: input.investmentAccountId,
        date: new Date(input.date),
        balanceCents: input.balanceCents,
      })
      .returning();
    return rows[0];
  }

  async bulkCreateSnapshots(userId: string, snapshots: CreateSnapshotInput[]) {
    // Verify all accounts belong to user
    const accountIds = [
      ...new Set(snapshots.map((s) => s.investmentAccountId)),
    ];
    for (const accountId of accountIds) {
      const account = await this.db
        .select()
        .from(schema.investmentAccounts)
        .where(
          and(
            eq(schema.investmentAccounts.id, accountId),
            eq(schema.investmentAccounts.userId, userId),
          ),
        )
        .limit(1);
      if (!account[0])
        throw new NotFoundException(
          `Investment account ${accountId} not found`,
        );
    }

    const values = snapshots.map((s) => ({
      investmentAccountId: s.investmentAccountId,
      date: new Date(s.date),
      balanceCents: s.balanceCents,
    }));

    const rows = await this.db
      .insert(schema.investmentSnapshots)
      .values(values)
      .returning();
    return rows;
  }

  // ── Investment Total (for net worth) ─────────────────────

  async investmentTotal(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COALESCE(SUM(latest.balance_cents), 0) AS total_cents
      FROM (
        SELECT DISTINCT ON (ia.id) s.balance_cents
        FROM ${schema.investmentAccounts} ia
        JOIN ${schema.investmentSnapshots} s ON ia.id = s.investment_account_id
        WHERE ia.user_id = ${userId} AND ia.deleted_at IS NULL
        ORDER BY ia.id, s.date DESC
      ) latest
    `);
    return Number((rows.rows ?? rows)[0]?.total_cents ?? 0);
  }
}
```

### `apps/api/src/investments/investments.controller.ts`

```typescript
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  InvestmentsService,
  CreateInvestmentAccountInput,
  CreateSnapshotInput,
} from './investments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Investments')
@Controller('investments')
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'List investment accounts with latest balance' })
  async findAccounts(@Req() req: any) {
    const data = await this.investmentsService.findAccountsWithBalance(
      req.user.id,
    );
    return { data };
  }

  @Post('accounts')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create investment account' })
  async createAccount(
    @Req() req: any,
    @Body() body: CreateInvestmentAccountInput,
  ) {
    const account = await this.investmentsService.createAccount(
      req.user.id,
      body,
    );
    return { data: account };
  }

  @Delete('accounts/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete investment account' })
  async deleteAccount(@Req() req: any, @Param('id') id: string) {
    await this.investmentsService.deleteAccount(id, req.user.id);
    return { data: { deleted: true } };
  }

  @Get('accounts/:accountId/snapshots')
  @ApiOperation({ summary: 'List snapshots for an investment account' })
  async findSnapshots(@Param('accountId') accountId: string) {
    const data = await this.investmentsService.findSnapshots(accountId);
    return { data };
  }

  @Post('snapshots')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add manual balance snapshot' })
  async createSnapshot(@Req() req: any, @Body() body: CreateSnapshotInput) {
    const snapshot = await this.investmentsService.createSnapshot(
      req.user.id,
      body,
    );
    return { data: snapshot };
  }

  @Post('snapshots/bulk')
  @HttpCode(201)
  @ApiOperation({ summary: 'Bulk import snapshots (from CSV parsers)' })
  async bulkCreateSnapshots(
    @Req() req: any,
    @Body() body: { snapshots: CreateSnapshotInput[] },
  ) {
    const data = await this.investmentsService.bulkCreateSnapshots(
      req.user.id,
      body.snapshots,
    );
    return { data };
  }

  @Get('total')
  @ApiOperation({ summary: 'Total investment balance' })
  async investmentTotal(@Req() req: any) {
    const totalCents = await this.investmentsService.investmentTotal(
      req.user.id,
    );
    return { data: { totalCents } };
  }
}
```

### `apps/api/src/investments/investments.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { InvestmentParserRegistry } from './parsers/investment-parser.registry';
import { RobinhoodParser } from './parsers/robinhood.parser';
import { BettermentParser } from './parsers/betterment.parser';
import { ShareworksParser } from './parsers/shareworks.parser';
import { TRowePriceParser } from './parsers/trowe-price.parser';

@Module({
  providers: [
    InvestmentsService,
    InvestmentParserRegistry,
    RobinhoodParser,
    BettermentParser,
    ShareworksParser,
    TRowePriceParser,
  ],
  controllers: [InvestmentsController],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
```

---

## 2. Investment CSV Parsers

### Parser Interface

```typescript
// Shared interface used by all investment parsers
export interface InvestmentParseResult {
  snapshots: {
    date: string; // YYYY-MM-DD
    balanceCents: number;
  }[];
  transactions: {
    date: string;
    type: string; // buy, sell, dividend, deposit, withdrawal, vest, etc.
    symbol?: string;
    shares?: number;
    priceCents?: number;
    amountCents: number;
    description: string;
  }[];
  metadata: {
    institution: string;
    rowsProcessed: number;
    dateRange: { from: string; to: string };
  };
}
```

### `apps/api/src/investments/parsers/investment-parser.registry.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { RobinhoodParser } from './robinhood.parser';
import { BettermentParser } from './betterment.parser';
import { ShareworksParser } from './shareworks.parser';
import { TRowePriceParser } from './trowe-price.parser';

export interface InvestmentParser {
  institution: string;
  detect(headers: string[]): boolean;
  parse(csvContent: string): Promise<InvestmentParseResult>;
}

export interface InvestmentParseResult {
  snapshots: { date: string; balanceCents: number }[];
  transactions: {
    date: string;
    type: string;
    symbol?: string;
    shares?: number;
    priceCents?: number;
    amountCents: number;
    description: string;
  }[];
  metadata: {
    institution: string;
    rowsProcessed: number;
    dateRange: { from: string; to: string };
  };
}

@Injectable()
export class InvestmentParserRegistry {
  private parsers: InvestmentParser[];

  constructor(
    private robinhood: RobinhoodParser,
    private betterment: BettermentParser,
    private shareworks: ShareworksParser,
    private trowePrice: TRowePriceParser,
  ) {
    this.parsers = [robinhood, betterment, shareworks, trowePrice];
  }

  detect(headers: string[]): InvestmentParser | null {
    return this.parsers.find((p) => p.detect(headers)) ?? null;
  }

  getByInstitution(institution: string): InvestmentParser | null {
    return this.parsers.find((p) => p.institution === institution) ?? null;
  }
}
```

### `apps/api/src/investments/parsers/robinhood.parser.ts`

Robinhood CSV format:

```
Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount
03/15/2026,03/15/2026,03/17/2026,AAPL,Apple Inc,Buy,10,150.25,-1502.50
03/01/2026,03/01/2026,03/01/2026,,CASH MANAGEMENT INTEREST,CDIV,,,5.23
```

```typescript
import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type {
  InvestmentParser,
  InvestmentParseResult,
} from './investment-parser.registry';

@Injectable()
export class RobinhoodParser implements InvestmentParser {
  institution = 'robinhood';

  detect(headers: string[]): boolean {
    const normalized = headers.map((h) => h.toLowerCase().trim());
    return (
      normalized.includes('activity date') &&
      normalized.includes('trans code') &&
      normalized.includes('instrument')
    );
  }

  async parse(csvContent: string): Promise<InvestmentParseResult> {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    const transactions: InvestmentParseResult['transactions'] = [];
    let minDate = '9999-12-31';
    let maxDate = '0000-01-01';

    for (const row of records) {
      const dateStr = row['Activity Date'];
      if (!dateStr) continue;

      // Parse MM/DD/YYYY → YYYY-MM-DD
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

      if (date < minDate) minDate = date;
      if (date > maxDate) maxDate = date;

      const amount = parseFloat(row['Amount'] || '0');
      const price = parseFloat(row['Price'] || '0');
      const quantity = parseFloat(row['Quantity'] || '0');
      const transCode = (row['Trans Code'] || '').trim();

      // Map Robinhood trans codes
      let type: string;
      switch (transCode) {
        case 'Buy':
          type = 'buy';
          break;
        case 'Sell':
          type = 'sell';
          break;
        case 'CDIV':
          type = 'dividend';
          break;
        case 'ACH':
          type = amount > 0 ? 'deposit' : 'withdrawal';
          break;
        case 'SPL':
          type = 'split';
          break;
        default:
          type = 'other';
      }

      transactions.push({
        date,
        type,
        symbol: row['Instrument'] || undefined,
        shares: quantity || undefined,
        priceCents: price ? Math.round(price * 100) : undefined,
        amountCents: Math.round(amount * 100),
        description: `${row['Description'] || ''} (${transCode})`.trim(),
      });
    }

    // Calculate running balance as snapshots (one per day with activity)
    const dailyTotals = new Map<string, number>();
    let running = 0;
    const sorted = [...transactions].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (const txn of sorted) {
      running += txn.amountCents;
      dailyTotals.set(txn.date, running);
    }

    const snapshots = [...dailyTotals.entries()].map(([date, balance]) => ({
      date,
      balanceCents: balance,
    }));

    return {
      snapshots,
      transactions,
      metadata: {
        institution: 'robinhood',
        rowsProcessed: records.length,
        dateRange: { from: minDate, to: maxDate },
      },
    };
  }
}
```

### `apps/api/src/investments/parsers/betterment.parser.ts`

Betterment CSV format:

```
Date,Type,Description,Amount,Balance
2026-03-15,Deposit,Auto-deposit,500.00,12500.00
2026-03-14,Dividend,Quarterly dividend,45.30,12000.00
2026-03-01,Market Change,Market adjustment,125.00,11954.70
```

```typescript
import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type {
  InvestmentParser,
  InvestmentParseResult,
} from './investment-parser.registry';

@Injectable()
export class BettermentParser implements InvestmentParser {
  institution = 'betterment';

  detect(headers: string[]): boolean {
    const normalized = headers.map((h) => h.toLowerCase().trim());
    return (
      normalized.includes('date') &&
      normalized.includes('type') &&
      normalized.includes('balance') &&
      normalized.includes('amount')
    );
  }

  async parse(csvContent: string): Promise<InvestmentParseResult> {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const transactions: InvestmentParseResult['transactions'] = [];
    const snapshots: InvestmentParseResult['snapshots'] = [];
    let minDate = '9999-12-31';
    let maxDate = '0000-01-01';

    for (const row of records) {
      const date = row['Date'];
      if (!date) continue;

      if (date < minDate) minDate = date;
      if (date > maxDate) maxDate = date;

      const amount = parseFloat(row['Amount'] || '0');
      const balance = parseFloat(row['Balance'] || '0');
      const typeRaw = (row['Type'] || '').toLowerCase();

      let type: string;
      switch (typeRaw) {
        case 'deposit':
          type = 'deposit';
          break;
        case 'withdrawal':
          type = 'withdrawal';
          break;
        case 'dividend':
          type = 'dividend';
          break;
        case 'market change':
          type = 'market_change';
          break;
        case 'advisory fee':
          type = 'fee';
          break;
        default:
          type = 'other';
      }

      transactions.push({
        date,
        type,
        amountCents: Math.round(amount * 100),
        description: row['Description'] || typeRaw,
      });

      // Betterment provides balance on each row
      snapshots.push({
        date,
        balanceCents: Math.round(balance * 100),
      });
    }

    // Deduplicate snapshots to one per date (latest/last row wins)
    const snapshotMap = new Map<string, number>();
    for (const s of snapshots) {
      snapshotMap.set(s.date, s.balanceCents);
    }
    const deduped = [...snapshotMap.entries()]
      .map(([date, balanceCents]) => ({ date, balanceCents }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      snapshots: deduped,
      transactions,
      metadata: {
        institution: 'betterment',
        rowsProcessed: records.length,
        dateRange: { from: minDate, to: maxDate },
      },
    };
  }
}
```

### `apps/api/src/investments/parsers/shareworks.parser.ts`

Shareworks (Morgan Stanley) CSV format:

```
Grant ID,Grant Date,Vest Date,Vest Number,Shares Vested,Price Per Share,Gross Value,Taxes Withheld,Net Value
RSU-001,2024-01-15,2026-03-15,4,50,185.50,9275.00,3245.00,6030.00
RSU-001,2024-01-15,2025-09-15,3,50,170.25,8512.50,2979.00,5533.50
```

```typescript
import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type {
  InvestmentParser,
  InvestmentParseResult,
} from './investment-parser.registry';

@Injectable()
export class ShareworksParser implements InvestmentParser {
  institution = 'shareworks';

  detect(headers: string[]): boolean {
    const normalized = headers.map((h) => h.toLowerCase().trim());
    return (
      normalized.includes('grant id') &&
      normalized.includes('vest date') &&
      normalized.includes('shares vested')
    );
  }

  async parse(csvContent: string): Promise<InvestmentParseResult> {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const transactions: InvestmentParseResult['transactions'] = [];
    let minDate = '9999-12-31';
    let maxDate = '0000-01-01';
    let runningNetValue = 0;

    // Sort by vest date
    const sorted = [...records].sort((a: any, b: any) =>
      (a['Vest Date'] || '').localeCompare(b['Vest Date'] || ''),
    );

    const snapshots: InvestmentParseResult['snapshots'] = [];

    for (const row of sorted) {
      const date = row['Vest Date'];
      if (!date) continue;

      if (date < minDate) minDate = date;
      if (date > maxDate) maxDate = date;

      const shares = parseFloat(row['Shares Vested'] || '0');
      const price = parseFloat(row['Price Per Share'] || '0');
      const grossValue = parseFloat(row['Gross Value'] || '0');
      const taxes = parseFloat(row['Taxes Withheld'] || '0');
      const netValue = parseFloat(row['Net Value'] || '0');

      transactions.push({
        date,
        type: 'vest',
        symbol: row['Grant ID'],
        shares,
        priceCents: Math.round(price * 100),
        amountCents: Math.round(netValue * 100),
        description: `Vest ${row['Grant ID']} #${row['Vest Number']}: ${shares} shares @ $${price.toFixed(2)} (net: $${netValue.toFixed(2)}, taxes: $${taxes.toFixed(2)})`,
      });

      runningNetValue += netValue;
      snapshots.push({
        date,
        balanceCents: Math.round(runningNetValue * 100),
      });
    }

    return {
      snapshots,
      transactions,
      metadata: {
        institution: 'shareworks',
        rowsProcessed: records.length,
        dateRange: { from: minDate, to: maxDate },
      },
    };
  }
}
```

### `apps/api/src/investments/parsers/trowe-price.parser.ts`

T. Rowe Price CSV format:

```
Date,Fund Name,Transaction Type,Amount,Shares,Share Price,Balance
2026-03-15,Blue Chip Growth Fund,Contribution,500.00,2.85,175.44,15250.00
2026-03-14,Blue Chip Growth Fund,Dividend Reinvest,25.30,0.15,168.67,14750.00
2026-03-01,Retirement 2055 Fund,Contribution,250.00,1.20,208.33,8500.00
```

```typescript
import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import type {
  InvestmentParser,
  InvestmentParseResult,
} from './investment-parser.registry';

@Injectable()
export class TRowePriceParser implements InvestmentParser {
  institution = 'trowe_price';

  detect(headers: string[]): boolean {
    const normalized = headers.map((h) => h.toLowerCase().trim());
    return (
      normalized.includes('fund name') &&
      normalized.includes('share price') &&
      normalized.includes('transaction type')
    );
  }

  async parse(csvContent: string): Promise<InvestmentParseResult> {
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const transactions: InvestmentParseResult['transactions'] = [];
    const snapshotMap = new Map<string, number>(); // date → total balance across all funds
    let minDate = '9999-12-31';
    let maxDate = '0000-01-01';

    // Group by date for aggregate balance
    const dateBalances = new Map<string, Map<string, number>>(); // date → fund → balance

    for (const row of records) {
      const date = row['Date'];
      if (!date) continue;

      if (date < minDate) minDate = date;
      if (date > maxDate) maxDate = date;

      const amount = parseFloat(row['Amount'] || '0');
      const shares = parseFloat(row['Shares'] || '0');
      const sharePrice = parseFloat(row['Share Price'] || '0');
      const balance = parseFloat(row['Balance'] || '0');
      const fundName = row['Fund Name'] || '';
      const txnTypeRaw = (row['Transaction Type'] || '').toLowerCase();

      let type: string;
      switch (txnTypeRaw) {
        case 'contribution':
          type = 'deposit';
          break;
        case 'withdrawal':
          type = 'withdrawal';
          break;
        case 'dividend reinvest':
          type = 'dividend';
          break;
        case 'exchange in':
          type = 'transfer_in';
          break;
        case 'exchange out':
          type = 'transfer_out';
          break;
        default:
          type = 'other';
      }

      transactions.push({
        date,
        type,
        symbol: fundName,
        shares: shares || undefined,
        priceCents: sharePrice ? Math.round(sharePrice * 100) : undefined,
        amountCents: Math.round(amount * 100),
        description: `${fundName}: ${row['Transaction Type']} $${amount.toFixed(2)}`,
      });

      // Track per-fund balance by date
      if (!dateBalances.has(date)) dateBalances.set(date, new Map());
      dateBalances.get(date)!.set(fundName, Math.round(balance * 100));
    }

    // Aggregate balance across funds per date
    // Use the latest known balance for each fund
    const fundLastBalance = new Map<string, number>();
    const sortedDates = [...dateBalances.keys()].sort();

    const snapshots: InvestmentParseResult['snapshots'] = [];
    for (const date of sortedDates) {
      const fundBalances = dateBalances.get(date)!;
      for (const [fund, bal] of fundBalances) {
        fundLastBalance.set(fund, bal);
      }
      const totalBalance = [...fundLastBalance.values()].reduce(
        (s, v) => s + v,
        0,
      );
      snapshots.push({ date, balanceCents: totalBalance });
    }

    return {
      snapshots,
      transactions,
      metadata: {
        institution: 'trowe_price',
        rowsProcessed: records.length,
        dateRange: { from: minDate, to: maxDate },
      },
    };
  }
}
```

---

## 3. Sample Data Fixtures

### `config/sample-data/robinhood-sample.csv`

```csv
Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount
03/15/2026,03/15/2026,03/17/2026,AAPL,Apple Inc,Buy,10,150.25,-1502.50
03/10/2026,03/10/2026,03/10/2026,,ACH DEPOSIT,ACH,,,2000.00
03/05/2026,03/05/2026,03/07/2026,MSFT,Microsoft Corp,Buy,5,420.00,-2100.00
03/01/2026,03/01/2026,03/01/2026,,CASH MANAGEMENT INTEREST,CDIV,,,5.23
02/20/2026,02/20/2026,02/22/2026,AAPL,Apple Inc,Sell,5,155.00,775.00
02/15/2026,02/15/2026,02/15/2026,,ACH DEPOSIT,ACH,,,1500.00
```

### `config/sample-data/betterment-sample.csv`

```csv
Date,Type,Description,Amount,Balance
2026-03-15,Deposit,Auto-deposit,500.00,12500.00
2026-03-14,Dividend,Quarterly dividend,45.30,12000.00
2026-03-01,Market Change,Market adjustment,125.00,11954.70
2026-02-15,Deposit,Auto-deposit,500.00,11829.70
2026-02-01,Advisory Fee,Monthly advisory fee,-8.50,11329.70
2026-01-15,Deposit,Auto-deposit,500.00,11338.20
```

### `config/sample-data/shareworks-sample.csv`

```csv
Grant ID,Grant Date,Vest Date,Vest Number,Shares Vested,Price Per Share,Gross Value,Taxes Withheld,Net Value
RSU-001,2024-01-15,2026-03-15,4,50,185.50,9275.00,3245.00,6030.00
RSU-001,2024-01-15,2025-09-15,3,50,170.25,8512.50,2979.00,5533.50
RSU-001,2024-01-15,2025-03-15,2,50,160.00,8000.00,2800.00,5200.00
RSU-001,2024-01-15,2024-09-15,1,50,145.75,7287.50,2550.00,4737.50
```

### `config/sample-data/trowe-price-sample.csv`

```csv
Date,Fund Name,Transaction Type,Amount,Shares,Share Price,Balance
2026-03-15,Blue Chip Growth Fund,Contribution,500.00,2.85,175.44,15250.00
2026-03-14,Blue Chip Growth Fund,Dividend Reinvest,25.30,0.15,168.67,14750.00
2026-03-01,Retirement 2055 Fund,Contribution,250.00,1.20,208.33,8500.00
2026-02-15,Blue Chip Growth Fund,Contribution,500.00,3.00,166.67,14724.70
2026-02-01,Retirement 2055 Fund,Contribution,250.00,1.25,200.00,8250.00
```

---

## 4. Frontend — Investment Dashboard

### `apps/web/src/lib/hooks/useInvestments.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useInvestmentAccounts() {
  return useQuery({
    queryKey: ['investment-accounts'],
    queryFn: () => api.get<{ data: any[] }>('/investments/accounts'),
    select: (res) => res.data,
  });
}

export function useInvestmentSnapshots(accountId: string) {
  return useQuery({
    queryKey: ['investment-snapshots', accountId],
    queryFn: () =>
      api.get<{ data: any[] }>(`/investments/accounts/${accountId}/snapshots`),
    select: (res) => res.data,
    enabled: !!accountId,
  });
}

export function useCreateInvestmentAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/investments/accounts', body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['investment-accounts'] }),
  });
}

export function useAddSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/investments/snapshots', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['investment-accounts'] });
      qc.invalidateQueries({ queryKey: ['investment-snapshots'] });
    },
  });
}

export function useInvestmentTotal() {
  return useQuery({
    queryKey: ['investment-total'],
    queryFn: () =>
      api.get<{ data: { totalCents: number } }>('/investments/total'),
    select: (res) => res.data.totalCents,
  });
}
```

### `apps/web/src/components/InvestmentAccountCard.tsx`

```tsx
'use client';

import { formatCents, formatDate } from '@/lib/format';

interface Props {
  nickname: string;
  institution: string;
  accountType: string;
  latestBalanceCents: number | null;
  latestSnapshotDate: string | null;
  onAddSnapshot: () => void;
  onDelete: () => void;
}

export function InvestmentAccountCard({
  nickname,
  institution,
  accountType,
  latestBalanceCents,
  latestSnapshotDate,
  onAddSnapshot,
  onDelete,
}: Props) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="font-medium">{nickname}</h3>
          <p className="text-xs text-muted-foreground">
            {institution} · {accountType}
          </p>
        </div>
      </div>

      <div className="mt-3">
        {latestBalanceCents !== null ? (
          <>
            <p className="text-2xl font-bold text-green-600">
              {formatCents(latestBalanceCents)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Last updated:{' '}
              {latestSnapshotDate ? formatDate(latestSnapshotDate) : 'Never'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No balance data</p>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={onAddSnapshot}
          className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded"
        >
          + Add Balance
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-3 py-1.5 text-muted-foreground hover:text-red-600"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

### `apps/web/src/app/investments/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { InvestmentAccountCard } from '@/components/InvestmentAccountCard';
import {
  useInvestmentAccounts,
  useCreateInvestmentAccount,
  useAddSnapshot,
  useInvestmentTotal,
} from '@/lib/hooks/useInvestments';
import { formatCents } from '@/lib/format';

export default function InvestmentsPage() {
  const { data: accounts } = useInvestmentAccounts();
  const { data: totalCents } = useInvestmentTotal();
  const createAccount = useCreateInvestmentAccount();
  const addSnapshot = useAddSnapshot();

  const [showForm, setShowForm] = useState(false);

  const handleAddSnapshot = (accountId: string) => {
    const amount = prompt('Current balance in dollars:');
    if (amount) {
      addSnapshot.mutate({
        investmentAccountId: accountId,
        date: new Date().toISOString().slice(0, 10),
        balanceCents: Math.round(parseFloat(amount) * 100),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Investments</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md"
        >
          + Add Account
        </button>
      </div>

      {/* Total */}
      {totalCents !== undefined && (
        <div className="bg-card border border-border rounded-lg p-6">
          <p className="text-sm text-muted-foreground">
            Total Investment Value
          </p>
          <p className="text-3xl font-bold text-green-600">
            {formatCents(totalCents)}
          </p>
        </div>
      )}

      {/* Add Account Form */}
      {showForm && (
        <form
          className="bg-card border border-border rounded-lg p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.target as HTMLFormElement;
            const data = new FormData(form);
            createAccount.mutate(
              {
                institution: data.get('institution'),
                accountType: data.get('accountType'),
                nickname: data.get('nickname'),
              },
              { onSuccess: () => setShowForm(false) },
            );
          }}
        >
          <input
            name="nickname"
            placeholder="Nickname (e.g. My Robinhood)"
            required
            className="w-full px-3 py-2 border border-border rounded bg-background text-sm"
          />
          <select
            name="institution"
            required
            className="w-full px-3 py-2 border border-border rounded bg-background text-sm"
          >
            <option value="">Select platform...</option>
            <option value="robinhood">Robinhood</option>
            <option value="betterment">Betterment</option>
            <option value="shareworks">Shareworks (Morgan Stanley)</option>
            <option value="trowe_price">T. Rowe Price</option>
            <option value="other">Other</option>
          </select>
          <select
            name="accountType"
            required
            className="w-full px-3 py-2 border border-border rounded bg-background text-sm"
          >
            <option value="">Account type...</option>
            <option value="brokerage">Brokerage</option>
            <option value="roth_ira">Roth IRA</option>
            <option value="traditional_ira">Traditional IRA</option>
            <option value="401k">401(k)</option>
            <option value="rsu">RSU/Equity</option>
            <option value="other">Other</option>
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm bg-muted rounded"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Account cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(accounts || []).map((a: any) => (
          <InvestmentAccountCard
            key={a.id}
            nickname={a.nickname}
            institution={a.institution}
            accountType={a.account_type}
            latestBalanceCents={
              a.latest_balance_cents ? Number(a.latest_balance_cents) : null
            }
            latestSnapshotDate={a.latest_snapshot_date}
            onAddSnapshot={() => handleAddSnapshot(a.id)}
            onDelete={() => {
              if (confirm(`Delete ${a.nickname}?`)) {
                // Would call delete mutation
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 5. Net Worth Integration

The `AnalyticsService.netWorth()` method (Phase 5) already includes investment totals via the `investmentSnapshots` table. No additional backend changes needed.

Dashboard `NetWorthCard` already renders `investmentCents` from the analytics response.

---

## API Endpoints Summary (New)

| Method   | Path                                      | Auth | Description                                  |
| -------- | ----------------------------------------- | ---- | -------------------------------------------- |
| `GET`    | `/api/investments/accounts`               | JWT  | List investment accounts with latest balance |
| `POST`   | `/api/investments/accounts`               | JWT  | Create investment account                    |
| `DELETE` | `/api/investments/accounts/:id`           | JWT  | Soft delete investment account               |
| `GET`    | `/api/investments/accounts/:id/snapshots` | JWT  | List snapshots for account                   |
| `POST`   | `/api/investments/snapshots`              | JWT  | Add manual balance snapshot                  |
| `POST`   | `/api/investments/snapshots/bulk`         | JWT  | Bulk import snapshots                        |
| `GET`    | `/api/investments/total`                  | JWT  | Total investment balance                     |

---

## Implementation Order

```
Step 1:  Create investment service
Step 2:  Create investment controller + module
Step 3:  Create parser registry
Step 4:  Create Robinhood parser
Step 5:  Create Betterment parser
Step 6:  Create Shareworks parser
Step 7:  Create T. Rowe Price parser
Step 8:  Create sample CSV fixtures
Step 9:  Update app.module.ts — import InvestmentsModule
Step 10: Create frontend hooks (useInvestments)
Step 11: Create InvestmentAccountCard component
Step 12: Create investments page
Step 13: Wire CSV upload for investment files (extend upload page)
Step 14: Parser unit tests (Robinhood, Betterment)
Step 15: Integration test: upload CSV → snapshots created
Step 16: Verify net worth includes investment totals
Step 17: Git commit
```
