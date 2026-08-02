'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { SetupProgress } from '@moneypulse/shared';

/**
 * Fetch the authenticated user's setup-completeness (#224/#225/#230). Computed
 * on the fly server-side — no local caching beyond react-query's default.
 */
export function useSetupProgress() {
  return useQuery({
    queryKey: ['settings', 'setup-progress'],
    queryFn: () => api.get<{ data: SetupProgress }>('/settings/setup-progress'),
  });
}

/**
 * Dismiss the setup-completeness tracker (#224/#229/#235). Shared by every
 * surface that can dismiss it (settings card, dashboard banner) so they stay
 * in sync — both read the same `['settings', 'setup-progress']` query, which
 * this invalidates on success.
 */
export function useDismissSetupTracker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.patch('/users/settings', { setupTrackerDismissed: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'setup-progress'] });
    },
  });
}
