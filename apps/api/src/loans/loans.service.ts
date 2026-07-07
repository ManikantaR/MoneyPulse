import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import type { CreateLoanInput, UpdateLoanInput } from '@moneypulse/shared';

/** CRUD for tracked loans. Payoff math lives in the advisor's MCP tool (get_loan_status). */
@Injectable()
export class LoansService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.userId, userId), isNull(schema.loans.deletedAt)))
      .orderBy(asc(schema.loans.name));
  }

  async create(userId: string, input: CreateLoanInput) {
    const rows = await this.db
      .insert(schema.loans)
      .values({
        userId,
        name: input.name,
        lenderPattern: input.lenderPattern,
        loanType: input.loanType,
        originalBalanceCents: input.originalBalanceCents,
        aprBps: input.aprBps,
        termMonths: input.termMonths ?? null,
        startDate: input.startDate,
        scheduledPaymentCents: input.scheduledPaymentCents,
        extraPrincipalPattern: input.extraPrincipalPattern ?? null,
      })
      .returning();
    return rows[0];
  }

  async update(id: string, userId: string, input: UpdateLoanInput) {
    const existing = await this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.id, id), eq(schema.loans.userId, userId)))
      .limit(1);
    if (!existing[0] || existing[0].deletedAt) {
      throw new NotFoundException('Loan not found');
    }
    const rows = await this.db
      .update(schema.loans)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.loans.id, id))
      .returning();
    return rows[0];
  }

  async remove(id: string, userId: string) {
    const existing = await this.db
      .select()
      .from(schema.loans)
      .where(and(eq(schema.loans.id, id), eq(schema.loans.userId, userId)))
      .limit(1);
    if (!existing[0] || existing[0].deletedAt) {
      throw new NotFoundException('Loan not found');
    }
    await this.db
      .update(schema.loans)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(schema.loans.id, id));
    return { deleted: true };
  }
}
