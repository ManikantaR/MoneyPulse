import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import type {
  CreateBudgetInput,
  UpdateBudgetInput,
  CreateSavingsGoalInput,
  UpdateSavingsGoalInput,
} from '@moneypulse/shared';

@Injectable()
export class BudgetsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  // ── Budgets ──────────────────────────────────────────────

  async findBudgets(userId: string, householdId?: string) {
    const conditions = [isNull(schema.budgets.deletedAt)];

    if (householdId) {
      conditions.push(
        sql`(${schema.budgets.userId} = ${userId} OR ${schema.budgets.householdId} = ${householdId})`,
      );
    } else {
      conditions.push(eq(schema.budgets.userId, userId));
    }

    const budgets = await this.db
      .select({
        budget: schema.budgets,
        categoryName: schema.categories.name,
        categoryIcon: schema.categories.icon,
        categoryColor: schema.categories.color,
      })
      .from(schema.budgets)
      .leftJoin(
        schema.categories,
        eq(schema.budgets.categoryId, schema.categories.id),
      )
      .where(and(...conditions));

    return budgets;
  }

  async findBudgetsWithSpend(userId: string, householdId?: string) {
    const rows = await this.db.execute(sql`
      SELECT
        b.id,
        b.user_id,
        b.household_id,
        b.category_id,
        b.amount_cents,
        b.period,
        c.name AS category_name,
        c.icon AS category_icon,
        c.color AS category_color,
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
        AND (
          b.user_id = ${userId}
          ${householdId ? sql`OR b.household_id = ${householdId}` : sql``}
        )
      ORDER BY c.name
    `);
    return rows.rows ?? rows;
  }

  async createBudget(
    userId: string,
    input: CreateBudgetInput,
    userHouseholdId?: string,
  ) {
    // If householdId is specified, verify user belongs to that household
    if (input.householdId && input.householdId !== userHouseholdId) {
      throw new NotFoundException(
        'Cannot create budget for a household you do not belong to',
      );
    }

    const rows = await this.db
      .insert(schema.budgets)
      .values({
        userId,
        categoryId: input.categoryId,
        amountCents: input.amountCents,
        period: input.period,
        householdId: input.householdId ?? null,
      })
      .returning();
    return rows[0];
  }

  async updateBudget(id: string, userId: string, input: UpdateBudgetInput) {
    const existing = await this.db
      .select()
      .from(schema.budgets)
      .where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId)))
      .limit(1);
    if (!existing[0]) throw new NotFoundException('Budget not found');

    const rows = await this.db
      .update(schema.budgets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.budgets.id, id))
      .returning();
    return rows[0];
  }

  async deleteBudget(id: string, userId: string) {
    const existing = await this.db
      .select()
      .from(schema.budgets)
      .where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId)))
      .limit(1);
    if (!existing[0]) throw new NotFoundException('Budget not found');

    await this.db
      .update(schema.budgets)
      .set({ deletedAt: new Date() })
      .where(eq(schema.budgets.id, id));
  }

  // ── Savings Goals ────────────────────────────────────────

  async findSavingsGoals(userId: string) {
    return this.db
      .select()
      .from(schema.savingsGoals)
      .where(
        and(
          eq(schema.savingsGoals.userId, userId),
          isNull(schema.savingsGoals.deletedAt),
        ),
      );
  }

  async createSavingsGoal(userId: string, input: CreateSavingsGoalInput) {
    const rows = await this.db
      .insert(schema.savingsGoals)
      .values({
        userId,
        name: input.name,
        targetAmountCents: input.targetAmountCents,
        currentAmountCents: 0,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
      })
      .returning();
    return rows[0];
  }

  async updateSavingsGoal(
    id: string,
    userId: string,
    input: UpdateSavingsGoalInput,
  ) {
    const existing = await this.db
      .select()
      .from(schema.savingsGoals)
      .where(
        and(
          eq(schema.savingsGoals.id, id),
          eq(schema.savingsGoals.userId, userId),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new NotFoundException('Savings goal not found');

    const rows = await this.db
      .update(schema.savingsGoals)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.savingsGoals.id, id))
      .returning();
    return rows[0];
  }

  async contributeSavingsGoal(
    id: string,
    userId: string,
    amountCents: number,
  ) {
    // Use atomic SQL increment to avoid read-then-update race condition
    const rows = await this.db
      .update(schema.savingsGoals)
      .set({
        currentAmountCents: sql`${schema.savingsGoals.currentAmountCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.savingsGoals.id, id),
          eq(schema.savingsGoals.userId, userId),
          isNull(schema.savingsGoals.deletedAt),
        ),
      )
      .returning();
    if (!rows[0]) throw new NotFoundException('Savings goal not found');
    return rows[0];
  }

  async deleteSavingsGoal(id: string, userId: string) {
    const existing = await this.db
      .select()
      .from(schema.savingsGoals)
      .where(
        and(
          eq(schema.savingsGoals.id, id),
          eq(schema.savingsGoals.userId, userId),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new NotFoundException('Savings goal not found');

    await this.db
      .update(schema.savingsGoals)
      .set({ deletedAt: new Date() })
      .where(eq(schema.savingsGoals.id, id));
  }
}
