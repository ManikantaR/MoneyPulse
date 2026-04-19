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
import {
  createSavingsGoalSchema,
  updateSavingsGoalSchema,
} from '@moneypulse/shared';
import type {
  CreateSavingsGoalInput,
  UpdateSavingsGoalInput,
  AuthTokenPayload,
} from '@moneypulse/shared';
import { z } from 'zod/v4';

const contributeSchema = z.object({
  amountCents: z.int().min(1, 'Amount must be positive'),
});

@ApiTags('Savings Goals')
@Controller('savings-goals')
@UseGuards(JwtAuthGuard)
export class SavingsGoalsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'List savings goals' })
  async findAll(@CurrentUser() user: AuthTokenPayload) {
    const data = await this.budgetsService.findSavingsGoals(user.sub);
    return { data };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create savings goal' })
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body(new ZodValidationPipe(createSavingsGoalSchema))
    body: CreateSavingsGoalInput,
  ) {
    const goal = await this.budgetsService.createSavingsGoal(user.sub, body);
    return { data: goal };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update savings goal' })
  async update(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSavingsGoalSchema))
    body: UpdateSavingsGoalInput,
  ) {
    const goal = await this.budgetsService.updateSavingsGoal(
      id,
      user.sub,
      body,
    );
    return { data: goal };
  }

  @Post(':id/contribute')
  @ApiOperation({ summary: 'Add funds to a savings goal' })
  async contribute(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contributeSchema)) body: { amountCents: number },
  ) {
    const goal = await this.budgetsService.contributeSavingsGoal(
      id,
      user.sub,
      body.amountCents,
    );
    return { data: goal };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft delete savings goal' })
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    await this.budgetsService.deleteSavingsGoal(id, user.sub);
    return { data: { deleted: true } };
  }
}
