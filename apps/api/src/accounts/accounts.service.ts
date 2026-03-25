import {
  Injectable,
  Inject,
  NotFoundException,
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
