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
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completed
          </span>
        );
      case 'processing':
        return (
          <span className="flex items-center gap-1 text-xs font-medium text-amber-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-xs font-medium text-red-500">
            <AlertCircle className="h-3.5 w-3.5" /> Failed
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            Pending
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Upload Statements</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Import CSV, Excel, or PDF bank statements
        </p>
      </div>

      {/* Account selector */}
      <div className="max-w-md">
        <label className="mb-1.5 block text-sm font-medium">
          Select Account
        </label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm"
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
          'flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors',
          dragActive
            ? 'border-[var(--primary)] bg-[var(--accent)]'
            : 'border-[var(--border)] bg-[var(--card)]',
          !accountId && 'opacity-50 pointer-events-none',
        )}
      >
        <Upload className="mb-4 h-10 w-10 text-[var(--muted-foreground)]" />
        <p className="mb-1 text-sm font-medium">
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
          <p className="mt-4 text-sm text-emerald-500">Upload successful!</p>
        )}
        {uploadMutation.isError && (
          <p className="mt-4 text-sm text-red-500">
            {(uploadMutation.error as Error)?.message || 'Upload failed'}
          </p>
        )}
      </div>

      {/* Upload history */}
      {uploads.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Recent Uploads</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">File</th>
                  <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Status</th>
                  <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Imported</th>
                  <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Skipped</th>
                  <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">Date</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((upload) => (
                  <tr
                    key={upload.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-3 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
                      {upload.filename}
                    </td>
                    <td className="px-4 py-3">{statusBadge(upload.status)}</td>
                    <td className="px-4 py-3 tabular-nums">{upload.rowsImported}</td>
                    <td className="px-4 py-3 tabular-nums">{upload.rowsSkipped}</td>
                    <td className="px-4 py-3 tabular-nums">{formatDate(upload.createdAt)}</td>
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
