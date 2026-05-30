import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [AnalyticsService, AnomalyDetectorService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService, AnomalyDetectorService],
})
export class AnalyticsModule {}
