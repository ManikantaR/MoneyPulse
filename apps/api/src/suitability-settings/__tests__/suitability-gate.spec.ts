import { describe, it, expect } from 'vitest';
import { requireSuitability } from '../suitability-gate';

describe('requireSuitability — the 12.4 gate', () => {
  it('refuses and names exactly the missing setting when risk_tolerance is absent', () => {
    const settings = {
      version: 3,
      emergencyFundTargetMonths: 6,
      riskTolerance: null, // the one under test
    };

    const result = requireSuitability(settings, ['emergency_fund_target_months', 'risk_tolerance']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(['risk_tolerance']);
      expect(result.message).toBe('missing: risk_tolerance');
    }
  });

  it('refuses with all required fields listed when settings were never saved at all', () => {
    const result = requireSuitability(null, ['emergency_fund_target_months', 'risk_tolerance']);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(['emergency_fund_target_months', 'risk_tolerance']);
      expect(result.message).toContain('missing: emergency_fund_target_months, risk_tolerance');
    }
  });

  it('allows the recommendation and cites the policy version when everything required is present', () => {
    const settings = {
      version: 4,
      emergencyFundTargetMonths: 6,
      riskTolerance: 'moderate',
      targetAllocation: [{ assetClass: 'us_equity', targetPercent: 70 }],
    };

    const result = requireSuitability(settings, [
      'emergency_fund_target_months',
      'risk_tolerance',
      'target_allocation',
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policyVersion).toBe(4);
    }
  });

  it('treats an empty target_allocation list as missing (not merely present-but-empty)', () => {
    const settings = {
      version: 1,
      emergencyFundTargetMonths: 6,
      riskTolerance: 'moderate',
      targetAllocation: [],
    };

    const result = requireSuitability(settings, ['target_allocation']);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(['target_allocation']);
  });
});
