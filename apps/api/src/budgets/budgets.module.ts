import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { SavingsGoalsController } from './savings-goals.controller';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  providers: [BudgetsService],
  controllers: [BudgetsController, SavingsGoalsController],
  exports: [BudgetsService],
})
export class BudgetsModule {}
