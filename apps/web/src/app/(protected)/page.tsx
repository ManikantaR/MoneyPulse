'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format, startOfMonth, subMonths } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowDownUp } from 'lucide-react';
import { PeriodSelector } from '@/components/PeriodSelector';
import { StatCard } from '@/components/charts/StatCard';
import { IncomeExpenseBar } from '@/components/charts/IncomeExpenseBar';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { SpendingTrendLine } from '@/components/charts/SpendingTrendLine';
import { AccountBalanceHistory } from '@/components/charts/AccountBalanceHistory';
import { AccountBalanceTrend } from '@/components/charts/AccountBalanceTrend';
import { CashFlowForecastChart } from '@/components/charts/CashFlowForecastChart';
import { CreditUtilization } from '@/components/charts/CreditUtilization';
import { NetWorthCard } from '@/components/charts/NetWorthCard';
import { TopMerchantsBar } from '@/components/charts/TopMerchantsBar';
import { TopTransactionsCard } from '@/components/charts/TopTransactionsCard';
import { CreditCardPaymentsTable } from '@/components/charts/CreditCardPaymentsTable';
import { NetWorthDrilldown } from '@/components/NetWorthDrilldown';
import { BudgetProgressCard } from '@/components/charts/BudgetProgressCard';
import {
  useIncomeVsExpenses,
  useCategoryBreakdown,
  useSpendingTrend,
  useAccountBalances,
  useCreditUtilization,
  useNetWorth,
  useTopMerchants,
  useCreditCardPayments,
  useBudgetProgress,
  useBalanceHistory,
  useForecast,
} from '@/lib/hooks/useAnalytics';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { UpcomingBillsCard } from '@/components/charts/UpcomingBillsCard';
import { useUpcomingBills } from '@/lib/hooks/useBills';
import { useSubscriptions } from '@/lib/hooks/useSubscriptions';
import { formatCents } from '@/lib/format';
import { Repeat } from 'lucide-react';

/** Dashboard page — main financial overview with KPI cards and charts. */
export default function DashboardPage() {
  // Period selector: default = start of current month → today
  const router = useRouter();
  const [from, setFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Trend always shows last 6 months regardless of period selector
  const trendFrom = format(subMonths(new Date(), 6), 'yyyy-MM-dd');
  const trendTo = format(new Date(), 'yyyy-MM-dd');

  // Drilldown slide-over state
  const [drilldown, setDrilldown] = useState<'assets' | 'liabilities' | null>(null);

  /** Navigate to transactions page with pre-filled filters for drill-down. */
  const drillTo = useCallback(
    (extra: Record<string, string>) => {
      const params = new URLSearchParams({ from, to, ...extra });
      router.push(`/transactions?${params.toString()}`);
    },
    [from, to, router],
  );

  const params = { from, to };

  const { data: incomeExpense, isLoading: ieLoading } = useIncomeVsExpenses(params);
  const { data: breakdown, isLoading: catLoading } = useCategoryBreakdown(params);
  const { data: trend, isLoading: trendLoading } = useSpendingTrend({ from: trendFrom, to: trendTo, granularity: 'monthly' });
  const { data: balances, isLoading: balLoading } = useAccountBalances(params);
  const { data: credit, isLoading: creditLoading } = useCreditUtilization(params);
  const { data: netWorthData, isLoading: nwLoading } = useNetWorth(params);
  const { data: merchants, isLoading: merchLoading } = useTopMerchants(params);
  const { data: ccPayments, isLoading: ccLoading } = useCreditCardPayments(params);
  const { data: upcomingBills } = useUpcomingBills();
  const { data: subscriptionsData } = useSubscriptions();
  const { data: budgetProgressData } = useBudgetProgress(params);
  // Balance history uses last 12 months to show a meaningful trend
  const balHistoryFrom = format(subMonths(new Date(), 12), 'yyyy-MM-dd');
  const { data: balanceHistory } = useBalanceHistory({ from: balHistoryFrom, to: trendTo });
  const { data: forecastData } = useForecast(90);
  const { data: topTxData, isLoading: topTxLoading } = useTransactions({
    from,
    to,
    sortBy: 'amount',
    sortOrder: 'desc',
    isCredit: 'false',
    excludeTransfers: 'true',
    pageSize: 10,
  });

  const nw = netWorthData?.data;

  /** Compute KPI totals from monthly income/expense rows. */
  const kpi = useMemo(() => {
    const rows = incomeExpense?.data;
    if (!rows || !Array.isArray(rows)) return null;
    const totalIncome = rows.reduce((s, r) => s + r.incomeCents, 0);
    const totalExpenses = rows.reduce((s, r) => s + r.expenseCents, 0);
    return { totalIncome, totalExpenses, net: totalIncome - totalExpenses };
  }, [incomeExpense]);

  /** Transform monthly income/expense rows for the bar chart. */
  const barData = useMemo(() => {
    const rows = incomeExpense?.data;
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map((r) => ({
      period: r.month,
      income: r.incomeCents,
      expenses: r.expenseCents,
    }));
  }, [incomeExpense]);

  const isLoading =
    ieLoading || catLoading || trendLoading || balLoading ||
    creditLoading || nwLoading || merchLoading || topTxLoading || ccLoading;

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-[var(--muted-foreground)]">Your financial overview at a glance</p>
        </div>
        <PeriodSelector
          from={from}
          to={to}
          onChange={(f, t) => { setFrom(f); setTo(t); }}
        />
      </div>

      {/* Net Worth — hero metric, clickable Assets & Liabilities */}
      {nw && (
        <NetWorthCard
          assets={nw.assets}
          liabilities={nw.liabilities}
          investments={nw.investments}
          netWorth={nw.netWorth}
          onClickAssets={() => setDrilldown('assets')}
          onClickLiabilities={() => setDrilldown('liabilities')}
        />
      )}

      {/* KPI Cards — 3 period-relative metrics (net worth is already above) */}
      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard
          title="Total Income"
          value={kpi ? formatCents(kpi.totalIncome) : '—'}
          icon={TrendingUp}
          accentColor="secondary"
          onClick={() => drillTo({ isCredit: 'true', excludeTransfers: 'true', drill: 'Total Income' })}
        />
        <StatCard
          title="Total Expenses"
          value={kpi ? formatCents(kpi.totalExpenses) : '—'}
          icon={TrendingDown}
          accentColor="danger"
          onClick={() => drillTo({ isCredit: 'false', excludeTransfers: 'true', drill: 'Total Expenses' })}
        />
        <StatCard
          title="Net Cash Flow"
          value={kpi ? formatCents(kpi.net) : '—'}
          icon={ArrowDownUp}
          accentColor="primary"
          onClick={() => drillTo({ excludeTransfers: 'true', drill: 'Net Cash Flow' })}
        />
      </div>

      {/* Where is my money going — Category breakdown + Top Merchants */}
      <div className="grid gap-6 lg:grid-cols-2">
        {breakdown?.data && (
          <CategoryDonut
            data={breakdown.data}
            onCategoryClick={(categoryId, categoryName) =>
              drillTo({
                // Analytics uses 'uncategorized' sentinel for null-category rows;
                // the transactions API expects '__uncategorized__' to filter by IS NULL.
                categoryId: categoryId === 'uncategorized' ? '__uncategorized__' : categoryId,
                drill: categoryName,
              })
            }
          />
        )}
        {merchants?.data && (
          <TopMerchantsBar
            data={merchants.data}
            onMerchantClick={(merchantName) =>
              drillTo({ search: merchantName, drill: merchantName })
            }
          />
        )}
      </div>

      {/* Big Spends + Spending Trend (trend always shows last 6 months) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <TopTransactionsCard transactions={topTxData?.data ?? []} />
        </div>
        <div className="lg:col-span-2">
          {trend?.data && <SpendingTrendLine data={trend.data} />}
        </div>
      </div>

      {/* Income vs Expenses bar + Account Balance History */}
      <div className="grid gap-6 lg:grid-cols-2">
        {barData.length > 0 && (
          <IncomeExpenseBar
            data={barData}
            onBarClick={(period) => {
              // period is "YYYY-MM"; compute month range
              const [y, m] = period.split('-');
              if (y && m) {
                const monthStart = `${y}-${m}-01`;
                const d = new Date(Number(y), Number(m), 0); // last day of month
                const monthEnd = format(d, 'yyyy-MM-dd');
                const params = new URLSearchParams({
                  from: monthStart,
                  to: monthEnd,
                  drill: `${period} transactions`,
                });
                router.push(`/transactions?${params.toString()}`);
              }
            }}
          />
        )}
        {balances?.data && <AccountBalanceHistory data={balances.data} />}
      </div>

      {/* Balance Trend — net balance over time from daily snapshots */}
      {balanceHistory?.data && (
        <AccountBalanceTrend data={balanceHistory.data} />
      )}

      {/* Cash-Flow Forecast — projected balance + alerts */}
      {forecastData?.data && (() => {
        const forecast = forecastData.data;
        const netSeries = forecast.netWorthSeries;
        const firstAlert = forecast.alerts[0];
        const netAccount = forecast.accounts[0];
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            <CashFlowForecastChart
              series={netSeries}
              lowBalanceDate={firstAlert?.date}
              title="Net Balance Forecast (90 days)"
            />
            {/* Projected balance summary widget */}
            <div className="flex flex-col justify-center rounded-2xl bg-[var(--surface-container-low)] p-6">
              <h3 className="mb-2 text-xl font-bold tracking-tight">Projected Balance</h3>
              {forecast.alerts.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">
                  ✅ On track for the next 90 days.
                </p>
              ) : (
                <ul className="space-y-2">
                  {forecast.alerts.map((a) => {
                    const acct = forecast.accounts.find((acc) => acc.accountId === a.accountId);
                    return (
                      <li key={a.accountId} className="flex items-start gap-2 text-sm">
                        <span className="mt-0.5 text-red-500">⚠</span>
                        <span>
                          <span className="font-semibold">{acct?.accountName ?? 'Account'}</span>{' '}
                          projected to drop below $1,000 by{' '}
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            {new Date(a.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>{' '}
                          ({formatCents(a.projectedCents)}).
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {netAccount && (
                <p className="mt-4 text-xs text-[var(--muted-foreground)]">
                  End of window: {formatCents(netSeries[netSeries.length - 1]?.projectedCents ?? 0)}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Credit Utilization + CC Payments */}
      <div className="grid gap-6 lg:grid-cols-2">
        {credit?.data && credit.data.length > 0 && (
          <CreditUtilization data={credit.data} />
        )}
        {ccPayments?.data && ccPayments.data.length > 0 && (
          <CreditCardPaymentsTable data={ccPayments.data} />
        )}
      </div>

      {/* Upcoming Bills widget */}
      {upcomingBills?.data && (
        <UpcomingBillsCard bills={upcomingBills.data} />
      )}

      {/* Subscriptions glance card */}
      {subscriptionsData?.data && subscriptionsData.data.length > 0 && (() => {
        const subs = subscriptionsData.data;
        const annualCents = subs.reduce((s, sub) => s + sub.annualCostCents, 0);
        const monthlyCents = Math.round(annualCents / 12);
        const priceAlerts = subs.filter((s) => s.priceIncreased).length;
        return (
          <StatCard
            title="Subscriptions"
            value={formatCents(monthlyCents) + '/mo'}
            subtitle={formatCents(annualCents) + '/yr · ' + subs.length + ' active' + (priceAlerts > 0 ? ` · ${priceAlerts} price alert${priceAlerts > 1 ? 's' : ''}` : '')}
            icon={Repeat}
            accentColor="primary"
            onClick={() => router.push('/subscriptions')}
          />
        );
      })()}

      {/* Budget Progress — top 5 by percentUsed, with link to /budgets */}
      {budgetProgressData?.data && budgetProgressData.data.length > 0 && (
        <BudgetProgressCard
          data={[...budgetProgressData.data]
            .sort((a, b) => b.percentUsed - a.percentUsed)
            .slice(0, 5)}
          showViewAll
        />
      )}

      {/* Loading spinner */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      )}

      {/* Assets / Liabilities drilldown slide-over */}
      {drilldown && balances?.data && (
        <NetWorthDrilldown
          type={drilldown}
          accounts={balances.data}
          onClose={() => setDrilldown(null)}
          from={from}
          to={to}
        />
      )}
    </div>
  );
}

