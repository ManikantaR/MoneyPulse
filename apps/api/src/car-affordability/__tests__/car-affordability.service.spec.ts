import {
  amortizedMonthlyPaymentCents,
  calculateCarAffordability,
  calculateTco,
  compareBuyVsLease,
  evaluateRule204010,
  remainingLoanBalanceCents,
  toMonthlyCents,
  totalLoanInterestCents,
  CarAffordabilityInput,
} from '../car-affordability.service';

function baseInput(
  overrides: Partial<CarAffordabilityInput> = {},
): CarAffordabilityInput {
  return {
    priceCents: 3_000_000, // $30,000
    downPaymentCents: 600_000, // $6,000 = 20%
    loanTermMonths: 48,
    loanAprBps: 600, // 6% APR
    grossMonthlyIncomeCents: 800_000, // $8,000/mo gross
    insurance: { amountCents: 120_000, frequency: 'annual' }, // $1,200/yr
    maintenance: { amountCents: 60_000, frequency: 'annual' }, // $600/yr
    annualMileage: 12_000,
    mpg: 30,
    gasPriceCentsPerGallon: 350, // $3.50/gal
    ownershipYears: 4,
    estimatedResaleValueCents: 1_200_000, // $12,000 after 4 years
    ...overrides,
  };
}

describe('toMonthlyCents', () => {
  it('divides an annual figure by 12', () => {
    expect(toMonthlyCents({ amountCents: 120_000, frequency: 'annual' })).toBe(10_000);
  });

  it('passes a monthly figure through unchanged', () => {
    expect(toMonthlyCents({ amountCents: 10_000, frequency: 'monthly' })).toBe(10_000);
  });
});

describe('amortizedMonthlyPaymentCents', () => {
  it('matches the hand-worked standard amortization formula (5-year, $20k, 5% APR)', () => {
    // M = P*r(1+r)^n / ((1+r)^n - 1); r = 0.05/12, n = 60, P = $20,000
    const payment = amortizedMonthlyPaymentCents(2_000_000, 500, 60);
    expect(payment).toBe(37_742); // $377.42/mo, verified against a standard loan calculator
  });

  it('degrades to a straight-line split at 0% APR', () => {
    expect(amortizedMonthlyPaymentCents(1_200_000, 0, 12)).toBe(100_000);
  });

  it('returns 0 for a non-positive principal or term', () => {
    expect(amortizedMonthlyPaymentCents(0, 500, 60)).toBe(0);
    expect(amortizedMonthlyPaymentCents(2_000_000, 500, 0)).toBe(0);
  });
});

describe('totalLoanInterestCents', () => {
  it('is 0 when there is no principal financed', () => {
    expect(totalLoanInterestCents(0, 500, 48)).toBe(0);
  });

  it('is positive whenever principal and APR are positive', () => {
    expect(totalLoanInterestCents(2_000_000, 500, 60)).toBeGreaterThan(0);
  });
});

describe('evaluateRule204010', () => {
  it('passes all three legs for a well-within-budget scenario', () => {
    const result = evaluateRule204010({
      priceCents: 3_000_000,
      downPaymentCents: 600_000, // exactly 20%
      loanTermMonths: 48,
      totalMonthlyVehicleCostCents: 700_000, // way under 10% of $8,000/mo... (see below)
      grossMonthlyIncomeCents: 8_000_000, // $80,000/mo gross, so 10% = $8,000
    });
    expect(result.downPaymentPassed).toBe(true);
    expect(result.downPaymentPercent).toBeCloseTo(0.2);
    expect(result.loanTermPassed).toBe(true);
    expect(result.monthlyCostPassed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('fails the down-payment leg below 20%', () => {
    const result = evaluateRule204010({
      priceCents: 3_000_000,
      downPaymentCents: 300_000, // 10%
      loanTermMonths: 48,
      totalMonthlyVehicleCostCents: 10_000,
      grossMonthlyIncomeCents: 8_000_000,
    });
    expect(result.downPaymentPassed).toBe(false);
    expect(result.downPaymentRequiredCents).toBe(600_000);
    expect(result.passed).toBe(false);
  });

  it('fails the loan-term leg above 48 months', () => {
    const result = evaluateRule204010({
      priceCents: 3_000_000,
      downPaymentCents: 600_000,
      loanTermMonths: 60,
      totalMonthlyVehicleCostCents: 10_000,
      grossMonthlyIncomeCents: 8_000_000,
    });
    expect(result.loanTermPassed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails the 10%-of-income leg when vehicle costs are too high', () => {
    const result = evaluateRule204010({
      priceCents: 3_000_000,
      downPaymentCents: 600_000,
      loanTermMonths: 48,
      totalMonthlyVehicleCostCents: 90_000, // $900/mo
      grossMonthlyIncomeCents: 800_000, // $8,000/mo → cap is $800/mo
    });
    expect(result.monthlyCostPassed).toBe(false);
    expect(result.maxMonthlyCostCents).toBe(80_000);
    expect(result.monthlyCostPercent).toBeCloseTo(0.1125);
    expect(result.passed).toBe(false);
  });

  it('fails closed (never claims a pass) when gross income is unknown', () => {
    const result = evaluateRule204010({
      priceCents: 3_000_000,
      downPaymentCents: 600_000,
      loanTermMonths: 48,
      totalMonthlyVehicleCostCents: 10_000,
      grossMonthlyIncomeCents: 0,
    });
    expect(result.monthlyCostPassed).toBe(false);
    expect(result.monthlyCostPercent).toBeNull();
    expect(result.maxMonthlyCostCents).toBeNull();
    expect(result.passed).toBe(false);
  });
});

describe('calculateTco', () => {
  it('produces a hand-worked breakdown for the base fixture', () => {
    const tco = calculateTco(baseInput());
    // Principal = $30,000 - $6,000 = $24,000 financed over 48mo @ 6% APR.
    expect(tco.loanPrincipalCents).toBe(2_400_000);
    expect(tco.monthlyLoanPaymentCents).toBeGreaterThan(0);
    // Fuel: 12,000mi / 30mpg = 400gal/yr * $3.50 = $1,400/yr → $116.67/mo → rounds to 11,667c
    expect(tco.monthlyFuelCents).toBe(11_667);
    expect(tco.monthlyInsuranceCents).toBe(10_000); // $1,200/yr / 12
    expect(tco.monthlyMaintenanceCents).toBe(5_000); // $600/yr / 12
    expect(tco.ownershipMonths).toBe(48);
    // Financing cash out over 4yr ownership = down payment + all 48 loan payments
    // (loan term == ownership window here).
    expect(tco.totalFinancingCashOutCents).toBe(
      600_000 + tco.monthlyLoanPaymentCents * 48,
    );
    expect(tco.totalCostOfOwnershipCents).toBe(
      tco.totalFinancingCashOutCents +
        tco.totalInsuranceCents +
        tco.totalMaintenanceCents +
        tco.totalFuelCents -
        tco.estimatedResaleValueCents,
    );
  });

  it('only counts loan interest for the financed portion when ownership is shorter than the loan', () => {
    const tco = calculateTco(baseInput({ loanTermMonths: 60, ownershipYears: 3 }));
    expect(tco.ownershipMonths).toBe(36);
    // Only 36 of the 60 scheduled payments happen inside the 3-year ownership window.
    expect(tco.totalFinancingCashOutCents).toBe(
      600_000 + tco.monthlyLoanPaymentCents * 36,
    );
  });

  it('treats a 0-mile/0-mpg edge case as 0 fuel cost, not NaN or a divide-by-zero', () => {
    const tco = calculateTco(baseInput({ annualMileage: 0, mpg: 0 }));
    expect(tco.monthlyFuelCents).toBe(0);
    expect(Number.isFinite(tco.totalCostOfOwnershipCents)).toBe(true);
  });

  it('handles an all-cash purchase (no loan) with 0 financing interest', () => {
    const tco = calculateTco(baseInput({ downPaymentCents: 3_000_000, loanTermMonths: 48 }));
    expect(tco.loanPrincipalCents).toBe(0);
    expect(tco.monthlyLoanPaymentCents).toBe(0);
    expect(tco.ownershipLoanInterestCents).toBe(0);
  });
});

describe('compareBuyVsLease', () => {
  const tcoTerms = {
    priceCents: 3_000_000,
    downPaymentCents: 600_000,
    loanTermMonths: 48,
    loanAprBps: 600,
    estimatedResaleValueCents: 1_200_000,
    ownershipYears: 4,
  };

  it('favors leasing when the lease is clearly cheaper', () => {
    const result = compareBuyVsLease(tcoTerms, {
      monthlyPaymentCents: 20_000, // $200/mo, well under the loan payment
      dueAtSigningCents: 200_000,
      termMonths: 36,
    });
    expect(result.cheaperOption).toBe('lease');
    expect(result.costDifferenceCents).toBeLessThan(0);
  });

  it('favors buying when the lease due-at-signing and payments are steep', () => {
    const result = compareBuyVsLease(tcoTerms, {
      monthlyPaymentCents: 90_000, // $900/mo, far above the loan payment
      dueAtSigningCents: 500_000,
      termMonths: 36,
    });
    expect(result.cheaperOption).toBe('buy');
    expect(result.costDifferenceCents).toBeGreaterThan(0);
  });

  it('prorates resale value linearly at the comparison horizon', () => {
    const result = compareBuyVsLease(tcoTerms, {
      monthlyPaymentCents: 0,
      dueAtSigningCents: 0,
      termMonths: 24, // half of the 48-month ownership window
    });
    // Depreciation over 4yr = $30,000 - $12,000 = $18,000; half that at 24mo = $9,000
    // → resale value at 24mo = $30,000 - $9,000 = $21,000. But the loan isn't paid
    // off at 24 of 48 months — buy's actual equity is resale MINUS the remaining
    // loan balance at that point, not the full resale value.
    const monthlyPayment = amortizedMonthlyPaymentCents(2_400_000, 600, 48);
    const remainingBalance = remainingLoanBalanceCents(2_400_000, 600, 48, 24);
    const equity = Math.max(0, 2_100_000 - remainingBalance);
    expect(result.buyTotalCostCents).toBe(600_000 + monthlyPayment * 24 - equity);
  });

  it('credits full resale value as equity once the loan is fully paid off by the comparison end', () => {
    // Comparison term (48mo) equals the loan term, so remaining balance is zero
    // and buy's equity should equal the full resale value — matches the old
    // (pre-fix) behavior exactly in the fully-paid-off case.
    const result = compareBuyVsLease(tcoTerms, {
      monthlyPaymentCents: 0,
      dueAtSigningCents: 0,
      termMonths: 48,
    });
    const monthlyPayment = amortizedMonthlyPaymentCents(2_400_000, 600, 48);
    expect(result.buyTotalCostCents).toBe(
      600_000 + monthlyPayment * 48 - 1_200_000,
    );
  });
});

describe('calculateCarAffordability', () => {
  it('assembles rule204010 + tco + buyVsLease from a single input', () => {
    const result = calculateCarAffordability(
      baseInput({
        lease: { monthlyPaymentCents: 40_000, dueAtSigningCents: 300_000, termMonths: 36 },
      }),
    );
    expect(result.rule204010).toBeDefined();
    expect(result.tco).toBeDefined();
    expect(result.buyVsLease).not.toBeNull();
  });

  it('omits buyVsLease when no lease terms are supplied', () => {
    const result = calculateCarAffordability(baseInput());
    expect(result.buyVsLease).toBeNull();
  });

  it('feeds the TCO monthly total (loan + insurance + maintenance + fuel) into the 20/4/10 income test', () => {
    const input = baseInput();
    const result = calculateCarAffordability(input);
    const tco = calculateTco(input);
    const expectedMonthlyTotal =
      tco.monthlyLoanPaymentCents +
      tco.monthlyInsuranceCents +
      tco.monthlyMaintenanceCents +
      tco.monthlyFuelCents;
    const expected = evaluateRule204010({
      priceCents: input.priceCents,
      downPaymentCents: input.downPaymentCents,
      loanTermMonths: input.loanTermMonths,
      totalMonthlyVehicleCostCents: expectedMonthlyTotal,
      grossMonthlyIncomeCents: input.grossMonthlyIncomeCents,
    });
    expect(result.rule204010).toEqual(expected);
  });
});
