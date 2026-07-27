import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import type {
  CreateManualAssetInput,
  UpdateManualAssetInput,
  PutManualAssetSnapshotInput,
} from '@moneypulse/shared';
import type { ManualAssetLiquidityClass, ManualAssetType } from '@moneypulse/shared';

/** Default classification per the Phase 13 spec — home/car/gold/other. Manual assets
 *  always count toward net worth but are never treated as liquid (epic #158 decision #7). */
const DEFAULT_CLASSIFICATION: Record<
  ManualAssetType,
  { liquidityClass: ManualAssetLiquidityClass; isDepreciating: boolean }
> = {
  home: { liquidityClass: 'illiquid', isDepreciating: false },
  car: { liquidityClass: 'illiquid', isDepreciating: true },
  gold: { liquidityClass: 'semi_liquid', isDepreciating: false },
  other: { liquidityClass: 'illiquid', isDepreciating: false },
};

export interface ManualAssetSnapshotView {
  snapshotMonth: string; // the requested month, YYYY-MM-01
  valueCents: number;
  source: string;
  notes: string | null;
  /** The month the returned value actually came from — differs from `snapshotMonth`
   *  when this is a carried-forward value (epic #158 decision #3). */
  asOfMonth: string;
  isCarriedForward: boolean;
}

/** CRUD + monthly snapshots for manual (non-account) net-worth assets: home, car, gold,
 *  other. User-scoped only — no household plumbing (epic #158 decision #5). */
@Injectable()
export class ManualAssetsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async findAll(userId: string) {
    return this.db
      .select()
      .from(schema.manualAssets)
      .where(and(eq(schema.manualAssets.userId, userId), isNull(schema.manualAssets.deletedAt)))
      .orderBy(asc(schema.manualAssets.name));
  }

  async create(userId: string, input: CreateManualAssetInput) {
    const defaults = DEFAULT_CLASSIFICATION[input.assetType];
    const rows = await this.db
      .insert(schema.manualAssets)
      .values({
        userId,
        name: input.name,
        assetType: input.assetType,
        liquidityClass: input.liquidityClass ?? defaults.liquidityClass,
        isDepreciating: input.isDepreciating ?? defaults.isDepreciating,
        notes: input.notes ?? null,
      })
      .returning();
    return rows[0];
  }

  private async requireOwned(id: string, userId: string) {
    const existing = await this.db
      .select()
      .from(schema.manualAssets)
      .where(and(eq(schema.manualAssets.id, id), eq(schema.manualAssets.userId, userId)))
      .limit(1);
    if (!existing[0] || existing[0].deletedAt) {
      throw new NotFoundException('Manual asset not found');
    }
    return existing[0];
  }

  async update(id: string, userId: string, input: UpdateManualAssetInput) {
    await this.requireOwned(id, userId);
    const rows = await this.db
      .update(schema.manualAssets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.manualAssets.id, id))
      .returning();
    return rows[0];
  }

  async remove(id: string, userId: string) {
    await this.requireOwned(id, userId);
    await this.db
      .update(schema.manualAssets)
      .set({ deletedAt: new Date() })
      .where(eq(schema.manualAssets.id, id));
    return { deleted: true };
  }

  /**
   * All explicit snapshots for an asset, most recent month first. Ownership-checked —
   * throws if the asset doesn't belong to `userId` (or is soft-deleted).
   */
  async listSnapshots(assetId: string, userId: string) {
    await this.requireOwned(assetId, userId);
    return this.db
      .select()
      .from(schema.manualAssetSnapshots)
      .where(eq(schema.manualAssetSnapshots.manualAssetId, assetId))
      .orderBy(desc(schema.manualAssetSnapshots.snapshotMonth));
  }

  /**
   * The value for `month`, with carry-forward: if there's no explicit snapshot for that
   * month, returns the most recent prior snapshot (any earlier month), tagged with its
   * actual "as of" month so the caller can badge staleness. Returns null only when there
   * is no snapshot for `month` or any earlier month.
   */
  async getSnapshotForMonth(
    assetId: string,
    userId: string,
    month: string,
  ): Promise<ManualAssetSnapshotView | null> {
    await this.requireOwned(assetId, userId);

    const exact = await this.db
      .select()
      .from(schema.manualAssetSnapshots)
      .where(
        and(
          eq(schema.manualAssetSnapshots.manualAssetId, assetId),
          eq(schema.manualAssetSnapshots.snapshotMonth, month),
        ),
      )
      .limit(1);
    if (exact[0]) {
      return {
        snapshotMonth: month,
        valueCents: exact[0].valueCents,
        source: exact[0].source,
        notes: exact[0].notes,
        asOfMonth: month,
        isCarriedForward: false,
      };
    }

    const prior = await this.db
      .select()
      .from(schema.manualAssetSnapshots)
      .where(
        and(
          eq(schema.manualAssetSnapshots.manualAssetId, assetId),
          lte(schema.manualAssetSnapshots.snapshotMonth, month),
        ),
      )
      .orderBy(desc(schema.manualAssetSnapshots.snapshotMonth))
      .limit(1);
    if (!prior[0]) return null;

    return {
      snapshotMonth: month,
      valueCents: prior[0].valueCents,
      source: prior[0].source,
      notes: prior[0].notes,
      asOfMonth: prior[0].snapshotMonth,
      isCarriedForward: true,
    };
  }

  /** Upsert the value for one month, keyed on (asset, month) per the unique index. */
  async upsertSnapshot(assetId: string, userId: string, month: string, input: PutManualAssetSnapshotInput) {
    await this.requireOwned(assetId, userId);

    const rows = await this.db
      .insert(schema.manualAssetSnapshots)
      .values({
        manualAssetId: assetId,
        snapshotMonth: month,
        valueCents: input.valueCents,
        source: input.source,
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.manualAssetSnapshots.manualAssetId, schema.manualAssetSnapshots.snapshotMonth],
        set: {
          valueCents: input.valueCents,
          source: input.source,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0];
  }
}
