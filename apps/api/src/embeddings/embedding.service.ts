import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { OllamaEmbeddingService, EMBEDDING_MODEL } from './ollama-embedding.service';

export interface SimilarTransactionRow {
  transactionId: string;
  date: Date;
  description: string;
  merchantName: string | null;
  amountCents: number;
  isCredit: boolean;
  category: string | null;
  distance: number;
}

/**
 * Builds the text representation embedded for a transaction, upserts
 * embeddings into `transaction_embeddings`, and runs pgvector nearest-
 * neighbor queries — always scoped to a `userId` so results can never leak
 * across accounts.
 *
 * Every write here is best-effort: embedding is a "nice to have" enrichment
 * per the Phase-10 AI-availability rule, never a blocker for ingestion.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly ollamaEmbedding: OllamaEmbeddingService,
  ) {}

  /** Compose the text sent to the embedding model for a transaction row. */
  buildEmbeddingText(txn: {
    description: string;
    merchantName?: string | null;
    normalizedMerchantName?: string | null;
    amountCents: number;
    isCredit: boolean;
    categoryName?: string | null;
  }): string {
    const parts = [
      txn.normalizedMerchantName || txn.merchantName || txn.description,
      txn.description,
      txn.categoryName ? `category: ${txn.categoryName}` : null,
      `${txn.isCredit ? 'credit' : 'debit'} $${(Math.abs(txn.amountCents) / 100).toFixed(2)}`,
    ].filter(Boolean);
    return parts.join(' | ');
  }

  /**
   * Embed and upsert a batch of transactions by id. Returns counts so the
   * caller (BullMQ processor) can log/retry appropriately. Never throws for
   * per-row embedding failures — only a hard DB error propagates.
   */
  async embedTransactions(
    transactionIds: string[],
  ): Promise<{ embedded: number; failed: number }> {
    if (transactionIds.length === 0) return { embedded: 0, failed: 0 };

    const rows = await this.db.execute(sql`
      SELECT t.id, t.description, t.merchant_name AS "merchantName",
             t.normalized_merchant_name AS "normalizedMerchantName",
             t.amount_cents AS "amountCents", t.is_credit AS "isCredit",
             c.name AS "categoryName"
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.id = ANY(${transactionIds})
        AND t.deleted_at IS NULL
    `);

    const txns = rows.rows ?? rows;
    let embedded = 0;
    let failed = 0;

    for (const txn of txns) {
      const text = this.buildEmbeddingText(txn);
      const vector = await this.ollamaEmbedding.embed(text);
      if (!vector) {
        failed++;
        continue;
      }
      const vectorLiteral = `[${vector.join(',')}]`;
      await this.db.execute(sql`
        INSERT INTO transaction_embeddings (transaction_id, embedding, model, embedded_at)
        VALUES (${txn.id}, ${vectorLiteral}::vector, ${EMBEDDING_MODEL}, now())
        ON CONFLICT (transaction_id)
        DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, embedded_at = now()
      `);
      embedded++;
    }

    if (failed > 0) {
      this.logger.warn(`embedTransactions: ${failed}/${txns.length} embeddings failed`);
    }
    return { embedded, failed };
  }

  /**
   * Free-text semantic search scoped to `userId`. Embeds the query with
   * Ollama; returns `null` (never throws) if Ollama is unreachable so the
   * caller can fall back to keyword search.
   */
  async semanticSearch(
    userId: string,
    queryText: string,
    limit = 20,
  ): Promise<SimilarTransactionRow[] | null> {
    const vector = await this.ollamaEmbedding.embed(queryText);
    if (!vector) return null;
    const vectorLiteral = `[${vector.join(',')}]`;

    const result = await this.db.execute(sql`
      SELECT t.id AS "transactionId", t.date, t.description, t.merchant_name AS "merchantName",
             t.amount_cents AS "amountCents", t.is_credit AS "isCredit",
             c.name AS category,
             (te.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM transaction_embeddings te
      JOIN transactions t ON t.id = te.transaction_id
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND t.is_split_parent = false
      ORDER BY te.embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `);
    return (result.rows ?? result) as SimilarTransactionRow[];
  }

  /**
   * Find the `limit` nearest neighbors (by embedding) to an existing
   * transaction, excluding itself. Returns `[]` if the source transaction
   * has no embedding yet (best-effort — never throws).
   */
  async findSimilar(
    userId: string,
    transactionId: string,
    limit = 5,
  ): Promise<SimilarTransactionRow[]> {
    const result = await this.db.execute(sql`
      SELECT t.id AS "transactionId", t.date, t.description, t.merchant_name AS "merchantName",
             t.amount_cents AS "amountCents", t.is_credit AS "isCredit",
             c.name AS category,
             (te.embedding <=> source.embedding) AS distance
      FROM transaction_embeddings te
      JOIN transactions t ON t.id = te.transaction_id
      LEFT JOIN categories c ON t.category_id = c.id
      JOIN transaction_embeddings source ON source.transaction_id = ${transactionId}
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND t.is_split_parent = false
        AND te.transaction_id != ${transactionId}
      ORDER BY te.embedding <=> source.embedding
      LIMIT ${limit}
    `);
    return (result.rows ?? result) as SimilarTransactionRow[];
  }
}
