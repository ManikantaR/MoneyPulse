import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';
import { NotificationsService } from './notifications.service';

interface BudgetAlert {
  budgetId: string;
  userId: string;
  categoryName: string;
  amountCents: number;
  spentCents: number;
  percentage: number;
  period: string;
  type: 'warning' | 'over_budget';
}

interface SavingsMilestone {
  goalId: string;
  userId: string;
  goalName: string;
  targetAmountCents: number;
  currentAmountCents: number;
  milestone: number;
}

@Injectable()
export class AlertEngineService {
  private readonly WARNING_THRESHOLD = 0.8;
  private readonly OVER_THRESHOLD = 1.0;
  private readonly MILESTONES = [25, 50, 75, 100];

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  async checkBudgets(userIds?: string[]): Promise<BudgetAlert[]> {
    const rows = await this.db.execute(sql`
      SELECT
        b.id AS budget_id,
        b.user_id,
        b.amount_cents,
        b.period,
        c.name AS category_name,
        COALESCE(spent.total, 0) AS spent_cents
      FROM ${schema.budgets} b
      LEFT JOIN ${schema.categories} c ON b.category_id = c.id
      LEFT JOIN LATERAL (
        SELECT SUM(t.amount_cents) AS total
        FROM ${schema.transactions} t
        WHERE t.category_id = b.category_id
          AND t.is_credit = false
          AND t.is_split_parent = false
          AND t.deleted_at IS NULL
          AND t.date >= CASE
            WHEN b.period = 'monthly' THEN date_trunc('month', CURRENT_DATE)
            WHEN b.period = 'weekly' THEN date_trunc('week', CURRENT_DATE)
            ELSE date_trunc('month', CURRENT_DATE)
          END
          AND (
            t.user_id = b.user_id
            OR (b.household_id IS NOT NULL AND t.user_id IN (
              SELECT u.id FROM users u WHERE u.household_id = b.household_id
            ))
          )
      ) spent ON true
      WHERE b.deleted_at IS NULL
        ${userIds?.length ? sql`AND b.user_id = ANY(${userIds})` : sql``}
    `);

    const alerts: BudgetAlert[] = [];
    for (const row of rows.rows ?? rows) {
      const spent = Number(row.spent_cents);
      const budget = Number(row.amount_cents);
      const pct = budget > 0 ? spent / budget : 0;

      if (pct >= this.OVER_THRESHOLD) {
        alerts.push({
          budgetId: row.budget_id,
          userId: row.user_id,
          categoryName: row.category_name,
          amountCents: budget,
          spentCents: spent,
          percentage: pct,
          period: row.period ?? 'monthly',
          type: 'over_budget',
        });
      } else if (pct >= this.WARNING_THRESHOLD) {
        alerts.push({
          budgetId: row.budget_id,
          userId: row.user_id,
          categoryName: row.category_name,
          amountCents: budget,
          spentCents: spent,
          percentage: pct,
          period: row.period ?? 'monthly',
          type: 'warning',
        });
      }
    }

    for (const alert of alerts) {
      const title =
        alert.type === 'over_budget'
          ? `Over budget: ${alert.categoryName}`
          : `Budget warning: ${alert.categoryName}`;
      const message = `${alert.categoryName}: $${(alert.spentCents / 100).toFixed(2)} of $${(alert.amountCents / 100).toFixed(2)} (${(alert.percentage * 100).toFixed(0)}%)`;

      // Dedupe key scoped to budget + period start so we don't spam per-period
      const periodStart = new Date();
      let periodKey: string;
      if (alert.period === 'weekly') {
        // Scope to ISO week: subtract days to Monday, use ISO week number
        const day = periodStart.getDay();
        const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
        periodStart.setDate(periodStart.getDate() - diff);
        periodKey = periodStart.toISOString().slice(0, 10); // YYYY-MM-DD of week start
      } else {
        periodStart.setDate(1); // monthly boundary
        periodKey = periodStart.toISOString().slice(0, 7); // YYYY-MM
      }
      const dedupeKey = `budget_alert_${alert.budgetId}_${alert.type}_${periodKey}`;

      const alreadySent = await this.notificationsService.findByMetadata(
        alert.userId,
        dedupeKey,
      );
      if (alreadySent) continue;

      await this.notificationsService.createAndDispatch({
        userId: alert.userId,
        type: 'budget_alert',
        title,
        message,
        dedupeKey,
        metadata: {
          event: alert.type,
          category: alert.categoryName,
          spent: alert.spentCents,
          budget: alert.amountCents,
          percentage: alert.percentage,
        },
      });
    }

    return alerts;
  }

  async checkSavingsMilestones(userId: string): Promise<SavingsMilestone[]> {
    const goals = await this.db
      .select()
      .from(schema.savingsGoals)
      .where(
        sql`${schema.savingsGoals.userId} = ${userId} AND ${schema.savingsGoals.deletedAt} IS NULL`,
      );

    const milestones: SavingsMilestone[] = [];
    for (const goal of goals) {
      const current = Number(goal.currentAmountCents);
      const target = Number(goal.targetAmountCents);
      if (target <= 0) continue;

      const pct = (current / target) * 100;

      for (const milestone of this.MILESTONES) {
        if (pct >= milestone) {
          const existing = await this.notificationsService.findByMetadata(
            userId,
            `savings_milestone_${goal.id}_${milestone}`,
          );
          if (!existing) {
            milestones.push({
              goalId: goal.id,
              userId,
              goalName: goal.name,
              targetAmountCents: target,
              currentAmountCents: current,
              milestone,
            });

            await this.notificationsService.createAndDispatch({
              userId,
              type: 'savings_milestone',
              title: `Savings milestone: ${goal.name}`,
              message: `${goal.name}: ${milestone}% reached! $${(current / 100).toFixed(2)} of $${(target / 100).toFixed(2)}`,
              dedupeKey: `savings_milestone_${goal.id}_${milestone}`,
              metadata: {
                event: 'savings_milestone',
                goalName: goal.name,
                milestone,
                current,
                target,
              },
            });
          }
        }
      }
    }

    return milestones;
  }
}
