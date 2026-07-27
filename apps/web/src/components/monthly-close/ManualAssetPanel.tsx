'use client';

import { useState } from 'react';
import { useManualAssets, useUpsertManualAssetSnapshot } from '@/lib/hooks/useMonthlyClose';

/** Inline month editor + staleness badge for one manual asset (home/car/gold/other).
 *  Carry-forward means a missing month isn't an error — it's just stale (epic #158
 *  decision #3), so this only warns, it never blocks. */
function AssetRow({ assetId, name, month }: { assetId: string; name: string; month: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const upsert = useUpsertManualAssetSnapshot();

  const submit = async () => {
    const dollars = parseFloat(value);
    if (!Number.isFinite(dollars) || dollars < 0) return;
    await upsert.mutateAsync({
      assetId,
      month,
      valueCents: Math.round(dollars * 100),
      source: 'manual',
    });
    setEditing(false);
    setValue('');
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 last:border-0">
      <span className="text-sm font-medium">{name}</span>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm tabular-nums"
            placeholder="0.00"
          />
          <button
            onClick={submit}
            disabled={upsert.isPending}
            className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-[var(--muted-foreground)]">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]"
        >
          Edit {month.slice(0, 7)}
        </button>
      )}
    </div>
  );
}

/** Manual asset panel: home/car/gold values with inline month editing. Staleness
 *  (missing months) is surfaced via the close's `freshness.missingManualAssets`,
 *  not recomputed here. */
export function ManualAssetPanel({
  month,
  missingManualAssets,
}: {
  month: string;
  missingManualAssets: string[];
}) {
  const { data, isLoading } = useManualAssets();
  const assets = data?.data ?? [];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4" data-testid="manual-asset-panel">
      <h3 className="mb-2 font-bold">Manual Assets</h3>
      {isLoading && <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}
      {!isLoading && assets.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">
          No manual assets tracked yet (home, car, gold).
        </p>
      )}
      {assets.map((asset) => {
        const stale = missingManualAssets.includes(asset.id);
        return (
          <div key={asset.id}>
            {stale && (
              <span className="mb-1 inline-block rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                Stale — carried forward
              </span>
            )}
            <AssetRow assetId={asset.id} name={asset.name} month={month} />
          </div>
        );
      })}
    </div>
  );
}
