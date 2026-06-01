'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { SubscriptionItem } from '@moneypulse/shared';

/** Fetch active recurring bills projected as subscriptions with annualized cost. */
export function useSubscriptions() {
  return useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.get<{ data: SubscriptionItem[] }>('/subscriptions'),
  });
}
