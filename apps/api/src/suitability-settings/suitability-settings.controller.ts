import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SuitabilitySettingsService } from './suitability-settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { suitabilitySettingsInputSchema } from '@moneypulse/shared';
import type { AuthTokenPayload, SuitabilitySettingsInput } from '@moneypulse/shared';

@ApiTags('Suitability Settings')
@Controller('suitability-settings')
@UseGuards(JwtAuthGuard)
export class SuitabilitySettingsController {
  constructor(private readonly service: SuitabilitySettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Current (latest-version) suitability settings for the user' })
  async getCurrent(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.service.getCurrent(user.sub) };
  }

  @Get('history')
  @ApiOperation({ summary: 'Full version history of suitability settings, newest first' })
  async getHistory(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.service.getHistory(user.sub) };
  }

  @Put()
  @ApiOperation({
    summary: 'Save suitability settings — always creates a new version, never overwrites',
  })
  async save(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(suitabilitySettingsInputSchema)) body: SuitabilitySettingsInput,
  ) {
    return { data: await this.service.createVersion(user.sub, body) };
  }
}
