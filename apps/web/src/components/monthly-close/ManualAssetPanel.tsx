'use client';

import { useState } from 'react';
import {
  useManualAssets,
  useUpsertManualAssetSnapshot,
  useCreateManualAsset,
} from '@/lib/hooks/useMonthlyClose';
import type { ManualAssetType } from '@moneypulse/shared';

const ASSET_TYPES: { value: ManualAssetType; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'car', label: 'Car' },
  { value: 'gold', label: 'Gold' },
  { value: 'other', label: 'Other' },
];

/** Form to create a new manual asset (name + type) and, optionally, seed its
 *  initial value for the current month. Shown both when the list is empty and as
 *  a persistent "+ Add asset" action, since a household can have more than one
 *  home/car. */
function AddAssetForm({ month, onDone }: { month: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [assetType, setAssetType] = useState<ManualAssetType>('home');
  const [value, setValue] = useState('');
  const createAsset = useCreateManualAsset();
  const upsertSnapshot = useUpsertManualAssetSnapshot();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const dollars = value.trim() === '' ? null : parseFloat(value);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) return;

    const created = await createAsset.mutateAsync({ name: trimmed, assetType });
    if (dollars !== null) {
      await upsertSnapshot.mutateAsync({
        assetId: created.data.id,
        month,
        valueCents: Math.round(dollars * 100),
        source: 'manual',
      });
    }
    setName('');
    setValue('');
    setAssetType('home');
    onDone();
  };

  const pending = createAsset.isPending || upsertSnapshot.isPending;

  return (
    <div className="mb-3 space-y-2 rounded-md border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Home, Honda Civic)"
          className="min-w-[10rem] flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
        />
        <select
          value={assetType}
          onChange={(e) => setAssetType(e.target.value as ManualAssetType)}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
        >
          {ASSET_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value (optional)"
          className="w-32 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm tabular-nums"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending || !name.trim()}
          className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          Add asset
        </button>
        <button onClick={onDone} className="text-xs text-[var(--muted-foreground)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

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
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4" data-testid="manual-asset-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">Manual Assets</h3>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]"
          >
            + Add asset
          </button>
        )}
      </div>
      {adding && <AddAssetForm month={month} onDone={() => setAdding(false)} />}
      {isLoading && <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}
      {!isLoading && assets.length === 0 && !adding && (
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
