import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { query, getUserId } from '../db.js';

export function registerGetRecentAnomalies(server: McpServer) {
  server.tool(
    'get_recent_anomalies',
    'Unusual charges flagged by the anomaly engine in the last N days (large/duplicate/above-normal spend). Answers "any unusual charges lately" / "anything weird".',
    {
      days: z.number().min(1).max(90).default(30).describe('Look-back window in days'),
    },
    async (params) => {
      const userId = await getUserId();
      const rows = await query(
        `SELECT title, message, to_char(created_at, 'YYYY-MM-DD') AS on_date
         FROM notifications
         WHERE user_id = $2 AND type = 'spending_anomaly'
           AND created_at >= NOW() - make_interval(days => $1)
         ORDER BY created_at DESC
         LIMIT 25`,
        [params.days, userId],
      );

      if (rows.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: `No unusual charges flagged in the last ${params.days} days.` },
          ],
        };
      }

      const lines = rows.map((r) => `${r.on_date}: ${r.message}`);
      const text = [
        `${rows.length} unusual charge${rows.length === 1 ? '' : 's'} flagged in the last ${params.days} days:`,
        lines.join('\n'),
      ].join('\n');
      return { content: [{ type: 'text' as const, text }] };
    },
  );
}
