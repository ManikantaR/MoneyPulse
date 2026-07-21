import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';

export type Decision =
  | 'accepted'
  | 'rejected'
  | 'dismissed'
  | 'snoozed'
  | 'not_applicable';

export interface PriorDecisionRecord {
  id?: string;
  decision: Decision | null;
  decisionReason?: string | null;
  calculationVersion?: string | null;
  snoozedUntil?: Date | string | null;
  decidedAt?: Date | string | null;
  /** Numeric inputs the recommendation was computed from, for tolerance comparison. */
  inputsFingerprint?: Record<string, number> | null;
}

export interface SuppressionCheckInput {
  priorDecision: PriorDecisionRecord | null;
  currentCalculationVersion: string;
  currentInputs: Record<string, number>;
  /** Absolute tolerance per input key; a key missing here defaults to 0 (any change re-raises). */
  toleranceByKey?: Record<string, number>;
  now?: Date;
}

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
}

/**
 * Decision-aware suppression (12.1): a `rejected`/`not_applicable` decision with
 * unchanged inputs (same `calculationVersion`, inputs within tolerance) means the
 * recommendation is suppressed on the next generation pass. A material input change
 * (any tracked input moving beyond its tolerance) re-raises it, citing the prior
 * decision. `snoozed` suppresses until `snoozedUntil` passes regardless of inputs.
 * Pure function — no DB access — so it's exhaustively unit-testable.
 */
export function evaluateSuppression(input: SuppressionCheckInput): SuppressionResult {
  const { priorDecision, currentCalculationVersion, currentInputs } = input;
  const now = input.now ?? new Date();
  const tolerance = input.toleranceByKey ?? {};

  if (!priorDecision || !priorDecision.decision) {
    return { suppressed: false };
  }

  if (priorDecision.decision === 'snoozed') {
    const until = priorDecision.snoozedUntil ? new Date(priorDecision.snoozedUntil) : null;
    if (until && until.getTime() > now.getTime()) {
      return { suppressed: true, reason: `Snoozed until ${until.toISOString()}.` };
    }
    return { suppressed: false };
  }

  if (priorDecision.decision !== 'rejected' && priorDecision.decision !== 'not_applicable') {
    return { suppressed: false };
  }

  if (priorDecision.calculationVersion !== currentCalculationVersion) {
    return { suppressed: false };
  }

  const priorInputs = priorDecision.inputsFingerprint ?? {};
  const changedKeys: string[] = [];
  const keys = new Set([...Object.keys(priorInputs), ...Object.keys(currentInputs)]);
  for (const key of keys) {
    const before = priorInputs[key] ?? 0;
    const after = currentInputs[key] ?? 0;
    const allowed = tolerance[key] ?? 0;
    if (Math.abs(after - before) > allowed) {
      changedKeys.push(key);
    }
  }

  if (changedKeys.length > 0) {
    return { suppressed: false };
  }

  const decidedDate = priorDecision.decidedAt ? new Date(priorDecision.decidedAt) : null;
  const when = decidedDate ? decidedDate.toISOString().slice(0, 10) : 'previously';
  return {
    suppressed: true,
    reason: `Suppressed: ${priorDecision.decision} on ${when}${
      priorDecision.decisionReason ? ` ("${priorDecision.decisionReason}")` : ''
    }; inputs unchanged since.`,
  };
}

/**
 * Thin DB-backed wrapper: looks up the most recent decided row for this user+type,
 * evaluates suppression, and — when suppressed — persists the reason on that row so
 * the suppression is auditable (`suppressed_reason`).
 */
@Injectable()
export class RecommendationSuppressionService {
  private readonly logger = new Logger(RecommendationSuppressionService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  async checkAndSuppress(
    userId: string,
    type: string,
    currentCalculationVersion: string,
    currentInputs: Record<string, number>,
    toleranceByKey?: Record<string, number>,
  ): Promise<SuppressionResult> {
    const rows = await this.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.type, type),
          isNotNull(schema.notifications.decision),
        ),
      )
      .orderBy(desc(schema.notifications.decidedAt))
      .limit(1);

    const prior = rows[0];
    const priorDecision: PriorDecisionRecord | null = prior
      ? {
          id: prior.id,
          decision: prior.decision,
          decisionReason: prior.decisionReason,
          calculationVersion: prior.calculationVersion,
          snoozedUntil: prior.snoozedUntil,
          decidedAt: prior.decidedAt,
          inputsFingerprint: (prior.data as any)?.inputsFingerprint ?? null,
        }
      : null;

    const result = evaluateSuppression({
      priorDecision,
      currentCalculationVersion,
      currentInputs,
      toleranceByKey,
    });

    if (result.suppressed && prior) {
      await this.db
        .update(schema.notifications)
        .set({ suppressedReason: result.reason })
        .where(eq(schema.notifications.id, prior.id));
      this.logger.log(`Suppressed "${type}" for user ${userId}: ${result.reason}`);
    }

    return result;
  }
}
