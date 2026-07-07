import {
  Controller,
  Get,
  Post,
  Patch,
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
import { createLoanSchema, updateLoanSchema } from '@moneypulse/shared';
import type { AuthTokenPayload, CreateLoanInput, UpdateLoanInput } from '@moneypulse/shared';

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
}
