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
