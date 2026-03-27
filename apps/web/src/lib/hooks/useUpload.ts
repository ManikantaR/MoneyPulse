'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { FileUpload } from '@moneypulse/shared';

/** Upload a bank statement file (CSV, Excel, PDF) for processing. */
export function useUploadFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('accountId', accountId);
      return api.upload<{ data: FileUpload }>('/ingestion/upload', formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
    },
  });
}

/** Fetch upload history for the current user. */
export function useUploads() {
  return useQuery({
    queryKey: ['uploads'],
    queryFn: () => api.get<{ data: FileUpload[] }>('/ingestion/uploads'),
  });
}
