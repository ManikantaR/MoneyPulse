import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AlertEngineService } from './alert-engine.service';
import { WebhookService } from './webhook.service';
import { EmailService } from './email.service';
import { TelegramPushService } from './telegram-push.service';
import { WebPushService } from './web-push.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  providers: [
    NotificationsService,
    AlertEngineService,
    WebhookService,
    EmailService,
    TelegramPushService,
    WebPushService,
    NotificationPreferencesService,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, AlertEngineService, WebPushService, NotificationPreferencesService],
})
export class NotificationsModule {}
