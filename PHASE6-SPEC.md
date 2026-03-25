# Phase 6: Budgets, Alerts & Notifications — Implementation Spec

**Dependencies**: Phase 5 (analytics service, categories)

## Decisions Summary

| #   | Decision              | Choice                                                                         |
| --- | --------------------- | ------------------------------------------------------------------------------ |
| 1   | Alert timing          | Immediate on import + daily cron sweep                                         |
| 2   | Notification channels | Home Assistant webhook + in-app (polling) first; email (nodemailer) documented |
| 3   | Balance reminders     | Monthly for investments, weekly for bank accounts                              |
| 4   | Budget scope          | Personal (userId) + shared (householdId)                                       |
| 5   | Alert thresholds      | 80% warning, 100% over-budget                                                  |
| 6   | Savings milestones    | 25%, 50%, 75%, 100%                                                            |

---

## File Inventory

### Backend — Budgets Module

| #   | File                                      | Purpose                     |
| --- | ----------------------------------------- | --------------------------- |
| 1   | `src/budgets/budgets.module.ts`           | Module wiring               |
| 2   | `src/budgets/budgets.service.ts`          | Budget + savings goal CRUD  |
| 3   | `src/budgets/budgets.controller.ts`       | Budget REST endpoints       |
| 4   | `src/budgets/savings-goals.controller.ts` | Savings goal REST endpoints |

### Backend — Alerts & Notifications

| #   | File                                            | Purpose                                      |
| --- | ----------------------------------------------- | -------------------------------------------- |
| 5   | `src/notifications/notifications.module.ts`     | Module wiring                                |
| 6   | `src/notifications/notifications.service.ts`    | Notification CRUD + webhook dispatch         |
| 7   | `src/notifications/notifications.controller.ts` | Notification REST endpoints                  |
| 8   | `src/notifications/alert-engine.service.ts`     | Budget threshold + savings milestone checks  |
| 9   | `src/notifications/webhook.service.ts`          | Home Assistant webhook client                |
| 10  | `src/notifications/email.service.ts`            | Nodemailer email sender (documented, opt-in) |

### Backend — Jobs

| #   | File                               | Purpose                                        |
| --- | ---------------------------------- | ---------------------------------------------- |
| 11  | `src/jobs/alert-cron.processor.ts` | BullMQ cron job — daily budget sweep           |
| 12  | `src/jobs/reminder.processor.ts`   | BullMQ cron — weekly/monthly balance reminders |

### Frontend — Budget Pages

| #   | File                                 | Purpose                             |
| --- | ------------------------------------ | ----------------------------------- |
| 13  | `src/app/budgets/page.tsx`           | Budget management dashboard         |
| 14  | `src/components/BudgetCard.tsx`      | Budget progress bar card            |
| 15  | `src/components/SavingsGoalCard.tsx` | Savings goal progress card          |
| 16  | `src/lib/hooks/useBudgets.ts`        | React Query hooks for budgets/goals |

### Frontend — Notification Bell

| #   | File                                  | Purpose                      |
| --- | ------------------------------------- | ---------------------------- |
| 17  | `src/components/NotificationBell.tsx` | Unread count + dropdown list |

### Tests

| #   | File                                                                | Purpose                 |
| --- | ------------------------------------------------------------------- | ----------------------- |
| 18  | `apps/api/src/budgets/__tests__/budgets.service.spec.ts`            | Budget CRUD tests       |
| 19  | `apps/api/src/notifications/__tests__/alert-engine.service.spec.ts` | Alert threshold tests   |
| 20  | `apps/api/test/budgets.e2e-spec.ts`                                 | E2E budget + alert flow |

---

## New Dependencies

```bash
# apps/api
cd apps/api && pnpm add nodemailer
cd apps/api && pnpm add -D @types/nodemailer
```

---

## 1. Budget Service

### `apps/api/src/budgets/budgets.service.ts`

```typescript
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
      // Show personal + household budgets
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

  /**
   * Get budgets with current spend for a given period.
   */
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

  async createBudget(userId: string, input: CreateBudgetInput) {
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

  /**
   * Add funds to a savings goal. Returns new balance.
   */
  async contributeSavingsGoal(id: string, userId: string, amountCents: number) {
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

    const newAmount = existing[0].currentAmountCents + amountCents;
    const rows = await this.db
      .update(schema.savingsGoals)
      .set({ currentAmountCents: newAmount, updatedAt: new Date() })
      .where(eq(schema.savingsGoals.id, id))
      .returning();
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
```

### `apps/api/src/budgets/budgets.controller.ts`

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
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBudgetSchema, updateBudgetSchema } from '@moneypulse/shared';
import type { CreateBudgetInput, UpdateBudgetInput } from '@moneypulse/shared';

@ApiTags('Budgets')
@Controller('budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'List budgets with current spend' })
  async findAll(@Req() req: any) {
    const data = await this.budgetsService.findBudgetsWithSpend(
      req.user.id,
      req.user.householdId,
    );
    return { data };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create budget' })
  async create(
    @Req() req: any,
    @Body(new ZodValidationPipe(createBudgetSchema)) body: CreateBudgetInput,
  ) {
    const budget = await this.budgetsService.createBudget(req.user.id, body);
    return { data: budget };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update budget' })
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBudgetSchema)) body: UpdateBudgetInput,
  ) {
    const budget = await this.budgetsService.updateBudget(
      id,
      req.user.id,
      body,
    );
    return { data: budget };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete budget' })
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.budgetsService.deleteBudget(id, req.user.id);
    return { data: { deleted: true } };
  }
}
```

### `apps/api/src/budgets/savings-goals.controller.ts`

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
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createSavingsGoalSchema,
  updateSavingsGoalSchema,
} from '@moneypulse/shared';
import type {
  CreateSavingsGoalInput,
  UpdateSavingsGoalInput,
} from '@moneypulse/shared';

@ApiTags('Savings Goals')
@Controller('savings-goals')
@UseGuards(JwtAuthGuard)
export class SavingsGoalsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'List savings goals' })
  async findAll(@Req() req: any) {
    const data = await this.budgetsService.findSavingsGoals(req.user.id);
    return { data };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create savings goal' })
  async create(
    @Req() req: any,
    @Body(new ZodValidationPipe(createSavingsGoalSchema))
    body: CreateSavingsGoalInput,
  ) {
    const goal = await this.budgetsService.createSavingsGoal(req.user.id, body);
    return { data: goal };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update savings goal' })
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSavingsGoalSchema))
    body: UpdateSavingsGoalInput,
  ) {
    const goal = await this.budgetsService.updateSavingsGoal(
      id,
      req.user.id,
      body,
    );
    return { data: goal };
  }

  @Post(':id/contribute')
  @ApiOperation({ summary: 'Add funds to a savings goal' })
  async contribute(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { amountCents: number },
  ) {
    const goal = await this.budgetsService.contributeSavingsGoal(
      id,
      req.user.id,
      body.amountCents,
    );
    return { data: goal };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete savings goal' })
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.budgetsService.deleteSavingsGoal(id, req.user.id);
    return { data: { deleted: true } };
  }
}
```

### `apps/api/src/budgets/budgets.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { SavingsGoalsController } from './savings-goals.controller';

@Module({
  providers: [BudgetsService],
  controllers: [BudgetsController, SavingsGoalsController],
  exports: [BudgetsService],
})
export class BudgetsModule {}
```

---

## 2. Alert Engine

### `apps/api/src/notifications/alert-engine.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { isNull, sql } from 'drizzle-orm';
import { NotificationsService } from './notifications.service';

interface BudgetAlert {
  budgetId: string;
  userId: string;
  categoryName: string;
  amountCents: number;
  spentCents: number;
  percentage: number;
  type: 'warning' | 'over_budget';
}

interface SavingsMilestone {
  goalId: string;
  userId: string;
  goalName: string;
  targetAmountCents: number;
  currentAmountCents: number;
  milestone: number; // 25, 50, 75, 100
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

  /**
   * Check all budgets for threshold violations.
   * Called after import AND on daily cron.
   */
  async checkBudgets(userIds?: string[]): Promise<BudgetAlert[]> {
    const rows = await this.db.execute(sql`
      SELECT
        b.id AS budget_id,
        b.user_id,
        b.amount_cents,
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
          type: 'warning',
        });
      }
    }

    // Create notifications for each alert
    for (const alert of alerts) {
      const title =
        alert.type === 'over_budget'
          ? `Over budget: ${alert.categoryName}`
          : `Budget warning: ${alert.categoryName}`;
      const message = `${alert.categoryName}: $${(alert.spentCents / 100).toFixed(2)} of $${(alert.amountCents / 100).toFixed(2)} (${(alert.percentage * 100).toFixed(0)}%)`;

      await this.notificationsService.createAndDispatch({
        userId: alert.userId,
        type: 'budget_alert',
        title,
        message,
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

  /**
   * Check savings goals for milestone achievements.
   * Called after contribute + daily cron.
   */
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
          // Check if we already sent this milestone notification
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
```

---

## 3. Notifications Service

### `apps/api/src/notifications/notifications.service.ts`

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { WebhookService } from './webhook.service';

interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  dedupeKey?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly webhookService: WebhookService,
  ) {}

  async findByUser(userId: string, limit = 50) {
    return this.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit);
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM ${schema.notifications}
      WHERE user_id = ${userId} AND is_read = false
    `);
    return (rows.rows ?? rows)[0]?.count ?? 0;
  }

  async markRead(id: string, userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.userId, userId),
        ),
      );
  }

  async markAllRead(userId: string) {
    await this.db
      .update(schema.notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.isRead, false),
        ),
      );
  }

  /**
   * Check if a notification with this dedupeKey exists.
   */
  async findByMetadata(userId: string, dedupeKey: string): Promise<boolean> {
    const rows = await this.db.execute(sql`
      SELECT 1 FROM ${schema.notifications}
      WHERE user_id = ${userId}
        AND metadata->>'dedupeKey' = ${dedupeKey}
      LIMIT 1
    `);
    return (rows.rows ?? rows).length > 0;
  }

  /**
   * Create notification in DB + dispatch to webhook.
   */
  async createAndDispatch(input: CreateNotificationInput) {
    const [notification] = await this.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        metadata: input.metadata
          ? { ...input.metadata, dedupeKey: input.dedupeKey }
          : undefined,
      })
      .returning();

    // Fire webhook asynchronously (don't block)
    this.webhookService
      .sendWebhook(input.userId, {
        event: input.type,
        title: input.title,
        message: input.message,
        ...input.metadata,
      })
      .catch((err) => {
        // Log but don't fail
        console.error('Webhook dispatch failed:', err.message);
      });

    return notification;
  }
}
```

### `apps/api/src/notifications/notifications.controller.ts`

```typescript
import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Req,
  Post,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  async findAll(@Req() req: any) {
    const data = await this.notificationsService.findByUser(req.user.id);
    return { data };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async unreadCount(@Req() req: any) {
    const count = await this.notificationsService.unreadCount(req.user.id);
    return { data: { count } };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markRead(@Req() req: any, @Param('id') id: string) {
    await this.notificationsService.markRead(id, req.user.id);
    return { data: { read: true } };
  }

  @Post('mark-all-read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all notifications read' })
  async markAllRead(@Req() req: any) {
    await this.notificationsService.markAllRead(req.user.id);
    return { data: { read: true } };
  }
}
```

---

## 4. Webhook Service (Home Assistant)

### `apps/api/src/notifications/webhook.service.ts`

````typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Sends webhook to Home Assistant.
 *
 * HA Automation example:
 * ```yaml
 * automation:
 *   trigger:
 *     platform: webhook
 *     webhook_id: moneypulse-alerts
 *   action:
 *     service: notify.mobile_app_phone
 *     data:
 *       title: "{{ trigger.json.title }}"
 *       message: "{{ trigger.json.message }}"
 * ```
 *
 * Expected webhook URL format:
 * https://homeassistant.local:8123/api/webhook/moneypulse-alerts
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async sendWebhook(
    userId: string,
    payload: Record<string, any>,
  ): Promise<void> {
    // Get user settings for webhook URL
    const settings = await this.db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1);

    const webhookUrl = settings[0]?.haWebhookUrl;
    if (!webhookUrl) return; // No webhook configured

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      if (!res.ok) {
        this.logger.warn(`Webhook returned ${res.status} for user ${userId}`);
      }
    } catch (err: any) {
      this.logger.error(`Webhook failed for user ${userId}: ${err.message}`);
    }
  }
}
````

---

## 5. Email Service (Opt-in, Documented)

### `apps/api/src/notifications/email.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Email notifications via SMTP. Opt-in: requires SMTP_* env vars.
 *
 * .env example:
 * SMTP_HOST=smtp.gmail.com
 * SMTP_PORT=587
 * SMTP_USER=yourapp@gmail.com
 * SMTP_PASS=app-password
 * SMTP_FROM=MoneyPulse <noreply@moneypulse.local>
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT', 587)),
        secure: false,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
      this.logger.log('SMTP configured');
    } else {
      this.logger.log('SMTP not configured — email notifications disabled');
    }
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transporter) return false;

    try {
      await this.transporter.sendMail({
        from: this.config.get(
          'SMTP_FROM',
          'MoneyPulse <noreply@moneypulse.local>',
        ),
        to,
        subject,
        text,
      });
      return true;
    } catch (err: any) {
      this.logger.error(`Email failed to ${to}: ${err.message}`);
      return false;
    }
  }
}
```

---

## 6. BullMQ Alert Cron

### `apps/api/src/jobs/alert-cron.processor.ts`

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AlertEngineService } from '../notifications/alert-engine.service';

/**
 * Daily cron: check all budgets for threshold violations.
 * Registered as a repeatable job on module init.
 *
 * Queue setup in app.module.ts:
 * BullModule.registerQueue({ name: 'alerts' })
 *
 * Schedule in onModuleInit:
 * alertQueue.upsertJobScheduler('daily-budget-check', {
 *   pattern: '0 8 * * *',  // 8 AM daily
 * }, { name: 'budget-sweep' });
 */
@Processor('alerts')
export class AlertCronProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertCronProcessor.name);

  constructor(private readonly alertEngine: AlertEngineService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing alert job: ${job.name}`);

    switch (job.name) {
      case 'budget-sweep':
        const alerts = await this.alertEngine.checkBudgets();
        this.logger.log(
          `Budget sweep complete: ${alerts.length} alerts generated`,
        );
        break;

      case 'post-import-check':
        // Check budgets only for the user who just imported
        const userIds = job.data.userIds as string[];
        await this.alertEngine.checkBudgets(userIds);
        break;

      default:
        this.logger.warn(`Unknown alert job: ${job.name}`);
    }
  }
}
```

### `apps/api/src/jobs/reminder.processor.ts`

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Balance reminders:
 * - Weekly: bank accounts (checking/savings)
 * - Monthly: investment accounts
 *
 * Schedule:
 * reminderQueue.upsertJobScheduler('weekly-bank', { pattern: '0 9 * * 1' }, { name: 'bank-reminder' });
 * reminderQueue.upsertJobScheduler('monthly-investment', { pattern: '0 9 1 * *' }, { name: 'investment-reminder' });
 */
@Processor('reminders')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing reminder: ${job.name}`);

    switch (job.name) {
      case 'bank-reminder':
        await this.sendBankReminders();
        break;
      case 'investment-reminder':
        await this.sendInvestmentReminders();
        break;
    }
  }

  private async sendBankReminders() {
    // Find accounts with stale data (no txn in 7+ days)
    const rows = await this.db.execute(sql`
      SELECT DISTINCT a.user_id, a.nickname, a.institution,
        MAX(t.date) AS last_txn_date
      FROM ${schema.accounts} a
      LEFT JOIN ${schema.transactions} t ON a.id = t.account_id AND t.deleted_at IS NULL
      WHERE a.account_type IN ('checking', 'savings')
        AND a.deleted_at IS NULL
      GROUP BY a.id, a.user_id, a.nickname, a.institution
      HAVING MAX(t.date) < CURRENT_DATE - INTERVAL '7 days'
        OR MAX(t.date) IS NULL
    `);

    for (const row of rows.rows ?? rows) {
      await this.notificationsService.createAndDispatch({
        userId: row.user_id,
        type: 'balance_reminder',
        title: `Update ${row.nickname}`,
        message: `No recent transactions for ${row.nickname} (${row.institution}). Upload a new statement?`,
      });
    }

    this.logger.log(`Sent ${(rows.rows ?? rows).length} bank reminders`);
  }

  private async sendInvestmentReminders() {
    // Find investment accounts with no snapshot in 30+ days
    const rows = await this.db.execute(sql`
      SELECT DISTINCT ia.user_id, ia.nickname, ia.institution,
        MAX(s.date) AS last_snapshot
      FROM ${schema.investmentAccounts} ia
      LEFT JOIN ${schema.investmentSnapshots} s ON ia.id = s.investment_account_id
      WHERE ia.deleted_at IS NULL
      GROUP BY ia.id, ia.user_id, ia.nickname, ia.institution
      HAVING MAX(s.date) < CURRENT_DATE - INTERVAL '30 days'
        OR MAX(s.date) IS NULL
    `);

    for (const row of rows.rows ?? rows) {
      await this.notificationsService.createAndDispatch({
        userId: row.user_id,
        type: 'balance_reminder',
        title: `Update ${row.nickname}`,
        message: `No recent update for investment account ${row.nickname} (${row.institution}). Add a balance snapshot?`,
      });
    }

    this.logger.log(`Sent ${(rows.rows ?? rows).length} investment reminders`);
  }
}
```

### `apps/api/src/notifications/notifications.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AlertEngineService } from './alert-engine.service';
import { WebhookService } from './webhook.service';
import { EmailService } from './email.service';

@Module({
  providers: [
    NotificationsService,
    AlertEngineService,
    WebhookService,
    EmailService,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, AlertEngineService],
})
export class NotificationsModule {}
```

---

## 7. Frontend — Budget Page

### `apps/web/src/lib/hooks/useBudgets.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: () => api.get<{ data: any[] }>('/budgets'),
    select: (res) => res.data,
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/budgets', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/budgets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useSavingsGoals() {
  return useQuery({
    queryKey: ['savings-goals'],
    queryFn: () => api.get<{ data: any[] }>('/savings-goals'),
    select: (res) => res.data,
  });
}

export function useCreateSavingsGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: any) => api.post('/savings-goals', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['savings-goals'] }),
  });
}

export function useContributeSavingsGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents: number }) =>
      api.post(`/savings-goals/${id}/contribute`, { amountCents }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['savings-goals'] }),
  });
}
```

### `apps/web/src/components/BudgetCard.tsx`

```tsx
'use client';

import { formatCents } from '@/lib/format';

interface Props {
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  amountCents: number;
  spentCents: number;
  period: string;
  isHousehold: boolean;
  onDelete?: () => void;
}

export function BudgetCard({
  categoryName,
  categoryIcon,
  categoryColor,
  amountCents,
  spentCents,
  period,
  isHousehold,
  onDelete,
}: Props) {
  const pct = amountCents > 0 ? (spentCents / amountCents) * 100 : 0;
  const barColor =
    pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span>{categoryIcon}</span>
          <span className="font-medium text-sm">{categoryName}</span>
          {isHousehold && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
              Shared
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground capitalize">
          {period}
        </span>
      </div>

      <div className="flex justify-between text-sm mb-1">
        <span>{formatCents(spentCents)} spent</span>
        <span className="text-muted-foreground">
          of {formatCents(amountCents)}
        </span>
      </div>

      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={`h-2 rounded-full ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {pct > 80 && (
        <p
          className={`text-xs mt-1 ${pct > 100 ? 'text-red-600' : 'text-yellow-600'}`}
        >
          {pct > 100
            ? `Over budget by ${formatCents(spentCents - amountCents)}`
            : `${pct.toFixed(0)}% used`}
        </p>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          className="text-xs text-muted-foreground hover:text-red-600 mt-2"
        >
          Remove
        </button>
      )}
    </div>
  );
}
```

### `apps/web/src/components/SavingsGoalCard.tsx`

```tsx
'use client';

import { formatCents } from '@/lib/format';

interface Props {
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  targetDate: string | null;
  onContribute?: () => void;
}

export function SavingsGoalCard({
  name,
  targetAmountCents,
  currentAmountCents,
  targetDate,
  onContribute,
}: Props) {
  const pct =
    targetAmountCents > 0 ? (currentAmountCents / targetAmountCents) * 100 : 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm">{name}</span>
        {targetDate && (
          <span className="text-xs text-muted-foreground">by {targetDate}</span>
        )}
      </div>

      <div className="flex justify-between text-sm mb-1">
        <span>{formatCents(currentAmountCents)}</span>
        <span className="text-muted-foreground">
          of {formatCents(targetAmountCents)}
        </span>
      </div>

      <div className="w-full bg-muted rounded-full h-2 mb-2">
        <div
          className="h-2 rounded-full bg-blue-500"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
        {onContribute && (
          <button
            onClick={onContribute}
            className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded"
          >
            + Contribute
          </button>
        )}
      </div>
    </div>
  );
}
```

### `apps/web/src/app/budgets/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { BudgetCard } from '@/components/BudgetCard';
import { SavingsGoalCard } from '@/components/SavingsGoalCard';
import {
  useBudgets,
  useDeleteBudget,
  useSavingsGoals,
  useContributeSavingsGoal,
} from '@/lib/hooks/useBudgets';
import { useCategories } from '@/lib/hooks/useCategories';

export default function BudgetsPage() {
  const { data: budgets } = useBudgets();
  const { data: goals } = useSavingsGoals();
  const deleteBudget = useDeleteBudget();
  const contribute = useContributeSavingsGoal();

  const [tab, setTab] = useState<'personal' | 'household'>('personal');

  const filteredBudgets = (budgets || []).filter((b: any) =>
    tab === 'household' ? b.household_id : !b.household_id,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Budgets</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('personal')}
          className={`px-4 py-2 text-sm rounded-md ${tab === 'personal' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
        >
          Personal
        </button>
        <button
          onClick={() => setTab('household')}
          className={`px-4 py-2 text-sm rounded-md ${tab === 'household' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
        >
          Household
        </button>
      </div>

      {/* Budget grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredBudgets.map((b: any) => (
          <BudgetCard
            key={b.id}
            categoryName={b.category_name}
            categoryIcon={b.category_icon || '📁'}
            categoryColor={b.category_color || '#888'}
            amountCents={Number(b.amount_cents)}
            spentCents={Number(b.spent_cents)}
            period={b.period}
            isHousehold={!!b.household_id}
            onDelete={() => deleteBudget.mutate(b.id)}
          />
        ))}
      </div>

      {/* Savings Goals */}
      <h2 className="text-xl font-bold mt-8">Savings Goals</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(goals || []).map((g: any) => (
          <SavingsGoalCard
            key={g.id}
            name={g.name}
            targetAmountCents={Number(g.targetAmountCents)}
            currentAmountCents={Number(g.currentAmountCents)}
            targetDate={g.targetDate}
            onContribute={() => {
              const amount = prompt('Amount in dollars:');
              if (amount) {
                contribute.mutate({
                  id: g.id,
                  amountCents: Math.round(parseFloat(amount) * 100),
                });
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

## 8. Notification Bell Component

### `apps/web/src/components/NotificationBell.tsx`

```tsx
'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import {
  useNotifications,
  useUnreadCount,
  useMarkRead,
} from '@/lib/hooks/useNotifications';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: notifications } = useNotifications();
  const { data: unread } = useUnreadCount();
  const markRead = useMarkRead();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-full hover:bg-accent transition-colors"
      >
        <Bell className="w-5 h-5" />
        {!!unread && unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="p-3 border-b border-border">
            <h3 className="font-medium text-sm">Notifications</h3>
          </div>
          <div className="divide-y divide-border">
            {(notifications || []).slice(0, 20).map((n: any) => (
              <div
                key={n.id}
                className={`p-3 cursor-pointer hover:bg-muted/50 ${!n.isRead ? 'bg-primary/5' : ''}`}
                onClick={() => {
                  if (!n.isRead) markRead.mutate(n.id);
                }}
              >
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {n.message}
                </p>
              </div>
            ))}
            {(!notifications || notifications.length === 0) && (
              <p className="p-4 text-sm text-muted-foreground">
                No notifications
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## API Endpoints Summary (New)

| Method   | Path                                | Auth | Description                     |
| -------- | ----------------------------------- | ---- | ------------------------------- |
| `GET`    | `/api/budgets`                      | JWT  | List budgets with current spend |
| `POST`   | `/api/budgets`                      | JWT  | Create budget                   |
| `PATCH`  | `/api/budgets/:id`                  | JWT  | Update budget                   |
| `DELETE` | `/api/budgets/:id`                  | JWT  | Soft delete budget              |
| `GET`    | `/api/savings-goals`                | JWT  | List savings goals              |
| `POST`   | `/api/savings-goals`                | JWT  | Create savings goal             |
| `PATCH`  | `/api/savings-goals/:id`            | JWT  | Update savings goal             |
| `POST`   | `/api/savings-goals/:id/contribute` | JWT  | Add funds to goal               |
| `DELETE` | `/api/savings-goals/:id`            | JWT  | Soft delete goal                |
| `GET`    | `/api/notifications`                | JWT  | List notifications              |
| `GET`    | `/api/notifications/unread-count`   | JWT  | Unread count                    |
| `PATCH`  | `/api/notifications/:id/read`       | JWT  | Mark read                       |
| `POST`   | `/api/notifications/mark-all-read`  | JWT  | Mark all read                   |

---

## Implementation Order

```
Step 1:  Install nodemailer dependency
Step 2:  Create webhook service
Step 3:  Create email service (opt-in)
Step 4:  Create notifications service + controller + module
Step 5:  Create alert engine service
Step 6:  Create budgets service
Step 7:  Create budgets controller + savings-goals controller + module
Step 8:  Create alert cron processor (BullMQ)
Step 9:  Create reminder processor (BullMQ)
Step 10: Register BullMQ queues ('alerts', 'reminders') in app.module.ts
Step 11: Register job schedulers (daily budget sweep, weekly bank, monthly investment)
Step 12: Wire post-import alert check into ingestion processor
Step 13: Update app.module.ts — import BudgetsModule, NotificationsModule
Step 14: Create frontend hooks (useBudgets, useSavingsGoals)
Step 15: Create BudgetCard + SavingsGoalCard components
Step 16: Create budgets page
Step 17: Create NotificationBell component
Step 18: Add NotificationBell to AppShell header
Step 19: Build + verify
Step 20: E2E test: budget alert fires on threshold
Step 21: Git commit
```

---

## Home Assistant Webhook Payload Format

```json
{
  "event": "budget_alert",
  "title": "Over budget: Dining Out",
  "message": "Dining Out: $450.00 of $400.00 (113%)",
  "category": "Dining Out",
  "spent": 45000,
  "budget": 40000,
  "percentage": 1.125
}
```

```json
{
  "event": "savings_milestone",
  "title": "Savings milestone: Vacation Fund",
  "message": "Vacation Fund: 50% reached! $2,500.00 of $5,000.00",
  "goalName": "Vacation Fund",
  "milestone": 50,
  "current": 250000,
  "target": 500000
}
```
