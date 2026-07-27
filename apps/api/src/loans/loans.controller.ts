import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createLoanSchema,
  updateLoanSchema,
  putLoanBalanceSnapshotSchema,
} from '@moneypulse/shared';
import type {
  AuthTokenPayload,
  CreateLoanInput,
  UpdateLoanInput,
  PutLoanBalanceSnapshotInput,
} from '@moneypulse/shared';

@ApiTags('Loans')
@Controller('loans')
@UseGuards(JwtAuthGuard)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get()
  @ApiOperation({ summary: 'List tracked loans for the current user' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.loansService.findAll(user.sub) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a tracked loan' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createLoanSchema)) body: CreateLoanInput,
  ) {
    return { data: await this.loansService.create(user.sub, body) };
  }

  @Post('check-missed')
  @ApiOperation({ summary: 'Check for missed loan payments and notify' })
  async checkMissed(@CurrentUser() user: AuthTokenPayload) {
    return { data: await this.loansService.checkMissedLoanPayments(user.sub) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a tracked loan' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(updateLoanSchema)) body: UpdateLoanInput,
  ) {
    return { data: await this.loansService.update(id, user.sub, body) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete (soft) a tracked loan' })
  async remove(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.loansService.remove(id, user.sub) };
  }

  @Get(':id/balance-snapshots')
  @ApiOperation({ summary: 'List explicit monthly balance snapshots for a loan' })
  async listBalanceSnapshots(@Param('id') id: string, @CurrentUser() user: AuthTokenPayload) {
    return { data: await this.loansService.listBalanceSnapshots(id, user.sub) };
  }

  @Put(':id/balance-snapshots/:month')
  @ApiOperation({ summary: 'Upsert a manual-statement balance for one month' })
  async upsertBalanceSnapshot(
    @Param('id') id: string,
    @Param('month') month: string,
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(putLoanBalanceSnapshotSchema)) body: PutLoanBalanceSnapshotInput,
  ) {
    return { data: await this.loansService.upsertBalanceSnapshot(id, user.sub, month, body) };
  }
}
