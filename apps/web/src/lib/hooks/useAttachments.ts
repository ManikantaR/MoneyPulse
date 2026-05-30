'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { TransactionAttachment } from '@moneypulse/shared';

export interface AttachmentListResponse {
  data: TransactionAttachment[];
}

/** Fetch all attachments for a transaction. Only runs when transactionId is provided. */
export function useAttachments(transactionId: string | undefined) {
  return useQuery({
    queryKey: ['attachments', transactionId],
    queryFn: () =>
      api.get<AttachmentListResponse>(
        `/transactions/${transactionId}/attachments`,
      ),
    enabled: !!transactionId,
  });
}

/** Upload a file as an attachment to a transaction. */
export function useUploadAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      transactionId,
      file,
    }: {
      transactionId: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload<{ data: TransactionAttachment }>(
        `/transactions/${transactionId}/attachments`,
        formData,
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['attachments', vars.transactionId],
      });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

/** Delete an attachment by ID. */
export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ data: { deleted: boolean } }>(`/attachments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
