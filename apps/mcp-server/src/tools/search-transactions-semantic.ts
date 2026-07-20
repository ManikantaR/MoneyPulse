import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

const EMBEDDING_MODEL = 'nomic-embed-text';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { embedding?: number[] };
    return Array.isArray(data.embedding) ? data.embedding : null;
  } catch {
    return null;
  }
}

/**
 * LOCAL-ONLY semantic transaction search backed by pgvector + Ollama
 * embeddings (11.10). Returns raw transaction rows — same row-level class as
 * `search_transactions` — so it is deliberately NOT added to
 * `AGGREGATE_TOOL_ALLOWLIST` in apps/api/src/advisor/mcp-client.service.ts
 * and must never reach the cloud advisor. Local MCP consumers (e.g. the web
 * app's own MCP client) only.
 */
export function registerSearchTransactionsSemantic(server: McpServer) {
  server.tool(
    'search_transactions_semantic',
    'ROW-LEVEL/LOCAL-ONLY: semantic (meaning-based) search over transaction descriptions, ' +
      'e.g. "coffee near the airport". Uses local Ollama embeddings + pgvector nearest-neighbor. ' +
      'Never exposed to the cloud advisor.',
    {
      query: z.string().min(1).describe('Natural-language search text'),
      limit: z.number().min(1).max(50).default(10).describe('Max results'),
    },
    async (params) => {
      const userId = await getUserId();
      const vector = await embedQuery(params.query);
      if (!vector) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Semantic search unavailable (Ollama unreachable). Try search_transactions for keyword search instead.',
            },
          ],
        };
      }
      const vectorLiteral = `[${vector.join(',')}]`;

      const rows = await query(
        `SELECT t.date, t.description, t.merchant_name, t.amount_cents, t.is_credit,
                c.name AS category, a.nickname AS account,
                (te.embedding <=> $1::vector) AS distance
         FROM transaction_embeddings te
         JOIN transactions t ON t.id = te.transaction_id
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         WHERE t.is_split_parent = false
           AND t.deleted_at IS NULL
           AND t.user_id = $3
         ORDER BY te.embedding <=> $1::vector
         LIMIT $2`,
        [vectorLiteral, params.limit, userId],
      );

      const text = rows
        .map(
          (r: any) =>
            `${r.date.toISOString().slice(0, 10)} | ${r.is_credit ? '+' : '-'}$${(r.amount_cents / 100).toFixed(2)} | ${r.description} | ${r.merchant_name || ''} | ${r.category || 'Uncategorized'} | ${r.account} | similarity=${(1 - r.distance).toFixed(3)}`,
        )
        .join('\n');

      return {
        content: [{ type: 'text' as const, text: text || 'No matching transactions.' }],
      };
    },
  );
}
