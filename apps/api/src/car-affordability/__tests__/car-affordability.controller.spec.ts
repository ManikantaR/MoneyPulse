import { describe, it, expect } from 'vitest';
import { CarAffordabilityController } from '../car-affordability.controller';

describe('CarAffordabilityController (40.4 REST surface)', () => {
  const controller = new CarAffordabilityController();

  it('converts dollar inputs to cents and returns a full result', () => {
    const { data } = controller.calculate({
      priceDollars: 30000,
      downPaymentDollars: 6000,
      loanTermMonths: 48,
      loanAprPercent: 6.5,
      grossMonthlyIncomeDollars: 8000,
      insuranceAmountDollars: 1200,
      insuranceFrequency: 'annual',
      maintenanceAmountDollars: 600,
      maintenanceFrequency: 'annual',
      annualMileage: 12000,
      mpg: 30,
      gasPriceDollarsPerGallon: 3.5,
      ownershipYears: 5,
      estimatedResaleValueDollars: 12000,
    });

    expect(data.rule204010).toBeDefined();
    expect(data.tco.monthlyLoanPaymentCents).toBeGreaterThan(0);
    expect(data.buyVsLease).toBeNull();
  });

  it('runs the buy-vs-lease comparison when lease fields are fully provided', () => {
    const { data } = controller.calculate({
      priceDollars: 30000,
      downPaymentDollars: 6000,
      loanTermMonths: 48,
      loanAprPercent: 6.5,
      grossMonthlyIncomeDollars: 8000,
      insuranceAmountDollars: 1200,
      insuranceFrequency: 'annual',
      maintenanceAmountDollars: 600,
      maintenanceFrequency: 'annual',
      annualMileage: 12000,
      mpg: 30,
      gasPriceDollarsPerGallon: 3.5,
      ownershipYears: 3,
      estimatedResaleValueDollars: 15000,
      leaseMonthlyPaymentDollars: 350,
      leaseDueAtSigningDollars: 2000,
      leaseTermMonths: 36,
    });

    expect(data.buyVsLease).not.toBeNull();
    expect(data.buyVsLease!.leaseTotalCostCents).toBeGreaterThan(0);
  });

  it('skips the buy-vs-lease comparison when lease fields are only partially provided', () => {
    const { data } = controller.calculate({
      priceDollars: 30000,
      downPaymentDollars: 6000,
      loanTermMonths: 48,
      loanAprPercent: 6.5,
      grossMonthlyIncomeDollars: 8000,
      insuranceAmountDollars: 1200,
      insuranceFrequency: 'annual',
      maintenanceAmountDollars: 600,
      maintenanceFrequency: 'annual',
      annualMileage: 12000,
      mpg: 30,
      gasPriceDollarsPerGallon: 3.5,
      ownershipYears: 3,
      estimatedResaleValueDollars: 15000,
      leaseMonthlyPaymentDollars: 350,
      // leaseDueAtSigningDollars / leaseTermMonths omitted
    });

    expect(data.buyVsLease).toBeNull();
  });
});
