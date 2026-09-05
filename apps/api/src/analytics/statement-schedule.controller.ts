import { Controller, Get, Put, Post, Param, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod/v4';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AccountsService } from '../accounts/accounts.service';
import { StatementScheduleService } from './statement-schedule.service';
import type { AuthTokenPayload } from '@moneypulse/shared';

const upsertScheduleSchema = z.object({
  cadence: z.enum(['monthly', 'weekly', 'biweekly', 'custom']),
  expectedDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  cadenceDays: z.number().int().min(1).nullable().optional(),
  graceDays: z.number().int().min(0).max(60).optional(),
  enabled: z.boolean().optional(),
});

const snoozeSchema = z.object({
  days: z.number().int().min(1).max(365),
});

@ApiTags('Statement Schedule')
@Controller('accounts/:id/statement-schedule')
@UseGuards(JwtAuthGuard)
export class StatementScheduleController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly statementScheduleService: StatementScheduleService,
  ) {}

  private async assertOwnership(id: string, userId: string) {
    const account = await this.accountsService.findById(id);
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Account not found');
    }
  }

  @Get()
  @ApiOperation({ summary: "Get an account's statement schedule" })
  async get(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    await this.assertOwnership(id, user.sub);
    const schedule = await this.statementScheduleService.getSchedule(id);
    return { data: schedule };
  }

  @Put()
  @ApiOperation({ summary: "Manually set an account's statement schedule" })
  async upsert(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertScheduleSchema)) body: z.infer<typeof upsertScheduleSchema>,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    await this.assertOwnership(id, user.sub);
    const schedule = await this.statementScheduleService.upsertManual(id, body);
    return { data: schedule };
  }

  @Post('snooze')
  @ApiOperation({ summary: 'Snooze overdue alerts for an account for N days' })
  async snooze(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(snoozeSchema)) body: z.infer<typeof snoozeSchema>,
    @CurrentUser() user: AuthTokenPayload,
  ) {
    await this.assertOwnership(id, user.sub);
    const schedule = await this.statementScheduleService.snooze(id, body.days);
    return { data: schedule };
  }
}
