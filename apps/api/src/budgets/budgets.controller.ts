import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createBudgetSchema, updateBudgetSchema } from '@moneypulse/shared';
import type {
  CreateBudgetInput,
  UpdateBudgetInput,
  AuthTokenPayload,
} from '@moneypulse/shared';

@ApiTags('Budgets')
@Controller('budgets')
@UseGuards(JwtAuthGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'List budgets with current spend' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.budgetsService.findBudgetsWithSpend(
      user.sub,
      user.householdId ?? undefined,
    );
    return { data };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create budget' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createBudgetSchema)) body: CreateBudgetInput,
  ) {
    const budget = await this.budgetsService.createBudget(
      user.sub,
      body,
      user.householdId ?? undefined,
    );
    return { data: budget };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update budget' })
  async update(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBudgetSchema)) body: UpdateBudgetInput,
  ) {
    const budget = await this.budgetsService.updateBudget(id, user.sub, body);
    return { data: budget };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete budget' })
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    await this.budgetsService.deleteBudget(id, user.sub);
    return { data: { deleted: true } };
  }
}
