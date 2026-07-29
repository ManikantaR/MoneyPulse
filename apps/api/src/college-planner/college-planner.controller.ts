import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CollegePlannerService } from './college-planner.service';

/** 40.4 — REST surface for the web UI's college/529 planner form. Mirrors the
 * `get_college_plan` MCP tool's inputs exactly (cents-based, same field names)
 * so both surfaces stay on the same locked formulas (see college-planner.service.ts). */
const collegePlannerSchema = z.object({
  currentAnnualCostCents: z.number().int().positive(),
  yearsUntilStart: z.number().int().min(0),
  programYears: z.number().int().positive().max(10).optional(),
  currentSavingsCents: z.number().int().min(0),
  tuitionInflationRateBps: z.number().min(0).max(2000).optional(),
  investmentReturnRateBps: z.number().min(0).max(3000).optional(),
  monthlyIncomeCapacityDuringSchoolCents: z.number().int().min(0).optional(),
});

export type CollegePlannerRequest = z.infer<typeof collegePlannerSchema>;

@ApiTags('College Planner')
@Controller('college-planner')
@UseGuards(JwtAuthGuard)
export class CollegePlannerController {
  private readonly service = new CollegePlannerService();

  /**
   * POST /college-planner/calculate — future college cost projection, required
   * monthly savings contribution, and the one-third-rule on-track check, from
   * user-entered dollar/rate figures. Pure calculation, no persistence.
   *
   * @param body - Validated user-entered cost/savings/rate figures.
   * @returns `{ data: CollegePlanResult }`
   */
  @Post('calculate')
  @ApiOperation({ summary: 'College/529 plan: projected cost, required savings, one-third rule' })
  calculate(
    @Body(new ZodValidationPipe(collegePlannerSchema)) body: CollegePlannerRequest,
  ) {
    try {
      const data = this.service.plan(body);
      return { data };
    } catch (err: any) {
      // The service's own guard clauses (kept for its non-HTTP callers, e.g. the
      // digest) throw plain Errors — surface those as 400s here rather than 500s.
      throw new BadRequestException(err.message);
    }
  }
}
