import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { sql, desc } from 'drizzle-orm';
import { encryptField, decryptField } from '../common/crypto';
import { costCentsFor } from './model-pricing';

export interface CreateAiLogDto {
  userId?: string;
  promptType: 'categorization' | 'pdf_parse' | 'advisor';
  model: string;
  inputText: string;
  outputText?: string;
  tokenCountIn?: number;
  tokenCountOut?: number;
  latencyMs?: number;
  transactionsCount?: number;
  categoriesAssigned?: number;
  avgConfidence?: number;
  piiDetected: boolean;
  piiTypesFound: string[];
}

@Injectable()
export class AiLogsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async create(dto: CreateAiLogDto) {
    const [row] = await this.db
      .insert(schema.aiPromptLogs)
      .values({
        userId: dto.userId ?? null,
        promptType: dto.promptType,
        model: dto.model,
        inputText: encryptField(dto.inputText),
        outputText: dto.outputText ? encryptField(dto.outputText) : null,
        tokenCountIn: dto.tokenCountIn ?? null,
        tokenCountOut: dto.tokenCountOut ?? null,
        latencyMs: dto.latencyMs ?? null,
        transactionsCount: dto.transactionsCount ?? null,
        categoriesAssigned: dto.categoriesAssigned ?? null,
        avgConfidence: dto.avgConfidence ?? null,
        piiDetected: dto.piiDetected,
        piiTypesFound: dto.piiTypesFound,
      })
      .returning();
    return row;
  }

  async findAll(params: {
    limit?: number;
    offset?: number;
    promptType?: string;
  }) {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions: any[] = [];
    if (params.promptType) {
      conditions.push(
        sql`${schema.aiPromptLogs.promptType} = ${params.promptType}`,
      );
    }

    const whereClause =
      conditions.length > 0
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

    const rows = await this.db.execute(sql`
      SELECT * FROM ${schema.aiPromptLogs}
      ${whereClause}
      ORDER BY ${schema.aiPromptLogs.createdAt} DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total FROM ${schema.aiPromptLogs} ${whereClause}
    `);

    const extractedRows = rows.rows ?? rows;
    const total = (countResult.rows ?? countResult)[0]?.total ?? 0;

    return {
      rows: extractedRows.map((r: any) => this.decryptLog(this.withCost(r))),
      total,
    };
  }

  async getStats() {
    const result = await this.db.execute(sql`
      SELECT
        prompt_type,
        model,
        COUNT(*)::int AS total_calls,
        ROUND(AVG(latency_ms))::int AS avg_latency_ms,
        ROUND(AVG(avg_confidence)::numeric, 2) AS avg_confidence,
        SUM(transactions_count)::int AS total_transactions,
        SUM(categories_assigned)::int AS total_categorized,
        SUM(CASE WHEN pii_detected THEN 1 ELSE 0 END)::int AS pii_detections,
        SUM(token_count_in)::int AS total_tokens_in,
        SUM(token_count_out)::int AS total_tokens_out,
        MIN(created_at) AS first_call,
        MAX(created_at) AS last_call
      FROM ${schema.aiPromptLogs}
      GROUP BY prompt_type, model
      ORDER BY total_calls DESC
    `);
    const rows = result.rows ?? result;
    // Cost is computed here, at query time, against the static price table —
    // never stored on the row — so historical costs stay accurate if prices
    // are corrected later.
    return rows.map((r: any) => ({
      ...r,
      total_cost_cents: costCentsFor(r.model, r.total_tokens_in, r.total_tokens_out),
    }));
  }

  /** Attach a per-row estimated cost (cents) computed from the price table. */
  private withCost(row: any) {
    if (!row) return row;
    return {
      ...row,
      cost_cents: costCentsFor(row.model, row.token_count_in, row.token_count_out),
    };
  }

  async getRecentPiiAlerts(limit = 20) {
    const result = await this.db.execute(sql`
      SELECT id, prompt_type, model, pii_types_found, created_at, user_id
      FROM ${schema.aiPromptLogs}
      WHERE pii_detected = true
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return result.rows ?? result;
  }

  private decryptLog(row: any) {
    if (!row) return row;
    return {
      ...row,
      input_text: decryptField(row.input_text),
      output_text: decryptField(row.output_text),
    };
  }
}
