import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { WATCH_FOLDER_DIR } from '@moneypulse/shared';
import type {
  CreateAccountInput,
  UpdateAccountInput,
} from '@moneypulse/shared';
import { encryptField, decryptField } from '../common/crypto';
import { OutboxService } from '../sync/outbox.service';
import { AliasMapperService } from '../sync/alias-mapper.service';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);
  private readonly watchDir: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly config: ConfigService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly aliasMapper?: AliasMapperService,
  ) {
    this.watchDir =
      this.config.get<string>('WATCH_FOLDER_DIR') || WATCH_FOLDER_DIR;
  }

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
        lastFour: encryptField(input.lastFour),
        startingBalanceCents: input.startingBalanceCents,
        creditLimitCents: input.creditLimitCents ?? null,
      })
      .returning();

    const account = this.decryptAccount(rows[0]);
    await this.enqueueAccountEvent(account);

    // Create watch-folder subdirectory for auto-import
    try {
      const slug = this.generateSlug(account.nickname, account.lastFour);
      const folderPath = join(this.watchDir, slug);
      await mkdir(folderPath, { recursive: true });
      this.logger.log(`Created watch folder: ${folderPath}`);
    } catch (err) {
      // Non-fatal — log and continue (folder may not be writable in all envs)
      this.logger.warn(`Could not create watch folder: ${(err as Error).message}`);
    }

    return account;
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
    return rows[0] ? this.decryptAccount(rows[0]) : null;
  }

  /**
   * Return all non-deleted accounts owned by a specific user, ordered by creation date.
   *
   * @param userId - The user whose accounts to retrieve
   * @returns Array of account rows
   */
  async findByUser(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
        ),
      )
      .orderBy(schema.accounts.createdAt);
    return rows.map((a: any) => this.decryptAccount(a));
  }

  /**
   * Return all non-deleted accounts belonging to any member of a household,
   * joined with the owner's display name.
   *
   * @param householdId - The household UUID to scope the query
   * @returns Array of `{ account, ownerName }` objects ordered by creation date
   */
  async findByHousehold(householdId: string) {
    const results = await this.db
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
    return results.map((r: any) => ({ ...r, account: this.decryptAccount(r.account) }));
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
      .set({
        ...input,
        ...(input.lastFour ? { lastFour: encryptField(input.lastFour) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.accounts.id, id))
      .returning();
    const updated = this.decryptAccount(rows[0]);
    await this.enqueueAccountEvent(updated);
    return updated;
  }

  /**
   * Reconcile an account: set starting_balance so that
   * starting_balance + sum(transactions) = actualBalanceCents.
   *
   * @param id - Account UUID
   * @param userId - Requesting user's ID
   * @param actualBalanceCents - The real bank balance right now
   * @returns The updated account with corrected starting balance
   */
  async reconcile(id: string, userId: string, actualBalanceCents: number) {
    const account = await this.findById(id);
    if (!account) throw new NotFoundException('Account not found');
    if (account.userId !== userId)
      throw new NotFoundException('Account not found');

    // Compute net transaction total for this account
    const result = await this.db.execute(sql`
      SELECT COALESCE(SUM(
        CASE WHEN t.is_credit THEN t.amount_cents ELSE -t.amount_cents END
      ), 0) AS net_cents
      FROM ${schema.transactions} t
      WHERE t.account_id = ${id}::uuid
        AND t.is_split_parent = false
        AND t.deleted_at IS NULL
    `);
    const netCents = Number((result.rows ?? result)[0]?.net_cents ?? 0);

    // starting_balance = actual_balance - net_transactions
    const startingBalanceCents = actualBalanceCents - netCents;

    const rows = await this.db
      .update(schema.accounts)
      .set({ startingBalanceCents, updatedAt: new Date() })
      .where(eq(schema.accounts.id, id))
      .returning();

    const updated = this.decryptAccount(rows[0]);
    await this.enqueueAccountEvent(updated);
    return { ...updated, netTransactionCents: netCents };
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
    const plainLastFour = decryptField(lastFour);
    return (
      nickname
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      plainLastFour
    );
  }

  private async enqueueAccountEvent(account: any): Promise<void> {
    if (!this.outbox || !this.aliasMapper) return;
    try {
      await this.outbox.enqueue({
        eventType: 'account.projected.v1',
        aggregateType: 'account',
        aggregateId: account.id,
        userId: account.userId,
        payload: {
          accountAliasId: this.aliasMapper.toAliasId('account', account.id),
          institution: account.institution,
          accountType: account.accountType,
          nickname: account.nickname,
          startingBalanceCents: account.startingBalanceCents,
        },
      });
    } catch (err: unknown) {
      this.logger.warn(`Outbox enqueue skipped for account ${account.id}: ${(err as Error).message}`);
    }
  }

  private decryptAccount(account: any) {
    if (!account) return account;
    return {
      ...account,
      lastFour: decryptField(account.lastFour),
    };
  }
}
