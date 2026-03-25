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

  /**
   * Create a new bank account for the given user.
   *
   * @param userId - The authenticated user's ID
   * @param input - Account creation payload (institution, type, nickname, etc.)
   * @returns The newly created account row
   */
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

  /**
   * Find a single account by its UUID, excluding soft-deleted records.
   *
   * @param id - Account UUID
   * @returns The account row or `null` if not found / deleted
   */
  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, id), isNull(schema.accounts.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Return all non-deleted accounts owned by a specific user, ordered by creation date.
   *
   * @param userId - The user whose accounts to retrieve
   * @returns Array of account rows
   */
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

  /**
   * Return all non-deleted accounts belonging to any member of a household,
   * joined with the owner's display name.
   *
   * @param householdId - The household UUID to scope the query
   * @returns Array of `{ account, ownerName }` objects ordered by creation date
   */
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

  /**
   * Update mutable fields on an account after verifying ownership.
   *
   * @param id - Account UUID to update
   * @param userId - Requesting user's ID (must own the account)
   * @param input - Partial update payload
   * @returns The updated account row
   * @throws NotFoundException if the account does not exist or is not owned by `userId`
   */
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

  /**
   * Soft-delete an account by setting `deletedAt` to now.
   * Verifies ownership before deleting.
   *
   * @param id - Account UUID to delete
   * @param userId - Requesting user's ID (must own the account)
   * @throws NotFoundException if the account does not exist or is not owned by `userId`
   */
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

  /**
   * Persist a validated `CsvFormatConfig` JSONB blob on the account.
   *
   * @param id - Account UUID
   * @param config - Validated `CsvFormatConfig` object to store
   */
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
