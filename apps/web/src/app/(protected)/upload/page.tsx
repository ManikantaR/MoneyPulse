'use client';

import { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAccounts } from '@/lib/hooks/useAccounts';
import { useUploadFile, useUploads } from '@/lib/hooks/useUpload';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';

/** Upload page — drag-and-drop file upload with account selection and recent upload history. */
export default function UploadPage() {
  const [accountId, setAccountId] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const { data: accountsData } = useAccounts();
  const { data: uploadsData } = useUploads();
  const uploadMutation = useUploadFile();

  const accounts = accountsData?.data ?? [];
  const uploads = uploadsData?.data ?? [];

  /** Handle files from both drop and input events. */
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !accountId) return;
      Array.from(files).forEach((file) => {
        uploadMutation.mutate({ accountId, file });
      });
    },
    [accountId, uploadMutation],
  );

  /** Drag event handlers for the drop zone. */
  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }

  /** Status badge color and icon mapper. */
  function statusBadge(status: string) {
    switch (status) {
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-[var(--secondary)]">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed
          </span>
        );
      case 'processing':
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-[var(--destructive)]">
            <AlertCircle className="h-3.5 w-3.5" /> Failed
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-xs font-semibold text-[var(--muted-foreground)]">
            Pending
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-4xl font-extrabold tracking-tight">Upload Statements</h1>
        <p className="text-[var(--muted-foreground)]">
          Import CSV, Excel, or PDF bank statements
        </p>
      </div>

      {/* Account selector */}
      <div className="max-w-md">
        <label className="mb-1.5 block text-sm font-semibold">
          Select Account
        </label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]/30 transition-all"
        >
          <option value="">Choose an account...</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nickname} ({a.institution.toUpperCase()} ••{a.lastFour})
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-all',
          dragActive
            ? 'border-[var(--primary)] bg-[var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface-container-low)]',
          !accountId && 'pointer-events-none opacity-50',
        )}
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--card)] shadow-sm">
          <Upload className="h-8 w-8 text-[var(--muted-foreground)]" />
        </div>
        <p className="mb-1 text-sm font-semibold">
          Drag & drop files here, or{' '}
          <label className="cursor-pointer text-[var(--primary)] hover:underline">
            browse
            <input
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,.pdf"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              disabled={!accountId}
            />
          </label>
        </p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Supports CSV, Excel (.xlsx/.xls), PDF
        </p>

        {uploadMutation.isPending && (
          <div className="mt-4 flex items-center gap-2 text-sm text-[var(--primary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading...
          </div>
        )}
        {uploadMutation.isSuccess && (
          <p className="mt-4 text-sm text-[var(--secondary)]">Upload successful!</p>
        )}
        {uploadMutation.isError && (
          <p className="mt-4 text-sm text-[var(--destructive)]">
            {(uploadMutation.error as Error)?.message || 'Upload failed'}
          </p>
        )}
      </div>

      {/* Upload history */}
      {uploads.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold">Recent Uploads</h2>
          <div className="overflow-x-auto rounded-2xl bg-[var(--card)] shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-container-low)]/50 text-left">
                  <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">File</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Status</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Imported</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Skipped</th>
                  <th className="px-6 py-4 text-[10px] font-extrabold uppercase tracking-widest text-[var(--muted-foreground)]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {uploads.map((upload) => (
                  <tr
                    key={upload.id}
                    className="hover:bg-[var(--surface-container-low)] transition-colors"
                  >
                    <td className="px-6 py-4 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
                      <span className="font-medium">{upload.filename}</span>
                    </td>
                    <td className="px-6 py-4">{statusBadge(upload.status)}</td>
                    <td className="px-6 py-4 tabular-nums">{upload.rowsImported}</td>
                    <td className="px-6 py-4 tabular-nums">{upload.rowsSkipped}</td>
                    <td className="px-6 py-4 tabular-nums">{formatDate(upload.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
