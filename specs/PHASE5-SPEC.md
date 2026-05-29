# Phase 5: Dashboard & Visualization — Implementation Spec

**Dependencies**: Phase 2 (transactions), Phase 3 (categories/rules)

## Decisions Summary

| #   | Decision              | Choice                                           |
| --- | --------------------- | ------------------------------------------------ |
| 1   | Chart data strategy   | Load aggregated data upfront (small result sets) |
| 2   | Navigation            | Collapsible sidebar (icons + labels)             |
| 3   | Categories page       | Dedicated page with tree view                    |
| 4   | Notification delivery | Polling (30s GET endpoint)                       |
| 5   | Charts library        | Recharts 3.x                                     |
| 6   | Data grid             | TanStack Table 8.x                               |
| 7   | Period selector       | Presets + custom date range picker               |

---

## File Inventory

### Backend — Analytics Module (`apps/api/`)

| #   | File                                    | Purpose                 |
| --- | --------------------------------------- | ----------------------- |
| 1   | `src/analytics/analytics.module.ts`     | Module wiring           |
| 2   | `src/analytics/analytics.service.ts`    | SQL aggregation queries |
| 3   | `src/analytics/analytics.controller.ts` | 7 analytics endpoints   |

### Backend — Categories Module

| #   | File                                      | Purpose                   |
| --- | ----------------------------------------- | ------------------------- |
| 4   | `src/categories/categories.module.ts`     | Module wiring             |
| 5   | `src/categories/categories.service.ts`    | Tree CRUD (recursive CTE) |
| 6   | `src/categories/categories.controller.ts` | Category REST endpoints   |

### Backend — Export

| #   | File                                 | Purpose                     |
| --- | ------------------------------------ | --------------------------- |
| 7   | `src/transactions/export.service.ts` | CSV export for transactions |

### Frontend — Layout & Navigation (`apps/web/`)

| #   | File                                          | Purpose                                                        |
| --- | --------------------------------------------- | -------------------------------------------------------------- |
| 8   | `src/components/Sidebar.tsx`                  | Collapsible sidebar navigation (no `layout/` subdirectory)     |
| 9   | `src/components/AppShell.tsx`                 | Main layout wrapper (sidebar + content)                        |
| 10  | `src/app/(protected)/layout.tsx`              | Protected route group layout — wraps with AuthProvider+AppShell |

### Frontend — Shared Components

| #   | File                                  | Purpose                                   |
| --- | ------------------------------------- | ----------------------------------------- |
| 11  | `src/components/PeriodSelector.tsx`   | Date range presets + custom picker (dropdown UI, not inline buttons) |
| 12  | ~~`src/components/NotificationBell.tsx`~~ | **Integrated into `TopBar.tsx` directly** — not a separate file |
| 13  | `src/lib/api.ts`                      | API client (fetch wrapper with cookies)   |
| 14  | `src/lib/hooks/useAnalytics.ts`       | React Query hooks for analytics endpoints |
| 15  | `src/lib/hooks/useTransactions.ts`    | React Query hooks for transaction CRUD    |
| 16  | `src/lib/hooks/useAccounts.ts`        | React Query hooks for accounts            |
| 17  | `src/lib/hooks/useCategories.ts`      | React Query hooks for categories          |
| 18  | `src/lib/hooks/useNotifications.ts`   | Polling hook for notifications            |
| 19  | `src/lib/format.ts`                   | Currency/date formatting utilities        |

### Frontend — Chart Components

| #   | File                                              | Purpose                              |
| --- | ------------------------------------------------- | ------------------------------------ |
| 20  | `src/components/charts/IncomeExpenseBar.tsx`      | Monthly income vs expenses bar chart |
| 21  | `src/components/charts/CategoryDonut.tsx`         | Spending by category donut chart     |
| 22  | `src/components/charts/SpendingTrendLine.tsx`     | Spending trend over time line chart  |
| 23  | `src/components/charts/AccountBalanceHistory.tsx` | Per-account balance multi-line chart |
| 24  | `src/components/charts/CreditUtilization.tsx`     | CC balance vs limit progress bars    |
| 25  | `src/components/charts/NetWorthCard.tsx`          | Net worth summary card               |
| 26  | `src/components/charts/TopMerchantsBar.tsx`       | Top merchants horizontal bar chart   |

### Frontend — Pages

| #   | File                                 | Purpose                                  |
| --- | ------------------------------------ | ---------------------------------------- |
| 27  | `src/app/(protected)/page.tsx`                   | Dashboard with chart grid + KPI stat cards         |
| 28  | `src/app/(protected)/transactions/page.tsx`      | Transaction grid — inline (no separate component)  |
| 29  | ~~`src/components/TransactionGrid.tsx`~~          | **Inline in transactions page** — HTML table, no TanStack Table |
| 30  | `src/app/(protected)/upload/page.tsx`            | Drag-and-drop file upload                          |
| 31  | ~~`src/components/FileUpload.tsx`~~               | **Inline in upload page** — not a separate component |
| 32  | `src/app/(protected)/accounts/page.tsx`          | Account management                                 |
| 33  | `src/app/(protected)/categories/page.tsx`        | Category tree management                           |
| 34  | `src/app/(protected)/settings/page.tsx`          | User settings                                      |

### Tests

| #   | File                                                           | Purpose               |
| --- | -------------------------------------------------------------- | --------------------- |
| 35  | `apps/api/src/analytics/__tests__/analytics.service.spec.ts`   | Analytics query tests |
| 36  | `apps/api/src/categories/__tests__/categories.service.spec.ts` | Category tree tests   |
| 37  | `apps/api/test/analytics.e2e-spec.ts`                          | E2E analytics tests   |

---

## New Dependencies

```bash
# apps/web
cd apps/web && pnpm add recharts @tanstack/react-table @tanstack/react-query date-fns lucide-react clsx next-themes

# shadcn/ui components (install via CLI during implementation)
# npx shadcn@latest add button card dropdown-menu dialog input select separator sheet table badge
```

---

## 1. API Client

> **Note:** The `api.ts` file is created in Phase 1 (with auth token refresh logic). Phase 5 extends it with the `upload()` method below. During implementation, add the `upload` method to the existing Phase 1 `ApiClient` class rather than creating a new file.

### `apps/web/src/lib/api.ts` — ADD `upload` method to existing ApiClient:

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }
    return url.toString();
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const res = await fetch(this.buildUrl(path, params), {
      ...fetchOptions,
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, error.message || res.statusText);
    }
    return res.json();
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const res = await fetch(this.buildUrl(path, params), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      ...fetchOptions,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, error.message || res.statusText);
    }
    return res.json();
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const res = await fetch(this.buildUrl(path, params), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      ...fetchOptions,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, error.message || res.statusText);
    }
    return res.json();
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    const { params, ...fetchOptions } = options || {};
    const res = await fetch(this.buildUrl(path, params), {
      method: 'DELETE',
      credentials: 'include',
      ...fetchOptions,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, error.message || res.statusText);
    }
    return res.json();
  }

  async upload<T>(path: string, formData: FormData): Promise<T> {
    const res = await fetch(this.buildUrl(path), {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, error.message || res.statusText);
    }
    return res.json();
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient(API_BASE);
```

---

## 2. Formatting Utilities

### `apps/web/src/lib/format.ts`

```typescript
/**
 * Format cents as dollar string: 12345 → "$123.45"
 */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(dollars);
}

/**
 * Format cents as compact: 123456 → "$1.2K"
 */
export function formatCentsCompact(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    compactDisplay: 'short',
  }).format(dollars);
}

/**
 * Format a date string for display: "2026-03-15" → "Mar 15, 2026"
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Format a date for short display: "2026-03-15" → "3/15"
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

/**
 * Format percentage: 0.856 → "85.6%"
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
```

---

## 3. Analytics Service (Backend)

### `apps/api/src/analytics/analytics.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, between, isNull, desc, sql, asc } from 'drizzle-orm';
import type { AnalyticsQuery, SpendingTrendQuery } from '@moneypulse/shared';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Base WHERE conditions for all analytics queries:
   * - Not a split parent (use children instead)
   * - Not soft-deleted
   * - Date range filter
   * - Optional account/category filter
   */
  private baseConditions(query: AnalyticsQuery) {
    const conditions = [
      eq(schema.transactions.isSplitParent, false),
      isNull(schema.transactions.deletedAt),
    ];

    if (query.from && query.to) {
      conditions.push(
        between(
          schema.transactions.date,
          new Date(query.from),
          new Date(query.to),
        ),
      );
    }
    if (query.accountId) {
      conditions.push(eq(schema.transactions.accountId, query.accountId));
    }
    if (query.categoryId) {
      conditions.push(eq(schema.transactions.categoryId, query.categoryId));
    }
    return and(...conditions);
  }

  /**
   * GET /analytics/income-vs-expenses?period=monthly
   * Returns monthly income/expense totals.
   */
  async incomeVsExpenses(query: AnalyticsQuery) {
    const rows = await this.db.execute(sql`
      SELECT
        to_char(date_trunc('month', ${schema.transactions.date}), 'YYYY-MM') AS month,
        SUM(CASE WHEN ${schema.transactions.isCredit} = true THEN ${schema.transactions.amountCents} ELSE 0 END) AS income_cents,
        SUM(CASE WHEN ${schema.transactions.isCredit} = false THEN ${schema.transactions.amountCents} ELSE 0 END) AS expense_cents
      FROM ${schema.transactions}
      WHERE ${schema.transactions.isSplitParent} = false
        AND ${schema.transactions.deletedAt} IS NULL
        ${query.from ? sql`AND ${schema.transactions.date} >= ${new Date(query.from)}` : sql``}
        ${query.to ? sql`AND ${schema.transactions.date} <= ${new Date(query.to)}` : sql``}
        ${query.accountId ? sql`AND ${schema.transactions.accountId} = ${query.accountId}` : sql``}
      GROUP BY date_trunc('month', ${schema.transactions.date})
      ORDER BY month ASC
    `);
    return rows.rows ?? rows;
  }

  /**
   * GET /analytics/category-breakdown
   * Returns category totals + percentages (expenses only).
   */
  async categoryBreakdown(query: AnalyticsQuery) {
    const rows = await this.db.execute(sql`
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        c.icon,
        c.color,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      LEFT JOIN ${schema.categories} c ON t.category_id = c.id
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        ${query.from ? sql`AND t.date >= ${new Date(query.from)}` : sql``}
        ${query.to ? sql`AND t.date <= ${new Date(query.to)}` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY c.id, c.name, c.icon, c.color
      ORDER BY total_cents DESC
    `);
    return rows.rows ?? rows;
  }

  /**
   * GET /analytics/spending-trend
   * Time-series spend data at daily/weekly/monthly granularity.
   */
  async spendingTrend(query: SpendingTrendQuery) {
    const truncFn = {
      daily: sql`date_trunc('day', t.date)`,
      weekly: sql`date_trunc('week', t.date)`,
      monthly: sql`date_trunc('month', t.date)`,
    }[query.granularity];

    const rows = await this.db.execute(sql`
      SELECT
        to_char(${truncFn}, 'YYYY-MM-DD') AS period,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        ${query.from ? sql`AND t.date >= ${new Date(query.from)}` : sql``}
        ${query.to ? sql`AND t.date <= ${new Date(query.to)}` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY ${truncFn}
      ORDER BY period ASC
    `);
    return rows.rows ?? rows;
  }

  /**
   * GET /analytics/account-balances
   * Per-account: starting_balance + cumulative transactions.
   */
  async accountBalances(query: AnalyticsQuery) {
    const rows = await this.db.execute(sql`
      SELECT
        a.id AS account_id,
        a.nickname,
        a.institution,
        a.account_type,
        a.starting_balance_cents,
        a.credit_limit_cents,
        COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS net_change_cents,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS current_balance_cents
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t
        ON a.id = t.account_id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
        ${query.to ? sql`AND t.date <= ${new Date(query.to)}` : sql``}
      WHERE a.deleted_at IS NULL
        ${query.accountId ? sql`AND a.id = ${query.accountId}` : sql``}
      GROUP BY a.id, a.nickname, a.institution, a.account_type,
               a.starting_balance_cents, a.credit_limit_cents
      ORDER BY a.nickname
    `);
    return rows.rows ?? rows;
  }

  /**
   * GET /analytics/credit-utilization
   * CC balance vs credit_limit per card.
   */
  async creditUtilization() {
    const rows = await this.db.execute(sql`
      SELECT
        a.id AS account_id,
        a.nickname,
        a.credit_limit_cents,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0) AS balance_cents
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t
        ON a.id = t.account_id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
      WHERE a.account_type = 'credit_card'
        AND a.deleted_at IS NULL
        AND a.credit_limit_cents IS NOT NULL
      GROUP BY a.id, a.nickname, a.credit_limit_cents, a.starting_balance_cents
    `);
    return rows.rows ?? rows;
  }

  /**
   * GET /analytics/net-worth
   * Assets (checking+savings+investments) − liabilities (CC balances).
   */
  async netWorth() {
    const rows = await this.db.execute(sql`
      SELECT
        SUM(CASE
          WHEN a.account_type IN ('checking', 'savings') THEN
            a.starting_balance_cents + COALESCE(sub.net, 0)
          ELSE 0
        END) AS assets_cents,
        SUM(CASE
          WHEN a.account_type = 'credit_card' THEN
            ABS(a.starting_balance_cents + COALESCE(sub.net, 0))
          ELSE 0
        END) AS liabilities_cents
      FROM ${schema.accounts} a
      LEFT JOIN LATERAL (
        SELECT SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ) AS net
        FROM ${schema.transactions} t
        WHERE t.account_id = a.id
          AND t.is_split_parent = false
          AND t.deleted_at IS NULL
      ) sub ON true
      WHERE a.deleted_at IS NULL
    `);

    const row = (rows.rows ?? rows)[0] || {
      assets_cents: 0,
      liabilities_cents: 0,
    };

    // Add investment balances (latest snapshot per account)
    const investmentRows = await this.db.execute(sql`
      SELECT COALESCE(SUM(latest.balance_cents), 0) AS investment_total_cents
      FROM (
        SELECT DISTINCT ON (ia.id) is2.balance_cents
        FROM ${schema.investmentAccounts} ia
        JOIN ${schema.investmentSnapshots} is2 ON ia.id = is2.investment_account_id
        WHERE ia.deleted_at IS NULL
        ORDER BY ia.id, is2.date DESC
      ) latest
    `);

    const investmentCents =
      (investmentRows.rows ?? investmentRows)[0]?.investment_total_cents ?? 0;

    // NOTE: Actual implementation returns short keys (assets/liabilities/investments/netWorth)
    // not suffixed with Cents — these map directly to the NetWorthCard component props
    return {
      assets: Number(row.assets_cents) + Number(investmentCents),
      liabilities: Number(row.liabilities_cents),
      investments: Number(investmentCents),
      netWorth:
        Number(row.assets_cents) +
        Number(investmentCents) -
        Number(row.liabilities_cents),
    };
  }

  /**
   * GET /analytics/top-merchants?limit=10
   * Highest spend merchants.
   */
  async topMerchants(query: AnalyticsQuery & { limit?: number }) {
    const limit = query.limit || 10;
    const rows = await this.db.execute(sql`
      SELECT
        COALESCE(t.merchant_name, t.description) AS merchant,
        SUM(t.amount_cents) AS total_cents,
        COUNT(*) AS txn_count
      FROM ${schema.transactions} t
      WHERE t.is_split_parent = false
        AND t.deleted_at IS NULL
        AND t.is_credit = false
        ${query.from ? sql`AND t.date >= ${new Date(query.from)}` : sql``}
        ${query.to ? sql`AND t.date <= ${new Date(query.to)}` : sql``}
        ${query.accountId ? sql`AND t.account_id = ${query.accountId}` : sql``}
      GROUP BY COALESCE(t.merchant_name, t.description)
      ORDER BY total_cents DESC
      LIMIT ${limit}
    `);
    return rows.rows ?? rows;
  }
}
```

### `apps/api/src/analytics/analytics.controller.ts`

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  analyticsQuerySchema,
  spendingTrendQuerySchema,
} from '@moneypulse/shared';
import type { AnalyticsQuery, SpendingTrendQuery } from '@moneypulse/shared';

@ApiTags('Analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('income-vs-expenses')
  @ApiOperation({ summary: 'Monthly income vs expenses' })
  async incomeVsExpenses(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ) {
    const data = await this.analyticsService.incomeVsExpenses(query);
    return { data };
  }

  @Get('category-breakdown')
  @ApiOperation({ summary: 'Spending by category with totals' })
  async categoryBreakdown(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ) {
    const data = await this.analyticsService.categoryBreakdown(query);
    return { data };
  }

  @Get('spending-trend')
  @ApiOperation({ summary: 'Spending trend over time' })
  async spendingTrend(
    @Query(new ZodValidationPipe(spendingTrendQuerySchema))
    query: SpendingTrendQuery,
  ) {
    const data = await this.analyticsService.spendingTrend(query);
    return { data };
  }

  @Get('account-balances')
  @ApiOperation({ summary: 'Per-account current balances' })
  async accountBalances(
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ) {
    const data = await this.analyticsService.accountBalances(query);
    return { data };
  }

  @Get('credit-utilization')
  @ApiOperation({ summary: 'Credit card utilization rates' })
  async creditUtilization() {
    const data = await this.analyticsService.creditUtilization();
    return { data };
  }

  @Get('net-worth')
  @ApiOperation({ summary: 'Net worth snapshot' })
  async netWorth() {
    const data = await this.analyticsService.netWorth();
    return { data };
  }

  @Get('top-merchants')
  @ApiOperation({ summary: 'Top merchants by spend' })
  async topMerchants(
    @Query(new ZodValidationPipe(analyticsQuerySchema))
    query: AnalyticsQuery & { limit?: number },
  ) {
    const data = await this.analyticsService.topMerchants(query);
    return { data };
  }
}
```

### `apps/api/src/analytics/analytics.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

---

## 4. Categories Service (Backend)

> **Note:** The `CategoriesService`, `CategoriesController`, and `CategoriesModule` are fully defined in Phase 3. Phase 5 reuses them as-is — no redefinition needed. The Phase 3 implementation includes: `findAll()`, `findTree()` (recursive CTE), `create()`, `update()` (with circular reference prevention), `softDelete()` (cascading descendants), `reorder()`, and `getDescendantIds()`.

---

## 5. Transaction CSV Export

### `apps/api/src/transactions/export.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, between, isNull, desc, sql } from 'drizzle-orm';

@Injectable()
export class ExportService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async exportCsv(userId: string, from?: string, to?: string): Promise<string> {
    const conditions = [
      eq(schema.transactions.userId, userId),
      eq(schema.transactions.isSplitParent, false),
      isNull(schema.transactions.deletedAt),
    ];

    if (from && to) {
      conditions.push(
        between(schema.transactions.date, new Date(from), new Date(to)),
      );
    }

    const rows = await this.db
      .select({
        date: schema.transactions.date,
        description: schema.transactions.description,
        amountCents: schema.transactions.amountCents,
        isCredit: schema.transactions.isCredit,
        categoryName: schema.categories.name,
        merchantName: schema.transactions.merchantName,
        accountNickname: schema.accounts.nickname,
      })
      .from(schema.transactions)
      .leftJoin(
        schema.categories,
        eq(schema.transactions.categoryId, schema.categories.id),
      )
      .leftJoin(
        schema.accounts,
        eq(schema.transactions.accountId, schema.accounts.id),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.transactions.date));

    // Build CSV
    const header = 'Date,Description,Amount,Type,Category,Merchant,Account\n';
    const lines = rows.map((r: any) => {
      const amount = (r.amountCents / 100).toFixed(2);
      const type = r.isCredit ? 'Credit' : 'Debit';
      const desc = `"${(r.description || '').replace(/"/g, '""')}"`;
      return `${r.date.toISOString().slice(0, 10)},${desc},${amount},${type},${r.categoryName || ''},${r.merchantName || ''},${r.accountNickname || ''}`;
    });

    return header + lines.join('\n');
  }
}
```

---

## 6. Sidebar Navigation

### `apps/web/src/components/layout/Sidebar.tsx`

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Upload,
  Landmark,
  FolderTree,
  Wallet,
  TrendingUp,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/accounts', label: 'Accounts', icon: Landmark },
  { href: '/categories', label: 'Categories', icon: FolderTree },
  { href: '/budgets', label: 'Budgets', icon: Wallet },
  { href: '/investments', label: 'Investments', icon: TrendingUp },
];

const ADMIN_ITEMS = [{ href: '/admin/users', label: 'Users', icon: Users }];

const BOTTOM_ITEMS = [{ href: '/settings', label: 'Settings', icon: Settings }];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={clsx(
        'flex flex-col bg-card border-r border-border h-screen sticky top-0 transition-all duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-sm">
          M
        </div>
        {!collapsed && (
          <span className="font-semibold text-lg">MoneyPulse</span>
        )}
      </div>

      {/* Main nav */}
      <nav className="flex-1 py-2 overflow-y-auto">
        <ul className="space-y-1 px-2">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))}
        </ul>

        {/* Admin section */}
        <div className="mt-4 pt-4 border-t border-border px-2">
          <ul className="space-y-1">
            {ADMIN_ITEMS.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </ul>
        </div>
      </nav>

      {/* Bottom section */}
      <div className="border-t border-border py-2 px-2">
        <ul className="space-y-1">
          {BOTTOM_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))}
        </ul>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors mt-1"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <ChevronLeft className="w-5 h-5" />
          )}
          {!collapsed && <span className="text-sm">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function NavItem({
  item,
  pathname,
  collapsed,
}: {
  item: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  pathname: string;
  collapsed: boolean;
}) {
  const isActive =
    pathname === item.href ||
    (item.href !== '/' && pathname.startsWith(item.href));
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        className={clsx(
          'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="w-5 h-5 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    </li>
  );
}
```

### `apps/web/src/components/layout/AppShell.tsx`

```tsx
'use client';

import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
```

---

## 7. Period Selector

### `apps/web/src/components/PeriodSelector.tsx`

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Calendar, ChevronDown } from 'lucide-react';
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfYear,
  subDays,
  format,
} from 'date-fns';

/** Predefined date range option. */
interface Preset {
  label: string;
  from: Date;
  to: Date;
}

/** Props for the PeriodSelector component. */
interface PeriodSelectorProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
}

const presets: Preset[] = [
  {
    label: 'This Month',
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  },
  {
    label: 'Last Month',
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(subMonths(new Date(), 1)),
  },
  {
    label: 'Last 90 Days',
    from: subDays(new Date(), 90),
    to: new Date(),
  },
  {
    label: 'Year to Date',
    from: startOfYear(new Date()),
    to: new Date(),
  },
  {
    label: 'Last 12 Months',
    from: subMonths(new Date(), 12),
    to: new Date(),
  },
];

/** Date range selector with preset options and custom date inputs. */
export function PeriodSelector({
  from,
  to,
  onChange,
  className,
}: PeriodSelectorProps) {
  const [open, setOpen] = useState(false);

  const displayLabel = `${format(new Date(from + 'T00:00:00'), 'MMM d, yyyy')} — ${format(new Date(to + 'T00:00:00'), 'MMM d, yyyy')}`;

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <Calendar className="h-4 w-4 text-[var(--muted-foreground)]" />
        <span>{displayLabel}</span>
        <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg">
          {/* Presets */}
          <div className="space-y-1">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  onChange(
                    format(preset.from, 'yyyy-MM-dd'),
                    format(preset.to, 'yyyy-MM-dd'),
                  );
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--muted)] transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-[var(--border)]" />

          {/* Custom range — direct date inputs, changes fire immediately */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[var(--muted-foreground)]">
              Custom Range
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => onChange(e.target.value, to)}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => onChange(from, e.target.value)}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 8. React Query Hooks

### `apps/web/src/lib/hooks/useAnalytics.ts`

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type QueryParams } from '../api';

/** Shared analytics query parameters for date range and account filtering. */
export interface AnalyticsParams extends QueryParams {
  from?: string;
  to?: string;
  accountId?: string;
  household?: boolean;
}

/** Single monthly income vs expense row returned by the API. */
export interface IncomeExpenseRow {
  month: string;
  incomeCents: number;
  expenseCents: number;
}

/** Single category breakdown row. */
export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  totalCents: number;
  transactionCount: number;
  percentage: number;
}

/** Single spending trend data point. */
export interface SpendingTrendPoint {
  period: string;
  income: number;
  expenses: number;
}

/** Account balance row. */
export interface AccountBalanceItem {
  accountId: string;
  nickname: string;
  institution: string;
  accountType: string;
  balanceCents: number;
}

/** Credit utilization row. */
export interface CreditUtilizationItem {
  accountId: string;
  nickname: string;
  balanceCents: number;
  limitCents: number;
  utilizationPercent: number;
}

/** Net worth aggregation — keys are short (no "Cents" suffix) since values are in cents. */
export interface NetWorthData {
  assets: number;
  liabilities: number;
  investments: number;
  netWorth: number;
}

/** Top merchant row. */
export interface TopMerchantItem {
  merchantName: string;
  totalCents: number;
  transactionCount: number;
}

/** Fetch monthly income vs expenses for a date range. */
export function useIncomeVsExpenses(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'income-vs-expenses', params],
    queryFn: () =>
      api.get<{ data: IncomeExpenseRow[] }>('/analytics/income-vs-expenses', { params }),
  });
}

/** Fetch category-level spending breakdown. */
export function useCategoryBreakdown(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'category-breakdown', params],
    queryFn: () =>
      api.get<{ data: CategoryBreakdownItem[] }>('/analytics/category-breakdown', { params }),
  });
}

/** Fetch spending trend over time (daily/weekly/monthly). */
export function useSpendingTrend(
  params: AnalyticsParams & { granularity?: 'daily' | 'weekly' | 'monthly' } = {},
) {
  return useQuery({
    queryKey: ['analytics', 'spending-trend', params],
    queryFn: () =>
      api.get<{ data: SpendingTrendPoint[] }>('/analytics/spending-trend', { params }),
  });
}

/** Fetch current balances for all accounts. */
export function useAccountBalances(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'account-balances', params],
    queryFn: () =>
      api.get<{ data: AccountBalanceItem[] }>('/analytics/account-balances', { params }),
  });
}

/** Fetch credit utilization by card account. */
export function useCreditUtilization(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'credit-utilization', params],
    queryFn: () =>
      api.get<{ data: CreditUtilizationItem[] }>('/analytics/credit-utilization', { params }),
  });
}

/** Fetch net worth summary (assets - liabilities + investments). */
export function useNetWorth(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'net-worth', params],
    queryFn: () =>
      api.get<{ data: NetWorthData }>('/analytics/net-worth', { params }),
  });
}

/** Fetch top merchants by spend volume. */
export function useTopMerchants(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'top-merchants', params],
    queryFn: () =>
      api.get<{ data: TopMerchantItem[] }>('/analytics/top-merchants', { params }),
  });
}
```

### `apps/web/src/lib/hooks/useTransactions.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

interface TransactionQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  accountId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: string;
}

export function useTransactions(params: TransactionQueryParams) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () =>
      api.get<{
        data: any[];
        total: number;
        page: number;
        pageSize: number;
        hasMore: boolean;
      }>('/transactions', { params }),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: any }) =>
      api.patch(`/transactions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

export function useBulkCategorize() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { transactionIds: string[]; categoryId: string }) =>
      api.post('/transactions/bulk-categorize', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
```

### `apps/web/src/lib/hooks/useAccounts.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<{ data: any[] }>('/accounts'),
    select: (res) => res.data,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/accounts', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
```

### `apps/web/src/lib/hooks/useCategories.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ data: any[] }>('/categories'),
    select: (res) => res.data,
  });
}

export function useCategoryTree() {
  return useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => api.get<{ data: any[] }>('/categories/tree'),
    select: (res) => res.data,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/categories', body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; [key: string]: any }) =>
      api.patch(`/categories/${id}`, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });
}
```

### `apps/web/src/lib/hooks/useNotifications.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ data: any[] }>('/notifications'),
    select: (res) => res.data,
    refetchInterval: 30_000, // 30s polling
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () =>
      api.get<{ data: { count: number } }>('/notifications/unread-count'),
    select: (res) => res.data.count,
    refetchInterval: 30_000,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
```

---

## 9. Chart Components

### `apps/web/src/components/charts/IncomeExpenseBar.tsx`

```tsx
'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { formatCentsCompact } from '@/lib/format';

interface Props {
  data: { month: string; income_cents: number; expense_cents: number }[];
}

export function IncomeExpenseBar({ data }: Props) {
  const chartData = data.map((d) => ({
    month: d.month,
    Income: d.income_cents / 100,
    Expenses: d.expense_cents / 100,
  }));

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Income vs Expenses
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="month" className="text-xs" />
          <YAxis
            tickFormatter={(v) =>
              `$${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`
            }
            className="text-xs"
          />
          <Tooltip
            formatter={(value: number) => `$${value.toLocaleString()}`}
          />
          <Legend />
          <Bar
            dataKey="Income"
            fill="hsl(var(--chart-1))"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="Expenses"
            fill="hsl(var(--chart-2))"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### `apps/web/src/components/charts/CategoryDonut.tsx`

```tsx
'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatCents } from '@/lib/format';

interface CategoryData {
  category_name: string;
  total_cents: number;
  color: string;
}

interface Props {
  data: CategoryData[];
}

export function CategoryDonut({ data }: Props) {
  const total = data.reduce((sum, d) => sum + Number(d.total_cents), 0);
  const chartData = data.map((d) => ({
    name: d.category_name || 'Uncategorized',
    value: Number(d.total_cents) / 100,
    color: d.color || '#8884d8',
    percent:
      total > 0 ? ((Number(d.total_cents) / total) * 100).toFixed(1) : '0',
  }));

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Spending by Category
      </h3>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width="50%" height={250}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              label={false}
            >
              {chartData.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => `$${value.toLocaleString()}`}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-2">
          {chartData.slice(0, 8).map((d, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: d.color }}
              />
              <span className="flex-1 truncate">{d.name}</span>
              <span className="text-muted-foreground">{d.percent}%</span>
              <span className="font-medium">${d.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### `apps/web/src/components/charts/SpendingTrendLine.tsx`

```tsx
'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface Props {
  data: { period: string; total_cents: number }[];
}

export function SpendingTrendLine({ data }: Props) {
  const chartData = data.map((d) => ({
    period: d.period,
    amount: Number(d.total_cents) / 100,
  }));

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Spending Trend
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="period" className="text-xs" />
          <YAxis
            tickFormatter={(v) =>
              `$${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`
            }
            className="text-xs"
          />
          <Tooltip
            formatter={(value: number) => `$${value.toLocaleString()}`}
          />
          <Line
            type="monotone"
            dataKey="amount"
            stroke="hsl(var(--chart-3))"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### `apps/web/src/components/charts/AccountBalanceHistory.tsx`

```tsx
'use client';

import { ResponsiveContainer } from 'recharts';
import { formatCents } from '@/lib/format';

interface Balance {
  account_id: string;
  nickname: string;
  account_type: string;
  current_balance_cents: number;
}

interface Props {
  data: Balance[];
}

export function AccountBalanceHistory({ data }: Props) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Account Balances
      </h3>
      <div className="space-y-3">
        {data.map((account) => (
          <div
            key={account.account_id}
            className="flex items-center justify-between"
          >
            <div>
              <p className="text-sm font-medium">{account.nickname}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {account.account_type.replace('_', ' ')}
              </p>
            </div>
            <span
              className={`text-sm font-semibold ${
                Number(account.current_balance_cents) >= 0
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}
            >
              {formatCents(Number(account.current_balance_cents))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### `apps/web/src/components/charts/CreditUtilization.tsx`

```tsx
'use client';

import { formatCents } from '@/lib/format';

interface CreditData {
  account_id: string;
  nickname: string;
  credit_limit_cents: number;
  balance_cents: number;
}

interface Props {
  data: CreditData[];
}

export function CreditUtilization({ data }: Props) {
  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Credit Utilization
      </h3>
      <div className="space-y-4">
        {data.map((card) => {
          const balance = Math.abs(Number(card.balance_cents));
          const limit = Number(card.credit_limit_cents);
          const pct = limit > 0 ? (balance / limit) * 100 : 0;
          const color =
            pct > 80
              ? 'bg-red-500'
              : pct > 50
                ? 'bg-yellow-500'
                : 'bg-green-500';

          return (
            <div key={card.account_id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{card.nickname}</span>
                <span className="text-muted-foreground">
                  {formatCents(balance)} / {formatCents(limit)} (
                  {pct.toFixed(0)}%)
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full ${color}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
        {data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No credit cards configured
          </p>
        )}
      </div>
    </div>
  );
}
```

### `apps/web/src/components/charts/NetWorthCard.tsx`

```tsx
'use client';

import { formatCents } from '@/lib/format';
import { TrendingUp, TrendingDown, Wallet, CreditCard, LineChart } from 'lucide-react';

interface NetWorthCardProps {
  assets: number;
  liabilities: number;
  investments: number;
  netWorth: number;
}

export function NetWorthCard({
  assets,
  liabilities,
  investments,
  netWorth,
}: NetWorthCardProps) {
  const isPositive = netWorth >= 0;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">
        Net Worth
      </h3>
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold tracking-tight">
          {formatCents(Math.abs(netWorth))}
        </span>
        {isPositive ? (
          <TrendingUp className="h-5 w-5 text-emerald-500" />
        ) : (
          <TrendingDown className="h-5 w-5 text-red-500" />
        )}
      </div>
      {!isPositive && (
        <p className="mt-0.5 text-xs text-red-500">Negative net worth</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-4">
        {/* Assets */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <Wallet className="h-3.5 w-3.5" />
            Assets
          </div>
          <p className="text-sm font-semibold text-emerald-500 tabular-nums">
            {formatCents(assets)}
          </p>
        </div>

        {/* Liabilities */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <CreditCard className="h-3.5 w-3.5" />
            Liabilities
          </div>
          <p className="text-sm font-semibold text-red-500 tabular-nums">
            {formatCents(liabilities)}
          </p>
        </div>

        {/* Investments */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <LineChart className="h-3.5 w-3.5" />
            Investments
          </div>
          <p className="text-sm font-semibold text-[var(--primary)] tabular-nums">
            {formatCents(investments)}
          </p>
        </div>
      </div>
    </div>
  );
}
```

### `apps/web/src/components/charts/TopMerchantsBar.tsx`

```tsx
'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

/** Top merchant data row. */
interface TopMerchantData {
  merchantName: string;
  totalCents: number;
  transactionCount: number;
}

interface TopMerchantsBarProps {
  data: TopMerchantData[];
}

export function TopMerchantsBar({ data }: TopMerchantsBarProps) {
  const formatted = data.map((d) => ({
    merchant: d.merchantName || 'Unknown',
    total: d.totalCents / 100,
    count: d.transactionCount,
  }));

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
        Top Merchants
      </h3>
      {formatted.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No merchant data</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, formatted.length * 40)}>
          <BarChart data={formatted} layout="vertical" barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
            />
            <YAxis
              type="category"
              dataKey="merchant"
              width={130}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(v, _name, props) => [
                `$${Number(v ?? 0).toLocaleString()} (${(props as any)?.payload?.count ?? 0} txns)`,
                'Total',
              ]}
            />
            <Bar dataKey="total" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

---

## 10. Dashboard Page

### `apps/web/src/app/page.tsx` — REPLACE

```tsx
'use client';

import { useState } from 'react';
import { startOfMonth, subMonths, format } from 'date-fns';
import { PeriodSelector } from '@/components/PeriodSelector';
import { IncomeExpenseBar } from '@/components/charts/IncomeExpenseBar';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { SpendingTrendLine } from '@/components/charts/SpendingTrendLine';
import { AccountBalanceHistory } from '@/components/charts/AccountBalanceHistory';
import { CreditUtilization } from '@/components/charts/CreditUtilization';
import { NetWorthCard } from '@/components/charts/NetWorthCard';
import { TopMerchantsBar } from '@/components/charts/TopMerchantsBar';
import {
  useIncomeVsExpenses,
  useCategoryBreakdown,
  useSpendingTrend,
  useAccountBalances,
  useCreditUtilization,
  useNetWorth,
  useTopMerchants,
} from '@/lib/hooks/useAnalytics';

export default function DashboardPage() {
  const [range, setRange] = useState({
    from: format(startOfMonth(subMonths(new Date(), 5)), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  });

  const incomeExpense = useIncomeVsExpenses(range);
  const categories = useCategoryBreakdown(range);
  const trend = useSpendingTrend({ ...range, granularity: 'monthly' });
  const balances = useAccountBalances(range);
  const credit = useCreditUtilization();
  const netWorth = useNetWorth();
  const topMerchants = useTopMerchants({ ...range, limit: 10 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <PeriodSelector onChange={setRange} />
      </div>

      {/* Row 1: Net Worth + Credit Utilization */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {netWorth.data && <NetWorthCard data={netWorth.data} />}
        {credit.data && <CreditUtilization data={credit.data} />}
      </div>

      {/* Row 2: Income vs Expenses + Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {incomeExpense.data && <IncomeExpenseBar data={incomeExpense.data} />}
        {categories.data && <CategoryDonut data={categories.data} />}
      </div>

      {/* Row 3: Spending Trend + Top Merchants */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {trend.data && <SpendingTrendLine data={trend.data} />}
        {topMerchants.data && <TopMerchantsBar data={topMerchants.data} />}
      </div>

      {/* Row 4: Account Balances */}
      {balances.data && <AccountBalanceHistory data={balances.data} />}
    </div>
  );
}
```

---

## 11. Transaction Grid

### `apps/web/src/components/TransactionGrid.tsx`

```tsx
'use client';

import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table';
import { formatCents, formatDate } from '@/lib/format';
import { useCategories } from '@/lib/hooks/useCategories';
import {
  useUpdateTransaction,
  useBulkCategorize,
} from '@/lib/hooks/useTransactions';

interface Transaction {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  isCredit: boolean;
  categoryId: string | null;
  merchantName: string | null;
  accountId: string;
}

interface Props {
  data: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  accounts: { id: string; nickname: string }[];
}

export function TransactionGrid({
  data,
  total,
  page,
  pageSize,
  onPageChange,
  accounts,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const { data: categories } = useCategories();
  const updateTxn = useUpdateTransaction();
  const bulkCategorize = useBulkCategorize();

  const categoryMap = useMemo(
    () => new Map((categories || []).map((c: any) => [c.id, c])),
    [categories],
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.nickname])),
    [accounts],
  );

  const handleCategoryChange = (txnId: string, categoryId: string) => {
    updateTxn.mutate({ id: txnId, categoryId });
  };

  const handleBulkCategorize = () => {
    if (selectedIds.size > 0 && bulkCategoryId) {
      bulkCategorize.mutate({
        transactionIds: Array.from(selectedIds),
        categoryId: bulkCategoryId,
      });
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.map((d) => d.id)));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-muted rounded-md">
          <span className="text-sm">{selectedIds.size} selected</span>
          <select
            value={bulkCategoryId}
            onChange={(e) => setBulkCategoryId(e.target.value)}
            className="text-sm border border-border rounded px-2 py-1 bg-background"
          >
            <option value="">Assign category...</option>
            {(categories || []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleBulkCategorize}
            disabled={!bulkCategoryId}
            className="text-sm px-3 py-1 bg-primary text-primary-foreground rounded disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.size === data.length && data.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                Date
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                Description
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                Category
              </th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">
                Amount
              </th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">
                Account
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.map((txn) => (
              <tr key={txn.id} className="hover:bg-muted/50 transition-colors">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(txn.id)}
                    onChange={() => toggleSelect(txn.id)}
                  />
                </td>
                <td className="px-3 py-2 text-sm">{formatDate(txn.date)}</td>
                <td className="px-3 py-2 text-sm max-w-xs truncate">
                  {txn.description}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={txn.categoryId || ''}
                    onChange={(e) =>
                      handleCategoryChange(txn.id, e.target.value)
                    }
                    className="text-sm border border-border rounded px-2 py-0.5 bg-background max-w-[140px]"
                  >
                    <option value="">—</option>
                    {(categories || []).map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td
                  className={`px-3 py-2 text-sm text-right font-medium ${txn.isCredit ? 'text-green-600' : 'text-foreground'}`}
                >
                  {txn.isCredit ? '+' : '-'}
                  {formatCents(txn.amountCents)}
                </td>
                <td className="px-3 py-2 text-sm text-muted-foreground">
                  {accountMap.get(txn.accountId) || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-sm text-muted-foreground">
          {total} transactions — page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1 text-sm border border-border rounded disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm border border-border rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 12. Transaction Page

### `apps/web/src/app/transactions/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { TransactionGrid } from '@/components/TransactionGrid';
import { PeriodSelector } from '@/components/PeriodSelector';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useCategories } from '@/lib/hooks/useCategories';

export default function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [range, setRange] = useState<{ from?: string; to?: string }>({});

  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();

  const txnQuery = useTransactions({
    page,
    pageSize: 25,
    search: search || undefined,
    accountId: accountFilter || undefined,
    categoryId: categoryFilter || undefined,
    from: range.from,
    to: range.to,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transactions</h1>
        <PeriodSelector
          onChange={(r) => {
            setRange(r);
            setPage(1);
          }}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background w-64"
        />
        <select
          value={accountFilter}
          onChange={(e) => {
            setAccountFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        >
          <option value="">All Accounts</option>
          {(accounts || []).map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.nickname}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        >
          <option value="">All Categories</option>
          {(categories || []).map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {txnQuery.data && (
        <TransactionGrid
          data={txnQuery.data.data}
          total={txnQuery.data.total}
          page={txnQuery.data.page}
          pageSize={txnQuery.data.pageSize}
          onPageChange={setPage}
          accounts={accounts || []}
        />
      )}
    </div>
  );
}
```

---

## 13. Upload Page

### `apps/web/src/components/FileUpload.tsx`

```tsx
'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  accountId: string;
  onComplete: () => void;
}

export function FileUpload({ accountId, onComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<
    'idle' | 'uploading' | 'processing' | 'done' | 'error'
  >('idle');
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setStatus('uploading');
      setMessage(`Uploading ${file.name}...`);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('accountId', accountId);

        const result = await api.upload<{
          data: { id: string; status: string };
        }>('/uploads', formData);
        const uploadId = result.data.id;

        // Poll for completion
        setStatus('processing');
        setMessage('Processing...');

        let attempts = 0;
        const poll = async () => {
          if (attempts++ > 60) {
            setStatus('error');
            setMessage('Processing timed out');
            return;
          }

          const statusRes = await api.get<{ data: any }>(
            `/uploads/${uploadId}`,
          );
          const upload = statusRes.data;

          if (upload.status === 'completed') {
            setStatus('done');
            setMessage(
              `Done! ${upload.rowsImported} imported, ${upload.rowsSkipped} skipped, ${upload.rowsErrored || 0} errors`,
            );
            onComplete();
          } else if (upload.status === 'failed') {
            setStatus('error');
            setMessage(upload.errorLog?.[0]?.error || 'Processing failed');
          } else {
            setTimeout(poll, 2000);
          }
        };
        poll();
      } catch (err: any) {
        setStatus('error');
        setMessage(err.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [accountId, onComplete],
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-border hover:border-primary/50'
        }`}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm font-medium">
          Drop a file here or click to browse
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          CSV, Excel (.xlsx), or PDF — max 50MB
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      {/* Status indicator */}
      {status !== 'idle' && (
        <div
          className={`mt-3 flex items-center gap-2 text-sm ${
            status === 'done'
              ? 'text-green-600'
              : status === 'error'
                ? 'text-red-600'
                : 'text-muted-foreground'
          }`}
        >
          {status === 'uploading' || status === 'processing' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : status === 'done' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
```

### `apps/web/src/app/upload/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useQueryClient } from '@tanstack/react-query';

export default function UploadPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const queryClient = useQueryClient();

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Upload Statement</h1>

      <div>
        <label className="block text-sm font-medium mb-2">Select Account</label>
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-md bg-background"
        >
          <option value="">Choose an account...</option>
          {(accounts || []).map((a: any) => (
            <option key={a.id} value={a.id}>
              {a.nickname} ({a.institution})
            </option>
          ))}
        </select>
      </div>

      {selectedAccountId && (
        <FileUpload
          accountId={selectedAccountId}
          onComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['analytics'] });
          }}
        />
      )}
    </div>
  );
}
```

---

## 14. Update app.module.ts

Add `AnalyticsModule` and `CategoriesModule` to imports:

```typescript
// In apps/api/src/app.module.ts — add these imports:
import { AnalyticsModule } from './analytics/analytics.module';
import { CategoriesModule } from './categories/categories.module';

// Add to imports array:
// AnalyticsModule,
// CategoriesModule,
```

---

## Implementation Order

```
Step 1:  Install frontend dependencies (recharts, tanstack, lucide-react, date-fns, clsx, next-themes)
Step 2:  Create api client (lib/api.ts) + format utilities (lib/format.ts)
Step 3:  Create analytics service + controller + module (backend)
Step 4:  Create categories service + controller + module (backend)
Step 5:  Create export service (backend)
Step 6:  Update app.module.ts — import AnalyticsModule, CategoriesModule
Step 7:  Create React Query hooks (useAnalytics, useTransactions, useAccounts, useCategories, useNotifications)
Step 8:  Create Sidebar + AppShell layout components
Step 9:  Update root layout.tsx — wrap with AppShell
Step 10: Create PeriodSelector component
Step 11: Create 7 chart components
Step 12: Create dashboard page (page.tsx)
Step 13: Create TransactionGrid component
Step 14: Create transactions page
Step 15: Create FileUpload component + upload page
Step 16: Create accounts page (basic CRUD UI)
Step 17: Create categories page (tree view)
Step 18: Create settings page (basic)
Step 19: Build + verify frontend compiles
Step 20: Verify analytics endpoints return correct data
Step 21: E2E test: dashboard renders charts with data
Step 22: Git commit
```

---

## API Endpoints Summary (New)

| Method   | Path                                | Auth | Description                         |
| -------- | ----------------------------------- | ---- | ----------------------------------- |
| `GET`    | `/api/analytics/income-vs-expenses` | JWT  | Monthly income/expense totals       |
| `GET`    | `/api/analytics/category-breakdown` | JWT  | Category spend totals + percentages |
| `GET`    | `/api/analytics/spending-trend`     | JWT  | Time-series spending                |
| `GET`    | `/api/analytics/account-balances`   | JWT  | Per-account balances                |
| `GET`    | `/api/analytics/credit-utilization` | JWT  | CC utilization rates                |
| `GET`    | `/api/analytics/net-worth`          | JWT  | Net worth snapshot                  |
| `GET`    | `/api/analytics/top-merchants`      | JWT  | Top merchants by spend              |
| `GET`    | `/api/categories`                   | JWT  | List categories (flat)              |
| `GET`    | `/api/categories/tree`              | JWT  | Category tree (recursive CTE)       |
| `POST`   | `/api/categories`                   | JWT  | Create category                     |
| `PATCH`  | `/api/categories/:id`               | JWT  | Update category                     |
| `DELETE` | `/api/categories/:id`               | JWT  | Soft delete + descendants           |
| `POST`   | `/api/categories/reorder`           | JWT  | Reorder categories                  |

---

## Implementation Status ✅

**All spec items implemented. Deviations documented below.**

### Deviations from Spec

| Spec Item | Implementation | Reason |
|-----------|---------------|--------|
| TanStack Table for transactions | HTML `<table>` with inline `<select>` | Simpler, no extra dependency needed for current features |
| TransactionGrid as standalone component | Inline in `transactions/page.tsx` | Single consumer, no reuse case yet |
| FileUpload as standalone component | Inline in `upload/page.tsx` | Same reasoning |
| NotificationBell as separate component | Integrated into `TopBar.tsx` | Bell icon + unread badge + `useUnreadCount()` hook in TopBar directly |
| Layout components in `components/layout/` | Root `components/` directory | Flatter structure for small component count |
| Redis caching (5min TTL) for analytics | No caching — direct DB queries | Deferred; unnecessary at current data scale |
| Split transaction UI | Not implemented | Deferred to Phase 6 |
| Class-based `api.ts` | Function-based `api.ts` with `apiFetch()` | Simpler for current needs |
| `api.ts` class interceptors | `apiFetch()` wraps native `fetch` + handles 401 redirect | Same behavior, less abstraction |

### Test Coverage

- **Backend**: 112 tests (18 analytics, 5 export, 6 rule-engine, 5 learning, 6 categories, 6 auth, 5 users, 5 generic-csv, 4 boa-parser, 5 chase-checking, 4 chase-cc, 5 citi-parser, 5 amex-parser, 9 pdf-proxy, 5 dedup, 14 other)
- **Frontend**: 11 unit tests (format utilities)
- **E2E**: 10 analytics endpoint tests
- **All builds pass**: `nest build` + `next build`

---

## Phase 5.5: Dashboard Drill-Down & UX Polish

**Added after Phase 5 completion to enhance the dashboard experience.**

### Features Added

#### Dashboard → Transactions Drill-Down
Every dashboard KPI card and chart now navigates to the transactions page with pre-filled URL filters:

| Dashboard Element | Drill-Down Action | Filter Applied |
|---|---|---|
| **Total Income** card | Click → Transactions | `isCredit=true` |
| **Total Expenses** card | Click → Transactions | `isCredit=false` |
| **Net Cash Flow** card | Click → Transactions | Date range only |
| **Category Donut** (slice or legend) | Click → Transactions | `categoryId=<id>` |
| **Top Merchants Bar** | Click bar → Transactions | `search=<merchantName>` |
| **Income vs Expenses Bar** | Click month → Transactions | `from=<monthStart>&to=<monthEnd>` |
| **Net Worth Drilldown** | Click "View transactions" per account | `accountId=<id>` |

#### URL-Driven Transactions Filters
- Transactions page reads `accountId`, `categoryId`, `from`, `to`, `isCredit`, `search`, `drill` from URL search params
- Displays a context banner ("Showing: {drill label}") with a one-click "Clear filters" button
- `isCredit` boolean filter added to shared `transactionQuerySchema` (Zod) and API `transactions.service.ts`

#### Clickable Chart Components
- **StatCard**: accepts `onClick` prop, renders as `<button>` when clickable, shows `ChevronRight` icon on hover
- **CategoryDonut**: `onCategoryClick` callback for both Pie slices and legend items
- **TopMerchantsBar**: `onMerchantClick` callback on bar click
- **IncomeExpenseBar**: `onBarClick` callback passing the clicked month period
- **NetWorthDrilldown**: "View transactions" link per account row with ExternalLink icon

#### Additional UX Fixes (from prior PR)
- Duplicate category prevention with unique DB index
- Credit Card Payment category + seed rules
- Account column displays institution + lastFour
- Imports status page (summary cards + detail table)
- Credit/debit sign convention fix for CC payments

### Files Modified

| File | Changes |
|---|---|
| `apps/web/src/app/(protected)/page.tsx` | `drillTo()` callback, wired all chart onClick handlers |
| `apps/web/src/app/(protected)/transactions/page.tsx` | URL search params init, drill-down banner, clear filters |
| `apps/web/src/components/charts/StatCard.tsx` | `onClick` prop, button wrapper, ChevronRight hover icon |
| `apps/web/src/components/charts/CategoryDonut.tsx` | `onCategoryClick` prop for slices and legend |
| `apps/web/src/components/charts/TopMerchantsBar.tsx` | `onMerchantClick` prop on bar click |
| `apps/web/src/components/charts/IncomeExpenseBar.tsx` | `onBarClick` prop for month drill-down |
| `apps/web/src/components/NetWorthDrilldown.tsx` | `from`/`to` props, "View transactions" links |
| `packages/shared/src/validation/index.ts` | `isCredit: z.coerce.boolean().optional()` in transactionQuerySchema |
| `apps/api/src/transactions/transactions.service.ts` | `isCredit` filter condition in `findAll` |

### Ingestion & Import Fixes

#### CSV Preamble Stripping
Real BofA checking downloads include summary rows (Beginning balance, Total credits, Total debits, Ending balance) before the actual CSV headers. Added `stripCsvPreamble()` in `ingestion.processor.ts` that scans for the real header row (containing "Date" + known column names like "Description", "Amount") and discards everything above it.

#### Failed Upload Re-upload
File-level dedup (SHA-256 hash) previously blocked re-uploading the same file even when the previous attempt failed. Now both the upload endpoint and watch-folder watcher auto-delete failed upload records when the same hash is encountered, allowing seamless retries.

#### Transaction-Level Dedup (Already Existed)
The `DedupService` handles transaction-level dedup using two strategies:
1. **External ID match** — bank reference numbers checked via `(account_id, external_id)`
2. **Hash match** — `SHA256(accountId + date + amount + description + isCredit)` checked via `(account_id, txn_hash)`

This means re-uploading a partially-imported file safely skips already-imported transactions and only adds new ones.

#### Delete Upload API + UI
- `DELETE /uploads/:id` — deletes upload record + associated transactions (only for completed/failed uploads)
- Imports page: trash icon per row with confirmation dialog
- Error details modal: click failed status badge or error count to view `errorLog` entries (row number, error message, raw line)

### Additional Files Modified

| File | Changes |
|---|---|
| `apps/api/src/jobs/ingestion.processor.ts` | `stripCsvPreamble()` method, `relax_quotes: true` |
| `apps/api/src/ingestion/ingestion.service.ts` | Failed-upload hash bypass, `deleteUpload()` method |
| `apps/api/src/ingestion/ingestion.controller.ts` | `DELETE /uploads/:id` endpoint |
| `apps/api/src/ingestion/watcher.service.ts` | Failed-upload hash bypass for watch folder |
| `apps/web/src/lib/hooks/useUpload.ts` | `useDeleteUpload()` mutation hook |
| `apps/web/src/app/(protected)/imports/page.tsx` | Delete button, error details modal, clickable status/error cells |
