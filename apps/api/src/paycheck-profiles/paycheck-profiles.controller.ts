import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PaycheckProfilesService } from './paycheck-profiles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createPaycheckProfileSchema,
  updatePaycheckProfileSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreatePaycheckProfileInput,
  UpdatePaycheckProfileInput,
} from '@moneypulse/shared';

/**
 * REST controller for effective-dated paycheck profiles (11.11).
 * Manual-entry only — no PDF paystub parser in this iteration. All endpoints are
 * scoped to the authenticated user; no analytics/dashboard endpoints live here.
 */
@ApiTags('Paycheck Profiles')
@Controller('paycheck-profiles')
@UseGuards(JwtAuthGuard)
export class PaycheckProfilesController {
  constructor(private readonly paycheckProfilesService: PaycheckProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'List paycheck profiles for the current user, most recent effective date first' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.paycheckProfilesService.findAll(user.sub) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single paycheck profile by ID' })
  async findById(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.paycheckProfilesService.findById(id, user.sub) };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new effective-dated paycheck profile' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createPaycheckProfileSchema))
    body: CreatePaycheckProfileInput,
  ) {
    return { data: await this.paycheckProfilesService.create(user.sub, body) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a paycheck profile (corrections only — use POST for a new effective-dated version)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(updatePaycheckProfileSchema))
    body: UpdatePaycheckProfileInput,
  ) {
    return { data: await this.paycheckProfilesService.update(id, user.sub, body) };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a paycheck profile' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.paycheckProfilesService.remove(id, user.sub) };
  }
}
