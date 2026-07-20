import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';

export interface NnCategorySuggestion {
  transactionId: string;
  categoryId: string;
  categoryName: string;
  confidence: number;
}

interface NeighborRow {
  categoryId: string;
  categoryName: string;
  distance: number;
}

/**
 * Cheapest, most personal categorization suggester: nearest-neighbor vote
 * among the user's OWN already-categorized transaction history (via
 * `transaction_embeddings`). Runs before the Ollama chat-model classifier —
 * if this finds a confident majority among the k nearest categorized
 * neighbors, we skip the more expensive LLM call entirely.
 *
 * Best-effort: requires the target transaction to already have an embedding
 * (post-11.10 ingestion hook) and at least `MIN_NEIGHBORS` categorized
 * neighbors within a reasonable distance; otherwise returns `null` so the
 * pipeline falls through to the AI categorizer unchanged.
 */
@Injectable()
export class EmbeddingCategorizerService {
  private readonly logger = new Logger(EmbeddingCategorizerService.name);
  private readonly K = 8;
  private readonly MIN_NEIGHBORS = 3;
  private readonly CONFIDENCE_THRESHOLD = 0.6;
  // Cosine distance beyond this is "not similar enough" to count as a vote.
  private readonly MAX_DISTANCE = 0.35;

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Propose a category for a single uncategorized transaction using a
   * distance-weighted vote among its k nearest categorized neighbors
   * (same user only). Returns `null` if there's no embedding yet, too few
   * neighbors, or no majority clears the confidence threshold.
   */
  async suggestCategory(
    userId: string,
    transactionId: string,
  ): Promise<NnCategorySuggestion | null> {
    const result = await this.db.execute(sql`
      SELECT c.id AS "categoryId", c.name AS "categoryName",
             (te.embedding <=> source.embedding) AS distance
      FROM transaction_embeddings te
      JOIN transactions t ON t.id = te.transaction_id
      JOIN categories c ON t.category_id = c.id
      JOIN transaction_embeddings source ON source.transaction_id = ${transactionId}
      WHERE t.user_id = ${userId}
        AND t.deleted_at IS NULL
        AND t.category_id IS NOT NULL
        AND te.transaction_id != ${transactionId}
        AND (te.embedding <=> source.embedding) <= ${this.MAX_DISTANCE}
      ORDER BY te.embedding <=> source.embedding
      LIMIT ${this.K}
    `);

    const neighbors = (result.rows ?? result) as NeighborRow[];
    return this.voteFromNeighbors(transactionId, neighbors);
  }

  /** Pure vote logic, extracted for unit testing without a DB. */
  voteFromNeighbors(
    transactionId: string,
    neighbors: NeighborRow[],
  ): NnCategorySuggestion | null {
    if (neighbors.length < this.MIN_NEIGHBORS) return null;

    // Weight each vote by inverse distance so closer neighbors count more.
    const weights = new Map<string, { name: string; weight: number }>();
    let totalWeight = 0;
    for (const n of neighbors) {
      const w = 1 - n.distance / this.MAX_DISTANCE; // in (0, 1]
      totalWeight += w;
      const existing = weights.get(n.categoryId);
      if (existing) {
        existing.weight += w;
      } else {
        weights.set(n.categoryId, { name: n.categoryName, weight: w });
      }
    }
    if (totalWeight === 0) return null;

    let best: { categoryId: string; name: string; weight: number } | null = null;
    for (const [categoryId, v] of weights.entries()) {
      if (!best || v.weight > best.weight) {
        best = { categoryId, name: v.name, weight: v.weight };
      }
    }
    if (!best) return null;

    const confidence = best.weight / totalWeight;
    if (confidence < this.CONFIDENCE_THRESHOLD) return null;

    return {
      transactionId,
      categoryId: best.categoryId,
      categoryName: best.name,
      confidence,
    };
  }
}
