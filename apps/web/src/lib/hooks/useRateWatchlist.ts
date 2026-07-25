'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { CreateRateWatchlistInput, UpdateRateWatchlistInput } from '@moneypulse/shared';

/** Mirrors RateWatchlistService#toRow on the API. */
export interface RateWatchlistEntry {
  id: string;
  institution: string;
  productType: string;
  apyBps: number;
  termMonths: number | null;
  notes: string | null;
  source: string;
  updatedAt: string;
  isStale: boolean;
}

/** Fetch the current user's rate watchlist (manual + Treasury-synced), sorted by APY desc. */
export function useRateWatchlist() {
  return useQuery({
    queryKey: ['rate-watchlist'],
    queryFn: () =>
      api.get<{ data: RateWatchlistEntry[]; staleDays: number }>('/rate-watchlist'),
  });
}

/** Add a manual watchlist entry (HYSA offer, CD, other bank product). */
export function useCreateRateWatchlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRateWatchlistInput) =>
      api.post<{ data: RateWatchlistEntry }>('/rate-watchlist', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-watchlist'] });
    },
  });
}

/** Update a manual watchlist entry. */
export function useUpdateRateWatchlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateRateWatchlistInput & { id: string }) =>
      api.patch<{ data: RateWatchlistEntry }>(`/rate-watchlist/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-watchlist'] });
    },
  });
}

/** Remove a manual watchlist entry. */
export function useDeleteRateWatchlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/rate-watchlist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rate-watchlist'] });
    },
  });
}
