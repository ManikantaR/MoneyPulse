import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import { OutboxService } from '../sync/outbox.service';
import { AliasMapperService } from '../sync/alias-mapper.service';
import * as schema from '../db/schema';
import {
  eq,
  and,
  isNull,
  desc,
  asc,
  ilike,
  sql,
  between,
  count,
} from 'drizzle-orm';
import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  TransactionQuery,
  SplitTransactionInput,
  BulkCategorizeInput,
} from '@moneypulse/shared';
import { createHash } from 'crypto';
import { encryptField, decryptField } from '../common/crypto';
import { sanitizeMerchantName } from '../sync/sync.constants';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly outbox: OutboxService,
    private readonly aliasMapper: AliasMapperService,
  ) {}

  /**
   * Manual transaction entry (cash purchases, etc.)
   * Validates that the account belongs to the user before inserting.
   */
  async create(userId: string, input: CreateTransactionInput) {
    // Verify account ownership (and not soft-deleted)
    const account = await this.db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.id, input.accountId),
          eq(schema.accounts.userId, userId),
          isNull(schema.accounts.deletedAt),
        ),
      )
      .limit(1);

    if (account.length === 0) {
      throw new NotFoundException('Account not found');
    }

    const txnHash = createHash('sha256')
      .update(
        `${input.accountId}|${input.date}|${input.amountCents}|${input.description}|manual`,
      )
      .digest('hex');

    // Domain write and outbox insert are wrapped in a single DB transaction so
    // a committed transaction always has a corresponding outbox event (transactional outbox pattern).
    const txn = await this.db.transaction(async (tx: any) => {
      const rows = await tx
        .insert(schema.transactions)
        .values({
          accountId: input.accountId,
          userId,
          txnHash,
          date: new Date(input.date),
          description: input.description,
          originalDescription: encryptField(input.description),
          amountCents: input.amountCents,
          categoryId: input.categoryId ?? null,
          merchantName: input.merchantName ?? null,
          isCredit: input.isCredit,
          isManual: true,
          tags: input.tags ?? [],
        })
        .returning();

      const inserted = this.decryptTxn(rows[0]);
      await this.enqueueTransactionEventInTx(tx, 'transaction.projected.v1', inserted);
      return inserted;
    });

    return txn;
  }

  /**
   * Paginated, filterable transaction list.
   */
  async findAll(
    userId: string,
    query: TransactionQuery,
    householdId?: string | null,
  ) {
    const conditions: any[] = [isNull(schema.transactions.deletedAt)];

    if (householdId) {
      const members = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.householdId, householdId));
      const memberIds = members.map((m: any) => m.id);
      if (memberIds.length > 0) {
        conditions.push(
          sql`${schema.transactions.userId} = ANY(ARRAY[${sql.join(
            memberIds.map((id: string) => sql`${id}::uuid`),
            sql`, `,
          )}])`,
        );
      }
    } else {
      conditions.push(eq(schema.transactions.userId, userId));
    }

    if (query.accountId)
      conditions.push(eq(schema.transactions.accountId, query.accountId));
    if (query.uploadId)
      conditions.push(eq(schema.transactions.sourceFileId, query.uploadId));
    if (query.categoryId === '__uncategorized__') {
      conditions.push(isNull(schema.transactions.categoryId));
    } else if (query.categoryId) {
      conditions.push(eq(schema.transactions.categoryId, query.categoryId));
    }
    if (query.from && query.to) {
      conditions.push(
        between(
          schema.transactions.date,
          new Date(query.from),
          new Date(query.to),
        ),
      );
    }
    if (query.search) {
      conditions.push(
        ilike(schema.transactions.description, `%${query.search}%`),
      );
    }
    if (query.isCredit !== undefined) {
      conditions.push(eq(schema.transactions.isCredit, query.isCredit));
    }

    // Exclude split parents from list
    conditions.push(eq(schema.transactions.isSplitParent, false));

    const whereCondition = and(...conditions);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(schema.transactions)
      .where(whereCondition);

    const sortColumnMap: Record<string, any> = {
      date: schema.transactions.date,
      amount: schema.transactions.amountCents,
      description: schema.transactions.description,
      category: schema.transactions.categoryId,
    };
    const sortColumn = sortColumnMap[query.sortBy] ?? schema.transactions.date;

    const sortFn = query.sortOrder === 'asc' ? asc : desc;

    const offset = (query.page - 1) * query.pageSize;
    const data = await this.db
      .select()
      .from(schema.transactions)
      .where(whereCondition)
      .orderBy(sortFn(sortColumn))
      .limit(query.pageSize)
      .offset(offset);

    return {
      data: data.map((t: any) => this.decryptTxn(t)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Fetch a transaction by ID without access control.
   * For user-scoped access use `findByIdForUser()`.
   *
   * @param id - Transaction UUID
   * @returns The transaction row or `null` if not found / soft-deleted
   */
  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, id),
          isNull(schema.transactions.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? this.decryptTxn(rows[0]) : null;
  }

  /**
   * Fetch a transaction by ID and enforce ownership / household membership.
   * Returns `null` (caller should throw 404) when the transaction is not accessible.
   *
   * @param id - Transaction UUID
   * @param userId - The requesting user's ID
   * @param householdId - Optional household ID; grants access to household-member transactions
   * @returns The transaction row or `null` if not found or not accessible
   */
  async findByIdForUser(
    id: string,
    userId: string,
    householdId?: string | null,
  ) {
    const txn = await this.findById(id);
    if (!txn) return null;

    // Allow access if owned by user or by a household member
    if (txn.userId === userId) return txn;

    if (householdId) {
      const member = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.id, txn.userId),
            eq(schema.users.householdId, householdId),
          ),
        )
        .limit(1);
      if (member.length > 0) return txn;
    }

    return null;
  }

  /**
   * Update mutable fields on a transaction after verifying ownership.
   *
   * @param id - Transaction UUID
   * @param userId - Requesting user's ID (must own the transaction)
   * @param input - Partial update payload (description, category, tags, etc.)
   * @returns The updated transaction row
   * @throws NotFoundException if the transaction does not exist or is not owned by `userId`
   */
  async update(id: string, userId: string, input: UpdateTransactionInput) {
    const txn = await this.findById(id);
    if (!txn || txn.userId !== userId)
      throw new NotFoundException('Transaction not found');

    // Wrap the domain update and outbox insert in a single DB transaction.
    const updated = await this.db.transaction(async (tx: any) => {
      const rows = await tx
        .update(schema.transactions)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(schema.transactions.id, id))
        .returning();
      const updatedRow = this.decryptTxn(rows[0]);
      await this.enqueueTransactionEventInTx(tx, 'transaction.projected.v1', updatedRow);
      return updatedRow;
    });

    return updated;
  }

  /**
   * Soft-delete a transaction by setting `deletedAt` to now.
   * Verifies ownership before deleting.
   *
   * @param id - Transaction UUID
   * @param userId - Requesting user's ID (must own the transaction)
   * @throws NotFoundException if the transaction does not exist or is not owned by `userId`
   */
  async softDelete(id: string, userId: string): Promise<void> {
    const txn = await this.findById(id);
    if (!txn || txn.userId !== userId)
      throw new NotFoundException('Transaction not found');

    await this.db
      .update(schema.transactions)
      .set({ deletedAt: new Date() })
      .where(eq(schema.transactions.id, id));
  }

  /**
   * Split a transaction into children.
   * Parent gets isSplitParent=true, children created.
   * Sum of children must equal parent amount.
   */
  async splitTransaction(
    id: string,
    userId: string,
    input: SplitTransactionInput,
  ) {
    const parent = await this.findById(id);
    if (!parent || parent.userId !== userId) throw new NotFoundException();

    if (parent.isSplitParent) {
      throw new BadRequestException(
        'Transaction has already been split. Cannot split again.',
      );
    }

    const splitTotal = input.splits.reduce(
      (sum: number, s: any) => sum + s.amountCents,
      0,
    );
    if (splitTotal !== parent.amountCents) {
      throw new BadRequestException(
        `Split amounts (${splitTotal}) must equal parent amount (${parent.amountCents})`,
      );
    }

    await this.db
      .update(schema.transactions)
      .set({ isSplitParent: true, updatedAt: new Date() })
      .where(eq(schema.transactions.id, id));

    const children = await this.db
      .insert(schema.transactions)
      .values(
        input.splits.map((split: any, idx: number) => ({
          accountId: parent.accountId,
          userId,
          txnHash: createHash('sha256')
            .update(`${parent.id}|split|${idx}`)
            .digest('hex'),
          date: parent.date,
          description: split.description || parent.description,
          originalDescription: encryptField(parent.originalDescription),
          amountCents: split.amountCents,
          categoryId: split.categoryId,
          isCredit: parent.isCredit,
          parentTransactionId: parent.id,
          sourceFileId: parent.sourceFileId,
          tags: [],
        })),
      )
      .returning();

    return { parent: { ...parent, isSplitParent: true }, children: children.map((c: any) => this.decryptTxn(c)) };
  }

  /**
   * Bulk categorize multiple transactions.
   */
  async bulkCategorize(userId: string, input: BulkCategorizeInput) {
    const updated = await this.db
      .update(schema.transactions)
      .set({ categoryId: input.categoryId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.transactions.userId, userId),
          sql`${schema.transactions.id} = ANY(ARRAY[${sql.join(
            input.transactionIds.map((id: string) => sql`${id}::uuid`),
            sql`, `,
          )}])`,
          isNull(schema.transactions.deletedAt),
        ),
      )
      .returning({ id: schema.transactions.id });

    return { updatedCount: updated.length };
  }

  /**
   * Find all uncategorized transaction IDs for a user.
   * Returns transactions where categoryId is null and not soft-deleted.
   */
  async findUncategorizedIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          isNull(schema.transactions.categoryId),
          isNull(schema.transactions.deletedAt),
        ),
      );
    return rows.map((r: any) => r.id);
  }

  private decryptTxn(txn: any) {
    if (!txn) return txn;
    return {
      ...txn,
      originalDescription: decryptField(txn.originalDescription),
    };
  }

  /**
   * Enqueue a safe, PII-free projection event within an existing DB transaction.
   * Alias mapping errors propagate so the outer transaction can roll back atomically.
   * If ALIAS_SECRET is missing, the domain write is rolled back and the caller receives an error.
   */
  private async enqueueTransactionEventInTx(
    tx: any,
    eventType: string,
    txn: any,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      transactionAliasId: this.aliasMapper.toAliasId('transaction', txn.id),
      accountAliasId: this.aliasMapper.toAliasId('account', txn.accountId),
      amountCents: txn.amountCents,
      date: txn.date instanceof Date ? txn.date.toISOString() : txn.date,
      categoryId: txn.categoryId ?? null,
      merchantName: txn.merchantName ?? this._deriveDisplayName(txn.description),
      isCredit: txn.isCredit,
      isManual: txn.isManual ?? false,
    };

    await this.outbox.enqueueInTx(tx, {
      eventType,
      aggregateType: 'transaction',
      aggregateId: txn.id,
      userId: txn.userId,
      payload,
    });
  }

  /**
   * Enqueue a safe, PII-free projection event for the sync outbox (best-effort).
   * Aliasing and outbox insert errors are caught and logged so the domain operation
   * succeeds even when sync secrets are missing or the outbox insert fails.
   * Prefer enqueueTransactionEventInTx when atomicity with the domain write is required.
   */
  private async enqueueTransactionEvent(
    eventType: string,
    txn: any,
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        transactionAliasId: this.aliasMapper.toAliasId('transaction', txn.id),
        accountAliasId: this.aliasMapper.toAliasId('account', txn.accountId),
        amountCents: txn.amountCents,
        date: txn.date instanceof Date ? txn.date.toISOString() : txn.date,
        categoryId: txn.categoryId ?? null,
        merchantName: sanitizeMerchantName(txn.merchantName) ?? this._deriveDisplayName(txn.description),
        isCredit: txn.isCredit,
        isManual: txn.isManual ?? false,
      };

      await this.outbox.enqueue({
        eventType,
        aggregateType: 'transaction',
        aggregateId: txn.id,
        userId: txn.userId,
        payload,
      });
    } catch (err) {
      this.logger.warn(
        `Skipping outbox enqueue for transaction ${txn.id}: ${(err as Error).message}`,
      );
    }
  }

  private _deriveDisplayName(description: string | null | undefined): string | null {
    if (!description) return null;
    let cleaned = description.toLowerCase().trim()
      .replace(/\s*#\d+/g, '')
      .replace(/\s*\*[\w]+/g, '')
      .replace(/\s+\d{5,}/g, '')
      .replace(/\s+store\s*\d*/gi, '')
      .replace(/\s+\d{2}\/\d{2,}/g, '')
      .trim();
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
    if (words.length === 0) return null;
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
}
