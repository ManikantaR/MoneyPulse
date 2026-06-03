import { Injectable, Logger, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';

export interface BalanceHistoryPoint {
  date: string;
  balanceCents: number;
}

@Injectable()
export class BalanceSnapshotService {
  private readonly logger = new Logger(BalanceSnapshotService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Compute and upsert today's balance for all non-deleted accounts of a given user.
   * Called best-effort after a successful import (non-blocking).
   */
  async snapshotForUser(userId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO account_balance_snapshots (account_id, balance_cents, snapshot_date)
      SELECT
        a.id,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0),
        CURRENT_DATE
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
      WHERE a.deleted_at IS NULL
        AND a.user_id = ${userId}
      GROUP BY a.id, a.starting_balance_cents
      ON CONFLICT (account_id, snapshot_date)
        DO UPDATE SET balance_cents = EXCLUDED.balance_cents
    `);
    this.logger.debug(`Snapshotted balances for user ${userId}`);
  }

  /**
   * Compute and upsert today's balance for all non-deleted accounts across all users.
   * Called by the daily scheduled job at ~01:00 UTC.
   */
  async snapshotAll(): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO account_balance_snapshots (account_id, balance_cents, snapshot_date)
      SELECT
        a.id,
        a.starting_balance_cents + COALESCE(SUM(
          CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
        ), 0),
        CURRENT_DATE
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
      WHERE a.deleted_at IS NULL
      GROUP BY a.id, a.starting_balance_cents
      ON CONFLICT (account_id, snapshot_date)
        DO UPDATE SET balance_cents = EXCLUDED.balance_cents
    `);
    this.logger.log('Daily balance snapshot complete (all accounts)');
  }

  /**
   * Backfill month-end snapshots for a single account using its full transaction history.
   * Idempotent — uses ON CONFLICT DO UPDATE, safe to run multiple times.
   */
  async backfill(accountId: string): Promise<void> {
    await this.db.execute(sql`
      WITH month_ends AS (
        SELECT (
          generate_series(
            date_trunc('month', MIN(t.date))::date,
            date_trunc('month', CURRENT_DATE)::date,
            '1 month'::interval
          ) + INTERVAL '1 month - 1 day'
        )::date AS snapshot_date
        FROM transactions t
        WHERE t.account_id = ${accountId} AND t.deleted_at IS NULL
      ),
      balances AS (
        SELECT
          me.snapshot_date,
          a.starting_balance_cents + COALESCE(SUM(
            CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
          ), 0) AS balance_cents
        FROM month_ends me
        CROSS JOIN accounts a
        LEFT JOIN transactions t
          ON t.account_id = a.id
          AND t.is_split_parent = false
          AND t.deleted_at IS NULL
          -- Use strict less-than + 1 day to include transactions on the snapshot date
          AND t.date < me.snapshot_date::date + INTERVAL '1 day'
        WHERE a.id = ${accountId}
        GROUP BY me.snapshot_date, a.starting_balance_cents
      )
      INSERT INTO account_balance_snapshots (account_id, balance_cents, snapshot_date)
      SELECT ${accountId}, balance_cents, snapshot_date FROM balances
      ON CONFLICT (account_id, snapshot_date)
        DO UPDATE SET balance_cents = EXCLUDED.balance_cents
    `);
    this.logger.log(`Backfill complete for account ${accountId}`);
  }

  /**
   * Return a time series of balance snapshots for a user.
   * If accountId is given, returns per-account points; otherwise sums all accounts (net-worth trend).
   */
  async history(
    userId: string,
    params: { accountId?: string; from?: string; to?: string },
  ): Promise<BalanceHistoryPoint[]> {
    const rows = await this.db.execute(sql`
      SELECT
        abs.snapshot_date::text AS snapshot_date,
        SUM(abs.balance_cents) AS total_cents
      FROM account_balance_snapshots abs
      JOIN accounts a ON abs.account_id = a.id
      WHERE a.user_id = ${userId}
        AND a.deleted_at IS NULL
        ${params.accountId ? sql`AND abs.account_id = ${params.accountId}` : sql``}
        ${params.from ? sql`AND abs.snapshot_date >= ${params.from}::date` : sql``}
        ${params.to ? sql`AND abs.snapshot_date <= ${params.to}::date` : sql``}
      GROUP BY abs.snapshot_date
      ORDER BY abs.snapshot_date ASC
    `);
    return (rows.rows ?? []).map((r: { snapshot_date: string; total_cents: string }) => ({
      date: r.snapshot_date,
      balanceCents: Number(r.total_cents),
    }));
  }
}
