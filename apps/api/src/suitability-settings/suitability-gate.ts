/**
 * 12.4 — the suitability gate.
 *
 * Any FUTURE suitability-dependent recommendation logic (which vehicle to use, how
 * much to invest — e.g. the Investment Coach, #122) must call `requireSuitability`
 * before proposing a recommendation. It never guesses a missing setting: it returns
 * a result stating exactly which field(s) are absent so the caller can produce a
 * "missing setting" output instead of fabricating advice (Phase 12 principle #4).
 *
 * This module has no DB/Nest dependency on purpose — it is a pure function over a
 * plain settings object so #122 (and its tests) can call it without standing up the
 * full service/DI graph.
 */

export type SuitabilityField =
  | 'emergency_fund_target_months'
  | 'risk_tolerance'
  | 'tax_state'
  | 'target_allocation'
  | 'liquidity_horizon_months'
  | 'monthly_investing_target_cents'
  | 'dca_day_of_month';

/** Loose shape so this works against both the Drizzle-shaped service row and plain
 *  test fixtures — mirrors the RecommendationEvidenceFields pattern from 12.1. */
export interface SuitabilitySettingsLike {
  version?: number;
  emergencyFundTargetMonths?: number | null;
  liquidityHorizonMonths?: number | null;
  riskTolerance?: string | null;
  taxState?: string | null;
  monthlyInvestingTargetCents?: number | null;
  targetAllocation?: Array<{ assetClass: string; targetPercent: number }> | null;
  dcaDayOfMonth?: number | null;
}

export type SuitabilityGateResult =
  | { ok: true; policyVersion: number }
  | { ok: false; missing: SuitabilityField[]; message: string };

/**
 * `settings` is null when the user has never saved any suitability settings at all.
 * `required` lets a caller ask only for the fields it actually needs (e.g. the
 * Investment Coach's "which vehicle" question needs risk_tolerance + target
 * allocation but not the DCA fields) — defaults to the fields every suitability
 * question needs at minimum: emergency-fund target and risk tolerance.
 */
export function requireSuitability(
  settings: SuitabilitySettingsLike | null | undefined,
  required: SuitabilityField[] = ['emergency_fund_target_months', 'risk_tolerance'],
): SuitabilityGateResult {
  if (!settings) {
    return {
      ok: false,
      missing: [...required],
      message: `missing: ${required.join(', ')} (no suitability settings have been saved yet)`,
    };
  }

  const missing: SuitabilityField[] = [];
  for (const field of required) {
    if (!isPresent(settings, field)) missing.push(field);
  }

  if (missing.length > 0) {
    return { ok: false, missing, message: `missing: ${missing.join(', ')}` };
  }

  return { ok: true, policyVersion: settings.version ?? 0 };
}

function isPresent(settings: SuitabilitySettingsLike, field: SuitabilityField): boolean {
  switch (field) {
    case 'emergency_fund_target_months':
      return (
        settings.emergencyFundTargetMonths !== null &&
        settings.emergencyFundTargetMonths !== undefined
      );
    case 'risk_tolerance':
      return !!settings.riskTolerance;
    case 'tax_state':
      return !!settings.taxState;
    case 'target_allocation':
      return Array.isArray(settings.targetAllocation) && settings.targetAllocation.length > 0;
    case 'liquidity_horizon_months':
      return (
        settings.liquidityHorizonMonths !== null && settings.liquidityHorizonMonths !== undefined
      );
    case 'monthly_investing_target_cents':
      // Nullable-by-design (null = "let the coach propose from surplus") — presence
      // means the field has been explicitly saved at all, i.e. a settings row exists.
      // Callers that truly require a user-fixed amount should check the value
      // themselves; this gate only confirms the settings object was saved.
      return true;
    case 'dca_day_of_month':
      return settings.dcaDayOfMonth !== null && settings.dcaDayOfMonth !== undefined;
    default:
      return false;
  }
}
