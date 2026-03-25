import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
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

    // Batch lookup: get existing hashes and external_ids for this account
    const existingHashes = await this.getExistingHashes(accountId);
    const existingExternalIds = await this.getExistingExternalIds(accountId);

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

  private async getExistingHashes(accountId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ txnHash: schema.transactions.txnHash })
      .from(schema.transactions)
      .where(eq(schema.transactions.accountId, accountId));
    return new Set(rows.map((r: any) => r.txnHash));
  }

  private async getExistingExternalIds(
    accountId: string,
  ): Promise<Set<string>> {
    const rows = await this.db
      .select({ externalId: schema.transactions.externalId })
      .from(schema.transactions)
      .where(eq(schema.transactions.accountId, accountId));
    return new Set(
      rows
        .map((r: any) => r.externalId)
        .filter((id: string | null): id is string => id !== null),
    );
  }
}
