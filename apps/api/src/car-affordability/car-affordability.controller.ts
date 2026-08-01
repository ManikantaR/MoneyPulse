import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { calculateCarAffordability } from './car-affordability.service';

/**
 * 40.4 — REST surface for the web UI's car-affordability form. All figures are
 * user-entered dollars (see car-affordability.service.ts's header comment: this
 * engine is deliberately DB-free and LLM-free, so the frontend supplies gross
 * monthly income and gas price directly rather than the API re-resolving them —
 * avoiding a second, drift-prone copy of the paycheck-profile/EIA lookups that
 * already live in the `get_car_affordability` MCP tool).
 */
const carAffordabilitySchema = z.object({
  priceDollars: z.number().positive(),
  downPaymentDollars: z.number().min(0),
  loanTermMonths: z.number().int().positive(),
  loanAprPercent: z.number().min(0),
  grossMonthlyIncomeDollars: z.number().positive(),
  insuranceAmountDollars: z.number().min(0),
  insuranceFrequency: z.enum(['annual', 'monthly']).default('annual'),
  maintenanceAmountDollars: z.number().min(0),
  maintenanceFrequency: z.enum(['annual', 'monthly']).default('annual'),
  annualMileage: z.number().min(0),
  mpg: z.number().positive(),
  gasPriceDollarsPerGallon: z.number().positive(),
  ownershipYears: z.number().positive(),
  estimatedResaleValueDollars: z.number().min(0),
  leaseMonthlyPaymentDollars: z.number().min(0).optional(),
  leaseDueAtSigningDollars: z.number().min(0).optional(),
  leaseTermMonths: z.number().int().positive().optional(),
});

export type CarAffordabilityRequest = z.infer<typeof carAffordabilitySchema>;

const toCents = (dollars: number) => Math.round(dollars * 100);

@ApiTags('Car Affordability')
@Controller('car-affordability')
@UseGuards(JwtAuthGuard)
export class CarAffordabilityController {
  /**
   * POST /car-affordability/calculate — 20/4/10 rule + TCO + optional buy-vs-lease,
   * from user-entered dollar figures. Pure calculation, no persistence.
   *
   * @param body - Validated user-entered vehicle/loan/insurance/maintenance figures.
   * @returns `{ data: CarAffordabilityResult }`
   */
  @Post('calculate')
  @ApiOperation({ summary: 'Car affordability: 20/4/10 rule + TCO + buy-vs-lease' })
  calculate(
    @Body(new ZodValidationPipe(carAffordabilitySchema)) body: CarAffordabilityRequest,
  ) {
    const hasLease =
      body.leaseMonthlyPaymentDollars != null &&
      body.leaseDueAtSigningDollars != null &&
      body.leaseTermMonths != null;

    const data = calculateCarAffordability({
      priceCents: toCents(body.priceDollars),
      downPaymentCents: toCents(body.downPaymentDollars),
      loanTermMonths: body.loanTermMonths,
      loanAprBps: Math.round(body.loanAprPercent * 100),
      grossMonthlyIncomeCents: toCents(body.grossMonthlyIncomeDollars),
      insurance: {
        amountCents: toCents(body.insuranceAmountDollars),
        frequency: body.insuranceFrequency,
      },
      maintenance: {
        amountCents: toCents(body.maintenanceAmountDollars),
        frequency: body.maintenanceFrequency,
      },
      annualMileage: body.annualMileage,
      mpg: body.mpg,
      gasPriceCentsPerGallon: toCents(body.gasPriceDollarsPerGallon),
      ownershipYears: body.ownershipYears,
      estimatedResaleValueCents: toCents(body.estimatedResaleValueDollars),
      lease: hasLease
        ? {
            monthlyPaymentCents: toCents(body.leaseMonthlyPaymentDollars!),
            dueAtSigningCents: toCents(body.leaseDueAtSigningDollars!),
            termMonths: body.leaseTermMonths!,
          }
        : undefined,
    });

    return { data };
  }
}
