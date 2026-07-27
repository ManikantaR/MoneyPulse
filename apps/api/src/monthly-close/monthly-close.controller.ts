import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MonthlyCloseService } from './monthly-close.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { patchMonthlyCloseSchema } from '@moneypulse/shared';
import type { AuthTokenPayload, PatchMonthlyCloseInput } from '@moneypulse/shared';

@ApiTags('Monthly Close')
@Controller('monthly-close')
@UseGuards(JwtAuthGuard)
export class MonthlyCloseController {
  constructor(private readonly monthlyCloseService: MonthlyCloseService) {}

  @Get()
  @ApiOperation({ summary: 'List recent monthly closes (6–12 month grid)' })
  async findAll(@CurrentUser() user: AuthTokenPayload, @Query('months') months?: string) {
    const parsed = months ? parseInt(months, 10) : 12;
    return { data: await this.monthlyCloseService.findAll(user.sub, Number.isFinite(parsed) ? parsed : 12) };
  }

  @Get(':month')
  @ApiOperation({ summary: 'Get one month\'s close' })
  async findOne(@Param('month') month: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.monthlyCloseService.findOne(user.sub, month) };
  }

  @Post(':month/draft')
  @ApiOperation({ summary: 'Compute and persist a draft close for the month' })
  async draft(@Param('month') month: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.monthlyCloseService.draft(user.sub, month) };
  }

  @Post(':month/recalculate')
  @ApiOperation({ summary: 'Recompute an existing close against current data' })
  async recalculate(@Param('month') month: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.monthlyCloseService.recalculate(user.sub, month) };
  }

  @Patch(':month')
  @ApiOperation({ summary: 'Edit notes/fixed-expense/variable-expense on a close' })
  async patch(
    @Param('month') month: string,
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(patchMonthlyCloseSchema)) body: PatchMonthlyCloseInput,
  ) {
    return { data: await this.monthlyCloseService.patch(user.sub, month, body) };
  }

  @Post(':month/confirm')
  @ApiOperation({ summary: 'Confirm the close for the month' })
  async confirm(@Param('month') month: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.monthlyCloseService.confirm(user.sub, month) };
  }

  @Post(':month/reopen')
  @ApiOperation({ summary: 'Reopen a confirmed close back to draft' })
  async reopen(@Param('month') month: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.monthlyCloseService.reopen(user.sub, month) };
  }
}
