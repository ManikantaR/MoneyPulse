'use client';

import { useState, useMemo } from 'react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowDownUp, BarChart3 } from 'lucide-react';
import { PeriodSelector } from '@/components/PeriodSelector';
import { StatCard } from '@/components/charts/StatCard';
import { IncomeExpenseBar } from '@/components/charts/IncomeExpenseBar';
import { CategoryDonut } from '@/components/charts/CategoryDonut';
import { SpendingTrendLine } from '@/components/charts/SpendingTrendLine';
import { AccountBalanceHistory } from '@/components/charts/AccountBalanceHistory';
import { CreditUtilization } from '@/components/charts/CreditUtilization';
import { NetWorthCard } from '@/components/charts/NetWorthCard';
import { TopMerchantsBar } from '@/components/charts/TopMerchantsBar';
import {
  useIncomeVsExpenses,
  useCategoryBreakdown,
  useSpendingTrend,
  useAccountBalances,
  useCreditUtilization,
  useNetWorth,
  useTopMerchants,
} from '@/lib/hooks/useAnalytics';
import { formatCents } from '@/lib/format';

/** Dashboard page — main financial overview with KPI cards and charts. */
export default function DashboardPage() {
  const [from, setFrom] = useState(
    format(startOfMonth(new Date()), 'yyyy-MM-dd'),
  );
  const [to, setTo] = useState(
    format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  );

  const params = { from, to };

  const { data: incomeExpense, isLoading: ieLoading } = useIncomeVsExpenses(params);
  const { data: breakdown, isLoading: catLoading } = useCategoryBreakdown(params);
  const { data: trend, isLoading: trendLoading } = useSpendingTrend({ ...params, granularity: 'monthly' });
  const { data: balances, isLoading: balLoading } = useAccountBalances(params);
  const { data: credit, isLoading: creditLoading } = useCreditUtilization(params);
  const { data: netWorthData, isLoading: nwLoading } = useNetWorth(params);
  const { data: merchants, isLoading: merchLoading } = useTopMerchants(params);

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

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-4xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-[var(--muted-foreground)]">
            Your financial overview at a glance
          </p>
        </div>
        <PeriodSelector
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Income"
          value={kpi ? formatCents(kpi.totalIncome) : '—'}
          icon={TrendingUp}
          accentColor="secondary"
        />
        <StatCard
          title="Total Expenses"
          value={kpi ? formatCents(kpi.totalExpenses) : '—'}
          icon={TrendingDown}
          accentColor="danger"
        />
        <StatCard
          title="Net"
          value={kpi ? formatCents(kpi.net) : '—'}
          icon={ArrowDownUp}
          accentColor="primary"
        />
        <StatCard
          title="Net Worth"
          value={nw ? formatCents(nw.netWorth) : '—'}
          icon={BarChart3}
          accentColor="primary"
        />
      </div>

      {/* Net Worth Card */}
      {nw && (
        <NetWorthCard
          assets={nw.assets}
          liabilities={nw.liabilities}
          investments={nw.investments}
          netWorth={nw.netWorth}
        />
      )}

      {/* Main Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {trend?.data && <SpendingTrendLine data={trend.data} />}
        {breakdown?.data && <CategoryDonut data={breakdown.data} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {barData.length > 0 && <IncomeExpenseBar data={barData} />}
        {merchants?.data && <TopMerchantsBar data={merchants.data} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {balances?.data && <AccountBalanceHistory data={balances.data} />}
        {credit?.data && <CreditUtilization data={credit.data} />}
      </div>

      {/* Loading states */}
      {(ieLoading || catLoading || trendLoading || balLoading || creditLoading || nwLoading || merchLoading) && (
        <div className="flex items-center justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--primary)] border-t-transparent" />
        </div>
      )}
    </div>
  );
}
