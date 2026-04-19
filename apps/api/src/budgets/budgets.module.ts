import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { SavingsGoalsController } from './savings-goals.controller';

@Module({
  providers: [BudgetsService],
  controllers: [BudgetsController, SavingsGoalsController],
  exports: [BudgetsService],
})
export class BudgetsModule {}
