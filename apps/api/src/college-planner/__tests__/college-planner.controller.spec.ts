import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CollegePlannerController } from '../college-planner.controller';

describe('CollegePlannerController (40.4 REST surface)', () => {
  const controller = new CollegePlannerController();

  it('returns a full college plan for valid input', () => {
    const { data } = controller.calculate({
      currentAnnualCostCents: 3_000_000,
      yearsUntilStart: 10,
      currentSavingsCents: 500_000,
    });

    expect(data.requiredMonthlyContributionCents).not.toBeNull();
    expect(data.oneThirdRule).toBeDefined();
    expect(data.yearlyCosts.length).toBe(4); // default programYears
  });

  it('maps the service"s guard-clause errors to 400 Bad Request', () => {
    expect(() =>
      controller.calculate({
        currentAnnualCostCents: 3_000_000,
        yearsUntilStart: 10,
        currentSavingsCents: 500_000,
        programYears: 0 as unknown as number, // bypasses the DTO's positive() at the type level
      }),
    ).toThrow(BadRequestException);
  });
});
