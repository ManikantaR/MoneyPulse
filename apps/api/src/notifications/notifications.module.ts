import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { AlertEngineService } from './alert-engine.service';
import { WebhookService } from './webhook.service';
import { EmailService } from './email.service';

@Module({
  providers: [
    NotificationsService,
    AlertEngineService,
    WebhookService,
    EmailService,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, AlertEngineService],
})
export class NotificationsModule {}
