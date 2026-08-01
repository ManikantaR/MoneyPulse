'use client';

import { useQuery } from '@tanstack/react-query';
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
