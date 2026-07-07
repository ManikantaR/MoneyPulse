import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AlertEngineService } from './alert-engine.service';
import { WebhookService } from './webhook.service';
import { EmailService } from './email.service';
import { TelegramPushService } from './telegram-push.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  providers: [
    NotificationsService,
    AlertEngineService,
    WebhookService,
    EmailService,
    TelegramPushService,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, AlertEngineService],
})
export class NotificationsModule {}
