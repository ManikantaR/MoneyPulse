import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerGetTransactions } from './tools/get-transactions.js';
import { registerSearchTransactions } from './tools/search-transactions.js';
import { registerSearchTransactionsSemantic } from './tools/search-transactions-semantic.js';
import { registerGetSpendingSummary } from './tools/get-spending-summary.js';
import { registerGetBudgetStatus } from './tools/get-budget-status.js';
import { registerGetAccountBalances } from './tools/get-account-balances.js';
import { registerGetCategoryBreakdown } from './tools/get-category-breakdown.js';
import { registerComparePeriods } from './tools/compare-periods.js';
import { registerGetRecurringExpenses } from './tools/get-recurring-expenses.js';
import { registerGetMerchantBreakdown } from './tools/get-merchant-breakdown.js';
import { registerGetCashflowSummary } from './tools/get-cashflow-summary.js';
import { registerGetIncomeBreakdown } from './tools/get-income-breakdown.js';
import { registerGetNetWorth } from './tools/get-net-worth.js';
import { registerGetUpcomingBills } from './tools/get-upcoming-bills.js';
import { registerGetSubscriptions } from './tools/get-subscriptions.js';
import { registerGetCashflowForecast } from './tools/get-cashflow-forecast.js';
import { registerGetCategoryTrend } from './tools/get-category-trend.js';
import { registerGetBudgetHistory } from './tools/get-budget-history.js';
import { registerGetRecentAnomalies } from './tools/get-recent-anomalies.js';
import { registerGetLoanStatus } from './tools/get-loan-status.js';
import { registerGetMarketContext } from './tools/get-market-context.js';
import { registerGetSavingsRate } from './tools/get-savings-rate.js';
import { registerGetCashRunway } from './tools/get-cash-runway.js';
import { registerGetEarnedApy } from './tools/get-earned-apy.js';
import { registerGetRateWatchlist } from './tools/get-rate-watchlist.js';
import { registerGetSubscriptionTotal } from './tools/get-subscription-total.js';
import { registerGetYoyComparison } from './tools/get-yoy-comparison.js';
import { registerGetPortfolioValue } from './tools/get-portfolio-value.js';
import { registerGetAllocation } from './tools/get-allocation.js';
import { registerGetMonthlyClose } from './tools/get-monthly-close.js';
import { registerGetFinancialHealth } from './tools/get-financial-health.js';
import { registerGetSafeToSpend } from './tools/get-safe-to-spend.js';
import { registerGetCollegePlan } from './tools/get-college-plan.js';
import { registerGetCarAffordability } from './tools/get-car-affordability.js';
import { close } from './db.js';
import http from 'node:http';

const server = new McpServer({
  name: 'moneypulse',
  version: '1.0.0',
});

registerGetTransactions(server);
registerSearchTransactions(server);
registerSearchTransactionsSemantic(server);
registerGetSpendingSummary(server);
registerGetBudgetStatus(server);
registerGetAccountBalances(server);
registerGetCategoryBreakdown(server);
registerComparePeriods(server);
registerGetRecurringExpenses(server);
registerGetMerchantBreakdown(server);
registerGetCashflowSummary(server);
registerGetIncomeBreakdown(server);
registerGetNetWorth(server);
registerGetUpcomingBills(server);
registerGetSubscriptions(server);
registerGetCashflowForecast(server);
registerGetCategoryTrend(server);
registerGetBudgetHistory(server);
registerGetRecentAnomalies(server);
registerGetLoanStatus(server);
registerGetMarketContext(server);
registerGetSavingsRate(server);
registerGetCashRunway(server);
registerGetEarnedApy(server);
registerGetRateWatchlist(server);
registerGetSubscriptionTotal(server);
registerGetYoyComparison(server);
registerGetPortfolioValue(server);
registerGetAllocation(server);
registerGetMonthlyClose(server);
registerGetFinancialHealth(server);
registerGetSafeToSpend(server);
registerGetCollegePlan(server);
registerGetCarAffordability(server);

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
