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
      return api.upload<{ data: FileUpload }>('/uploads', formData);
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
    queryFn: () => api.get<{ data: FileUpload[] }>('/uploads'),
  });
}

/** Fetch a single upload by ID with polling while processing. */
export function useUploadDetail(id: string) {
  return useQuery({
    queryKey: ['uploads', id],
    queryFn: () => api.get<{ data: FileUpload }>(`/uploads/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      return status === 'pending' || status === 'processing' ? 2000 : false;
    },
  });
}

/** Delete an upload and its associated transactions. */
export function useDeleteUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) =>
      api.delete<{ deleted: boolean }>(`/uploads/${uploadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploads'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
