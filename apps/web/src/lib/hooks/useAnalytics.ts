'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type QueryParams } from '../api';

/** Shared analytics query parameters for date range and account filtering. */
export interface AnalyticsParams extends QueryParams {
  from?: string;
  to?: string;
  accountId?: string;
  household?: boolean;
}

/** Single monthly income vs expense row returned by the API. */
export interface IncomeExpenseRow {
  month: string;
  incomeCents: number;
  expenseCents: number;
}

/** Single category breakdown row. */
export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  parentId: string | null;
  totalCents: number;
  transactionCount: number;
  percentage: number;
}

/** Single spending trend data point. */
export interface SpendingTrendPoint {
  period: string;
  income: number;
  expenses: number;
}

/** Account balance row. */
export interface AccountBalanceItem {
  accountId: string;
  nickname: string;
  institution: string;
  accountType: string;
  balanceCents: number;
}

/** Credit utilization row. */
export interface CreditUtilizationItem {
  accountId: string;
  nickname: string;
  balanceCents: number;
  limitCents: number;
  utilizationPercent: number;
}

/** Net worth aggregation. */
export interface NetWorthData {
  assets: number;
  liabilities: number;
  investments: number;
  netWorth: number;
}

/** Top merchant row. */
export interface TopMerchantItem {
  merchantName: string;
  totalCents: number;
  transactionCount: number;
}

/** Credit card payment row. */
export interface CreditCardPaymentItem {
  month: string;
  accountId: string;
  accountName: string;
  totalCents: number;
  paymentCount: number;
}

/** Budget vs actual progress per category. */
export interface BudgetProgressItem {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  budgetCents: number;
  spentCents: number;
  period: 'monthly' | 'weekly';
  percentUsed: number;
  remainingCents: number;
  status: 'on_track' | 'warning' | 'over_budget';
}

/** Fetch monthly income vs expenses for a date range. */
export function useIncomeVsExpenses(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'income-vs-expenses', params],
    queryFn: () =>
      api.get<{ data: IncomeExpenseRow[] }>('/analytics/income-vs-expenses', { params }),
  });
}

/** Fetch category-level spending breakdown. */
export function useCategoryBreakdown(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'category-breakdown', params],
    queryFn: () =>
      api.get<{ data: CategoryBreakdownItem[] }>('/analytics/category-breakdown', { params }),
  });
}

/** Fetch spending trend over time (daily/weekly/monthly). */
export function useSpendingTrend(
  params: AnalyticsParams & { granularity?: 'daily' | 'weekly' | 'monthly' } = {},
) {
  return useQuery({
    queryKey: ['analytics', 'spending-trend', params],
    queryFn: () =>
      api.get<{ data: SpendingTrendPoint[] }>('/analytics/spending-trend', { params }),
  });
}

/** Fetch current balances for all accounts. */
export function useAccountBalances(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'account-balances', params],
    queryFn: () =>
      api.get<{ data: AccountBalanceItem[] }>('/analytics/account-balances', { params }),
  });
}

/** Fetch credit utilization by card account. */
export function useCreditUtilization(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'credit-utilization', params],
    queryFn: () =>
      api.get<{ data: CreditUtilizationItem[] }>('/analytics/credit-utilization', { params }),
  });
}

/** Fetch net worth summary (assets - liabilities + investments). */
export function useNetWorth(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'net-worth', params],
    queryFn: () =>
      api.get<{ data: NetWorthData }>('/analytics/net-worth', { params }),
  });
}

/** Fetch top merchants by spend volume. */
export function useTopMerchants(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'top-merchants', params],
    queryFn: () =>
      api.get<{ data: TopMerchantItem[] }>('/analytics/top-merchants', { params }),
  });
}

/** Fetch monthly credit card payment totals per account. */
export function useCreditCardPayments(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'cc-payments', params],
    queryFn: () =>
      api.get<{ data: CreditCardPaymentItem[] }>('/analytics/cc-payments', { params }),
  });
}

/** Fetch budget vs actual spending progress per category (defaults to current month). */
export function useBudgetProgress(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'budget-progress', params],
    queryFn: () =>
      api.get<{ data: BudgetProgressItem[] }>('/analytics/budget-progress', { params }),
  });
}

/** Single point in the cash-flow forecast series. */
export interface ForecastPoint {
  date: string;
  projectedCents: number;
}

/** Per-account forecast result. */
export interface AccountForecast {
  accountId: string;
  accountName: string;
  series: ForecastPoint[];
  lowBalanceDate?: string;
}

/** Low-balance alert from the forecast. */
export interface ForecastAlert {
  accountId: string;
  date: string;
  projectedCents: number;
}

/** Full forecast result from the API. */
export interface ForecastData {
  accounts: AccountForecast[];
  netWorthSeries: ForecastPoint[];
  alerts: ForecastAlert[];
}

/** Fetch cash-flow forecast for the next 30, 60, or 90 days. */
export function useForecast(days: 30 | 60 | 90 = 90) {
  return useQuery({
    queryKey: ['analytics', 'forecast', days],
    queryFn: () =>
      api.get<{ data: ForecastData }>('/analytics/forecast', { params: { days } }),
  });
}

export interface BalanceHistoryPoint {
  date: string;
  balanceCents: number;
}

/** Fetch account balance history from stored snapshots. */
export function useBalanceHistory(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'balance-history', params],
    queryFn: () =>
      api.get<{ data: BalanceHistoryPoint[] }>('/analytics/balance-history', { params }),
  });
}

/** Single point in the trailing savings-rate series. */
export interface SavingsRatePoint {
  month: string;
  incomeCents: number;
  expenseCents: number;
  rate: number | null;
}

/** Savings-rate headline + trailing series. */
export interface SavingsRateData {
  current: SavingsRatePoint | null;
  series: SavingsRatePoint[];
}

/** Fetch the trailing monthly savings-rate series (default 12 months). */
export function useSavingsRate(params: AnalyticsParams & { months?: number } = {}) {
  return useQuery({
    queryKey: ['analytics', 'savings-rate', params],
    queryFn: () => api.get<{ data: SavingsRateData }>('/analytics/savings-rate', { params }),
  });
}

/** Cash runway: liquid balances / trailing-3-month avg expenses. */
export interface CashRunwayData {
  liquidCents: number;
  avgMonthlyExpenseCents: number;
  months: number | null;
}

/** Fetch the cash runway estimate. */
export function useCashRunway(params: AnalyticsParams = {}) {
  return useQuery({
    queryKey: ['analytics', 'cash-runway', params],
    queryFn: () => api.get<{ data: CashRunwayData }>('/analytics/cash-runway', { params }),
  });
}

/** 30/90/365-day net-worth deltas from stored balance snapshots. */
export interface NetWorthDeltas {
  current: number | null;
  delta30: number | null;
  delta90: number | null;
  delta365: number | null;
}

/** Fetch net-worth deltas. */
export function useNetWorthDeltas() {
  return useQuery({
    queryKey: ['analytics', 'net-worth-deltas'],
    queryFn: () => api.get<{ data: NetWorthDeltas }>('/analytics/net-worth-deltas'),
  });
}

/** Monthly recurring subscription total + 12-month trend. */
export interface SubscriptionTotalData {
  monthlyTotalCents: number;
  activeCount: number;
  trend: Array<{ month: string; totalCents: number }>;
}

/** Fetch the subscription-total headline stat. */
export function useSubscriptionTotal() {
  return useQuery({
    queryKey: ['analytics', 'subscription-total'],
    queryFn: () => api.get<{ data: SubscriptionTotalData }>('/analytics/subscription-total'),
  });
}
