import { Injectable, Inject } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import { suitabilitySettings } from '../db/schema';
import type { SuitabilitySettingsInput } from '@moneypulse/shared';

export interface TargetAllocationEntry {
  assetClass: string;
  targetPercent: number;
}

export interface SuitabilitySettingsRow {
  id: string;
  version: number;
  emergencyFundTargetMonths: number;
  liquidityHorizonMonths: number | null;
  riskTolerance: string | null;
  taxState: string | null;
  monthlyInvestingTargetCents: number | null;
  targetAllocation: TargetAllocationEntry[];
  tickerAssetClassMap: Record<string, string>;
  dcaDayOfMonth: number | null;
  dcaAmountCents: number | null;
  createdAt: Date;
}

@Injectable()
export class SuitabilitySettingsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  private toRow(r: any): SuitabilitySettingsRow {
    return {
      id: r.id,
      version: r.version,
      emergencyFundTargetMonths: r.emergencyFundTargetMonths,
      liquidityHorizonMonths: r.liquidityHorizonMonths,
      riskTolerance: r.riskTolerance,
      taxState: r.taxState,
      monthlyInvestingTargetCents: r.monthlyInvestingTargetCents,
      targetAllocation: r.targetAllocation ?? [],
      tickerAssetClassMap: r.tickerAssetClassMap ?? {},
      dcaDayOfMonth: r.dcaDayOfMonth,
      dcaAmountCents: r.dcaAmountCents,
      createdAt: r.createdAt,
    };
  }

  /** The latest (current) version for the user, or null if none has ever been set. */
  async getCurrent(userId: string): Promise<SuitabilitySettingsRow | null> {
    const rows = await this.db
      .select()
      .from(suitabilitySettings)
      .where(eq(suitabilitySettings.userId, userId))
      .orderBy(desc(suitabilitySettings.version))
      .limit(1);
    return rows[0] ? this.toRow(rows[0]) : null;
  }

  /** Full version history, most recent first — so a recommendation can look up which
   *  version was in effect at a given point in time. */
  async getHistory(userId: string): Promise<SuitabilitySettingsRow[]> {
    const rows = await this.db
      .select()
      .from(suitabilitySettings)
      .where(eq(suitabilitySettings.userId, userId))
      .orderBy(desc(suitabilitySettings.version));
    return rows.map((r: any) => this.toRow(r));
  }

  /**
   * Insert a new version. Never mutates a prior row — this is the versioning
   * contract (12.4): a recommendation can always cite the exact version that was in
   * effect when it was made, and old versions remain queryable forever.
   */
  async createVersion(
    userId: string,
    input: SuitabilitySettingsInput,
  ): Promise<SuitabilitySettingsRow> {
    const current = await this.getCurrent(userId);
    const nextVersion = (current?.version ?? 0) + 1;

    const [row] = await this.db
      .insert(suitabilitySettings)
      .values({
        userId,
        version: nextVersion,
        emergencyFundTargetMonths: input.emergencyFundTargetMonths,
        liquidityHorizonMonths: input.liquidityHorizonMonths ?? null,
        riskTolerance: input.riskTolerance ?? null,
        taxState: input.taxState ?? null,
        monthlyInvestingTargetCents: input.monthlyInvestingTargetCents ?? null,
        targetAllocation: input.targetAllocation ?? [],
        tickerAssetClassMap: input.tickerAssetClassMap ?? {},
        dcaDayOfMonth: input.dcaDayOfMonth ?? null,
        dcaAmountCents: input.dcaAmountCents ?? null,
      })
      .returning();
    return this.toRow(row);
  }
}
