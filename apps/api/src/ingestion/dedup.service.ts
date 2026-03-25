import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq, and, inArray, isNotNull } from 'drizzle-orm';
import type { ParsedTransaction } from '@moneypulse/shared';

export interface DedupResult {
  newTransactions: ParsedTransaction[];
  skippedCount: number;
}

@Injectable()
export class DedupService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Filter out duplicate transactions.
   *
   * Dedup strategies (in priority order):
   * 1. external_id match: if bank provides a reference number, check (account_id, external_id)
   * 2. Hash match: SHA256(date + amountCents + normalized_description + account_id)
   *
   * Only queries the DB for hashes/external_ids that appear in the incoming batch,
   * avoiding a full account scan.
   */
  async dedup(
    accountId: string,
    transactions: ParsedTransaction[],
  ): Promise<DedupResult> {
    if (transactions.length === 0) {
      return { newTransactions: [], skippedCount: 0 };
    }

    // Build hashes for all incoming transactions
    const incoming = transactions.map((txn) => ({
      ...txn,
      hash: this.computeHash(accountId, txn),
    }));

    const incomingHashes = incoming.map((t) => t.hash);
    const incomingExternalIds = incoming
      .map((t) => t.externalId)
      .filter((id): id is string => id !== null);

    // Batch lookup: only fetch rows that could match the incoming batch
    const existingHashes = await this.getMatchingHashes(
      accountId,
      incomingHashes,
    );
    const existingExternalIds =
      incomingExternalIds.length > 0
        ? await this.getMatchingExternalIds(accountId, incomingExternalIds)
        : new Set<string>();

    const newTransactions: ParsedTransaction[] = [];
    let skippedCount = 0;

    for (const item of incoming) {
      // Check external_id first (more reliable)
      if (item.externalId && existingExternalIds.has(item.externalId)) {
        skippedCount++;
        continue;
      }

      // Check hash
      if (existingHashes.has(item.hash)) {
        skippedCount++;
        continue;
      }

      // New transaction — add hash to set to catch intra-batch dupes
      existingHashes.add(item.hash);
      if (item.externalId) existingExternalIds.add(item.externalId);

      newTransactions.push(item);
    }

    return { newTransactions, skippedCount };
  }

  /**
   * Compute SHA256 hash for dedup: accountId + date + amount + normalized_description + credit/debit
   */
  computeHash(accountId: string, txn: ParsedTransaction): string {
    const input = [
      accountId,
      txn.date,
      txn.amountCents.toString(),
      txn.description.trim().toLowerCase().replace(/\s+/g, ' '),
      txn.isCredit ? 'credit' : 'debit',
    ].join('|');

    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Query only the hashes from the incoming batch that already exist in the DB.
   * Uses an index-friendly IN clause instead of a full account scan.
   */
  private async getMatchingHashes(
    accountId: string,
    hashes: string[],
  ): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const rows = await this.db
      .select({ txnHash: schema.transactions.txnHash })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.accountId, accountId),
          inArray(schema.transactions.txnHash, hashes),
        ),
      );
    return new Set(rows.map((r: any) => r.txnHash));
  }

  /**
   * Query only the external_ids from the incoming batch that already exist in the DB.
   */
  private async getMatchingExternalIds(
    accountId: string,
    externalIds: string[],
  ): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set();
    const rows = await this.db
      .select({ externalId: schema.transactions.externalId })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.accountId, accountId),
          isNotNull(schema.transactions.externalId),
          inArray(schema.transactions.externalId, externalIds),
        ),
      );
    return new Set(
      rows
        .map((r: any) => r.externalId)
        .filter((id: string | null): id is string => id !== null),
    );
  }
}
