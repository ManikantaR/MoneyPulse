import { Controller, Get, Post, Patch, Delete, Put, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ManualAssetsService } from './manual-assets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createManualAssetSchema,
  updateManualAssetSchema,
  putManualAssetSnapshotSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateManualAssetInput,
  UpdateManualAssetInput,
  PutManualAssetSnapshotInput,
} from '@moneypulse/shared';

@ApiTags('Manual Assets')
@Controller('manual-assets')
@UseGuards(JwtAuthGuard)
export class ManualAssetsController {
  constructor(private readonly manualAssetsService: ManualAssetsService) {}

  @Get()
  @ApiOperation({ summary: 'List manual assets (home/car/gold/other) for the current user' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.manualAssetsService.findAll(user.sub) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual asset' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createManualAssetSchema)) body: CreateManualAssetInput,
  ) {
    return { data: await this.manualAssetsService.create(user.sub, body) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a manual asset' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(updateManualAssetSchema)) body: UpdateManualAssetInput,
  ) {
    return { data: await this.manualAssetsService.update(id, user.sub, body) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete (soft) a manual asset' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.manualAssetsService.remove(id, user.sub) };
  }

  @Get(':id/snapshots')
  @ApiOperation({ summary: 'List all explicit monthly value snapshots for a manual asset' })
  async listSnapshots(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.manualAssetsService.listSnapshots(id, user.sub) };
  }

  @Put(':id/snapshots/:month')
  @ApiOperation({
    summary: 'Upsert the value for one month (carry-forward applies when reading gaps)',
  })
  async upsertSnapshot(
    @Param('id') id: string,
    @Param('month') month: string,
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(putManualAssetSnapshotSchema)) body: PutManualAssetSnapshotInput,
  ) {
    return { data: await this.manualAssetsService.upsertSnapshot(id, user.sub, month, body) };
  }
}
