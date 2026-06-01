import { Module } from '@nestjs/common';
import { BillsService } from './bills.service';
import { BillsController } from './bills.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [BillsService],
  controllers: [BillsController, SubscriptionsController],
  exports: [BillsService],
})
export class BillsModule {}
