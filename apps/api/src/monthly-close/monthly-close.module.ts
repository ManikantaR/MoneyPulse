import { Module } from '@nestjs/common';
import { MonthlyCloseService } from './monthly-close.service';
import { AiMonthlyReviewService } from './ai-monthly-review.service';
import { MonthlyCloseController } from './monthly-close.controller';
import { ManualAssetsModule } from './manual-assets.module';
import { InvestmentsModule } from '../investments/investments.module';
import { LoansModule } from '../loans/loans.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdvisorModule } from '../advisor/advisor.module';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [ManualAssetsModule, InvestmentsModule, LoansModule, NotificationsModule, AdvisorModule, AiLogsModule],
  providers: [MonthlyCloseService, AiMonthlyReviewService],
  controllers: [MonthlyCloseController],
  exports: [MonthlyCloseService, AiMonthlyReviewService],
})
export class MonthlyCloseModule {}
