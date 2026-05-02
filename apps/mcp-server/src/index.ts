import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerGetTransactions } from './tools/get-transactions.js';
import { registerSearchTransactions } from './tools/search-transactions.js';
import { registerGetSpendingSummary } from './tools/get-spending-summary.js';
import { registerGetBudgetStatus } from './tools/get-budget-status.js';
import { registerGetAccountBalances } from './tools/get-account-balances.js';
import { registerGetCategoryBreakdown } from './tools/get-category-breakdown.js';
import { registerComparePeriods } from './tools/compare-periods.js';
import { registerGetRecurringExpenses } from './tools/get-recurring-expenses.js';
import { close } from './db.js';
import http from 'node:http';

const server = new McpServer({
  name: 'moneypulse',
  version: '1.0.0',
});

registerGetTransactions(server);
registerSearchTransactions(server);
registerGetSpendingSummary(server);
registerGetBudgetStatus(server);
registerGetAccountBalances(server);
registerGetCategoryBreakdown(server);
registerComparePeriods(server);
registerGetRecurringExpenses(server);

const mode = process.argv.includes('--sse') ? 'sse' : 'stdio';

if (mode === 'sse') {
  const PORT = Number(process.env.MCP_PORT) || 3100;
  let sseTransport: SSEServerTransport | null = null;

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/sse') {
      sseTransport = new SSEServerTransport('/messages', res);
      await server.connect(sseTransport);
    } else if (req.method === 'POST' && req.url === '/messages') {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.writeHead(400);
        res.end('No SSE connection');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  httpServer.listen(PORT, () => {
    console.error(`MCP SSE server listening on port ${PORT}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP stdio server running');
}

process.on('SIGINT', async () => {
  await close();
  process.exit(0);
});
