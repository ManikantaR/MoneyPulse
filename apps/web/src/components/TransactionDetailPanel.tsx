'use client';

import { useRef, useState } from 'react';
import { X, Paperclip, Download, Trash2, Upload, FileText, Camera, Scissors } from 'lucide-react';
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
} from '@/lib/hooks/useAttachments';
import { formatCents, formatDate } from '@/lib/format';
import { SplitTransactionEditor } from '@/components/SplitTransactionEditor';
import { CategoryCombobox } from '@/components/CategoryCombobox';
import type { CategoryOption } from '@/components/CategoryCombobox';
import type { Transaction, TransactionAttachment } from '@moneypulse/shared';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

interface TransactionDetailPanelProps {
  transaction: Transaction;
  categoryLabel?: string;
  accountLabel?: string;
  onClose: () => void;
  /** When provided, renders an inline category editor so mobile users can change the category. */
  categories?: CategoryOption[];
  onCategoryChange?: (transactionId: string, categoryId: string) => void;
}

/** Slide-over panel showing transaction details and attachment management. */
export function TransactionDetailPanel({
  transaction,
  categoryLabel,
  accountLabel,
  onClose,
  categories,
  onCategoryChange,
}: TransactionDetailPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [showSplitEditor, setShowSplitEditor] = useState(false);

  const { data, isLoading } = useAttachments(transaction.id);
  const uploadAttachment = useUploadAttachment();
  const deleteAttachment = useDeleteAttachment();

  const attachments: TransactionAttachment[] = data?.data ?? [];

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAttachment.mutate({ transactionId: transaction.id, file });
    e.target.value = '';
  }

  function handleDelete(id: string) {
    if (!window.confirm('Remove this attachment?')) return;
    deleteAttachment.mutate(id);
  }

  function isImage(mimeType: string) {
    return mimeType.startsWith('image/');
  }

  function downloadUrl(attachmentId: string) {
    return `${API_BASE}/attachments/${attachmentId}/download`;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transaction Details"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col bg-[var(--card)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border)] p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Transaction
            </p>
            <p className="mt-1 text-lg font-extrabold leading-tight">
              {transaction.description}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-[var(--muted)] transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Transaction info */}
        <div className="border-b border-[var(--border)] px-6 py-4 space-y-2">
          <DetailRow label="Date" value={formatDate(transaction.date)} />
          <DetailRow
            label="Amount"
            value={`${transaction.isCredit ? '+' : '-'}${formatCents(transaction.amountCents)}${transaction.originalAmountCents && transaction.currencyCode ? ` (${transaction.currencyCode} ${(transaction.originalAmountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })})` : ''}`}
          />
          {/* Category: editable combobox when categories are provided, otherwise static label */}
          {categories && onCategoryChange ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="shrink-0 text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
                Category
              </span>
              <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                <CategoryCombobox
                  categories={categories}
                  value={transaction.categoryId ?? ''}
                  onChange={(val) => onCategoryChange(transaction.id, val)}
                  placeholder="Uncategorized"
                  size="sm"
                  extraOptions={[{ value: '', label: 'Uncategorized' }]}
                />
              </div>
            </div>
          ) : categoryLabel ? (
            <DetailRow label="Category" value={categoryLabel} />
          ) : null}
          {accountLabel && <DetailRow label="Account" value={accountLabel} />}
          {transaction.merchantName && (
            <DetailRow label="Merchant" value={transaction.merchantName} />
          )}
          {transaction.isSplitParent ? (
            <span className="inline-flex items-center rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Split
            </span>
          ) : (
            <button
              onClick={() => setShowSplitEditor(true)}
              className="mt-1 flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--muted)] transition-colors"
            >
              <Scissors className="h-3.5 w-3.5" />
              Split
            </button>
          )}
        </div>

        {showSplitEditor ? (
          <SplitTransactionEditor
            transaction={transaction}
            onSuccess={() => {
              setShowSplitEditor(false);
              onClose();
            }}
            onCancel={() => setShowSplitEditor(false)}
          />
        ) : (
          <>
            {/* Attachments list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Attachments
          </p>

          {isLoading && (
            <p className="text-sm text-[var(--muted-foreground)]">
              Loading…
            </p>
          )}

          {!isLoading && attachments.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <Paperclip className="mx-auto h-6 w-6 text-[var(--muted-foreground)] opacity-40 mb-2" />
              <p className="text-sm text-[var(--muted-foreground)]">
                No attachments yet
              </p>
            </div>
          )}

          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)] px-3 py-2.5"
            >
              {/* Thumbnail or icon */}
              {isImage(att.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={downloadUrl(att.id)}
                  alt={att.originalFilename}
                  className="h-10 w-10 rounded-lg object-cover border border-[var(--border)]"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted)]">
                  <FileText className="h-5 w-5 text-[var(--muted-foreground)]" />
                </div>
              )}

              {/* File info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {att.originalFilename}
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {(att.sizeBytes / 1024).toFixed(1)} KB
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <a
                  href={downloadUrl(att.id)}
                  download={att.originalFilename}
                  className="rounded-lg p-1.5 hover:bg-[var(--muted)] transition-colors"
                  aria-label="Download"
                >
                  <Download className="h-4 w-4 text-[var(--muted-foreground)]" />
                </a>
                <button
                  onClick={() => handleDelete(att.id)}
                  disabled={deleteAttachment.isPending}
                  className="rounded-lg p-1.5 hover:bg-[var(--destructive)]/10 transition-colors disabled:opacity-50"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-[var(--destructive)]" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Upload area */}
        <div className="border-t border-[var(--border)] px-6 py-4 space-y-2">
          {uploadAttachment.isError && (
            <p className="text-xs text-[var(--destructive)]">
              Upload failed. Check file type and size (max 10 MB).
            </p>
          )}
          {uploadAttachment.isPending && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Uploading…
            </p>
          )}

          <div className="flex gap-2">
            {/* Standard file picker */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadAttachment.isPending}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              Upload file
            </button>

            {/* Camera capture (mobile) */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              disabled={uploadAttachment.isPending}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-sm font-semibold hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
              aria-label="Capture with camera"
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>

          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />

          <p className="text-center text-[10px] text-[var(--muted-foreground)]">
            PDF, PNG, JPG, WEBP, HEIC · Max 10 MB
          </p>
        </div>
          </>
        )}
      </div>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)] shrink-0">
        {label}
      </span>
      <span className="text-sm font-medium text-right truncate">{value}</span>
    </div>
  );
}
