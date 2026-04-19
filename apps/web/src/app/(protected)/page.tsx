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
import { CreditUtilization } from '@/components/charts/CreditUtilization';
import { NetWorthCard } from '@/components/charts/NetWorthCard';
import { TopMerchantsBar } from '@/components/charts/TopMerchantsBar';
import { TopTransactionsCard } from '@/components/charts/TopTransactionsCard';
import { NetWorthDrilldown } from '@/components/NetWorthDrilldown';
import {
  useIncomeVsExpenses,
  useCategoryBreakdown,
  useSpendingTrend,
  useAccountBalances,
  useCreditUtilization,
  useNetWorth,
  useTopMerchants,
} from '@/lib/hooks/useAnalytics';
import { useTransactions } from '@/lib/hooks/useTransactions';
import { formatCents } from '@/lib/format';

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
  const { data: topTxData, isLoading: topTxLoading } = useTransactions({
    from,
    to,
    sortBy: 'amount',
    sortOrder: 'asc',
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
    creditLoading || nwLoading || merchLoading || topTxLoading;

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
          onClick={() => drillTo({ isCredit: 'true', drill: 'Total Income' })}
        />
        <StatCard
          title="Total Expenses"
          value={kpi ? formatCents(kpi.totalExpenses) : '—'}
          icon={TrendingDown}
          accentColor="danger"
          onClick={() => drillTo({ isCredit: 'false', drill: 'Total Expenses' })}
        />
        <StatCard
          title="Net Cash Flow"
          value={kpi ? formatCents(kpi.net) : '—'}
          icon={ArrowDownUp}
          accentColor="primary"
          onClick={() => drillTo({ drill: 'Net Cash Flow' })}
        />
      </div>

      {/* Where is my money going — Category breakdown + Top Merchants */}
      <div className="grid gap-6 lg:grid-cols-2">
        {breakdown?.data && (
          <CategoryDonut
            data={breakdown.data}
            onCategoryClick={(categoryId, categoryName) =>
              drillTo({ categoryId, drill: categoryName })
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

      {/* Credit Utilization */}
      {credit?.data && credit.data.length > 0 && (
        <CreditUtilization data={credit.data} />
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

