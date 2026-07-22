'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  InvestmentHolding,
  AddHoldingInput,
  PortfolioValue,
  Allocation,
} from '@moneypulse/shared';

const KEYS = {
  holdings: (accountId: string) => ['investments', accountId, 'holdings'] as const,
  portfolioValue: ['investments', 'portfolio', 'value'] as const,
  allocation: ['investments', 'portfolio', 'allocation'] as const,
};

/** Holding history for a single investment account, newest as-of first. */
export function useHoldings(accountId: string) {
  return useQuery({
    queryKey: KEYS.holdings(accountId),
    queryFn: () => api.get<{ data: InvestmentHolding[] }>(`/investments/${accountId}/holdings`),
    select: (res) => res.data,
    enabled: Boolean(accountId),
  });
}

/** Declare a new holding (ticker + share count as-of a date). Append-only: this
 * always inserts a new row rather than editing an existing one. */
export function useAddHolding(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddHoldingInput) =>
      api.post<{ data: InvestmentHolding }>(`/investments/${accountId}/holdings`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.holdings(accountId) });
      qc.invalidateQueries({ queryKey: KEYS.portfolioValue });
      qc.invalidateQueries({ queryKey: KEYS.allocation });
    },
  });
}

/** Total portfolio market value (shares x latest EOD close) across all declared
 * holdings, with a per-holding breakdown. */
export function usePortfolioValue() {
  return useQuery({
    queryKey: KEYS.portfolioValue,
    queryFn: () => api.get<{ data: PortfolioValue }>('/investments/portfolio/value'),
    select: (res) => res.data,
  });
}

/** Portfolio allocation: percent of total market value held in each ticker. */
export function useAllocation() {
  return useQuery({
    queryKey: KEYS.allocation,
    queryFn: () => api.get<{ data: Allocation }>('/investments/portfolio/allocation'),
    select: (res) => res.data,
  });
}
