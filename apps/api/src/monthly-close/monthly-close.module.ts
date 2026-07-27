import { Module } from '@nestjs/common';
import { MonthlyCloseService } from './monthly-close.service';
import { MonthlyCloseController } from './monthly-close.controller';
import { ManualAssetsModule } from './manual-assets.module';
import { InvestmentsModule } from '../investments/investments.module';
import { LoansModule } from '../loans/loans.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ManualAssetsModule, InvestmentsModule, LoansModule, NotificationsModule],
  providers: [MonthlyCloseService],
  controllers: [MonthlyCloseController],
  exports: [MonthlyCloseService],
})
export class MonthlyCloseModule {}
