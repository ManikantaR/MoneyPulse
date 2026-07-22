import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RateWatchlistService } from './rate-watchlist.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createRateWatchlistSchema,
  updateRateWatchlistSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateRateWatchlistInput,
  UpdateRateWatchlistInput,
} from '@moneypulse/shared';

@ApiTags('Rate Watchlist')
@Controller('rate-watchlist')
@UseGuards(JwtAuthGuard)
export class RateWatchlistController {
  constructor(private readonly service: RateWatchlistService) {}

  @Get()
  @ApiOperation({ summary: 'List rate-watchlist entries for the current user' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.service.findAll(user.sub), staleDays: this.service.getStaleDays() };
  }

  @Post()
  @ApiOperation({ summary: 'Add a candidate parking-spot rate' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createRateWatchlistSchema)) body: CreateRateWatchlistInput,
  ) {
    return { data: await this.service.create(user.sub, body) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a rate-watchlist entry' })
  async update(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRateWatchlistSchema)) body: UpdateRateWatchlistInput,
  ) {
    return { data: await this.service.update(user.sub, id, body) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a rate-watchlist entry' })
  async remove(@CurrentUser() user: AuthTokenPayload, @Param('id') id: string) {
    await this.service.remove(user.sub, id);
    return { data: { removed: true } };
  }

  @Post('sync-treasury')
  @ApiOperation({ summary: 'Auto-populate/refresh Treasury-sourced watchlist rows' })
  async syncTreasury(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.service.syncTreasuryRows(user.sub) };
  }
}
