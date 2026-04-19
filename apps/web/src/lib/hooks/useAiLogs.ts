'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type QueryParams } from '../api';

export interface AiLogEntry {
  id: string;
  user_id: string | null;
  prompt_type: 'categorization' | 'pdf_parse';
  model: string;
  input_text: string;
  output_text: string | null;
  token_count_in: number | null;
  token_count_out: number | null;
  latency_ms: number | null;
  transactions_count: number | null;
  categories_assigned: number | null;
  avg_confidence: number | null;
  pii_detected: boolean;
  pii_types_found: string[];
  created_at: string;
}

export interface AiModelStats {
  prompt_type: string;
  model: string;
  total_calls: number;
  avg_latency_ms: number;
  avg_confidence: number | null;
  total_transactions: number;
  total_categorized: number;
  pii_detections: number;
  first_call: string;
  last_call: string;
}

export interface AiPiiAlert {
  id: string;
  prompt_type: string;
  model: string;
  pii_types_found: string[];
  created_at: string;
  user_id: string | null;
}

export function useAiLogs(params?: {
  limit?: number;
  offset?: number;
  promptType?: string;
}) {
  return useQuery({
    queryKey: ['ai-logs', params],
    queryFn: () =>
      api.get<{ data: AiLogEntry[]; total: number }>('/ai-logs', {
        params: {
          limit: params?.limit,
          offset: params?.offset,
          promptType: params?.promptType,
        } as QueryParams,
      }),
  });
}

export function useAiLogsStats() {
  return useQuery({
    queryKey: ['ai-logs', 'stats'],
    queryFn: () => api.get<{ data: AiModelStats[] }>('/ai-logs/stats'),
  });
}

export function useAiLogsPiiAlerts(limit = 20) {
  return useQuery({
    queryKey: ['ai-logs', 'pii-alerts', limit],
    queryFn: () =>
      api.get<{ data: AiPiiAlert[] }>('/ai-logs/pii-alerts', {
        params: { limit },
      }),
  });
}
