import { Module } from '@nestjs/common';
import { AiLogsModule } from '../ai-logs/ai-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { McpClientService } from './mcp-client.service';
import { AdvisorService } from './advisor.service';
import { AdvisorController } from './advisor.controller';
import { AdvisorSettingsService } from './advisor-settings.service';
import { LlmProviderFactory } from './llm/provider-factory';
import { TelegramService } from './telegram.service';
import { DigestSignalsService } from './digest/digest-signals.service';
import { AdvisorDigestService } from './digest/advisor-digest.service';
import { AdvisorReviewService } from './review/advisor-review.service';

@Module({
  imports: [AiLogsModule, NotificationsModule],
  providers: [
    McpClientService,
    AdvisorService,
    AdvisorSettingsService,
    LlmProviderFactory,
    TelegramService,
    DigestSignalsService,
    AdvisorDigestService,
    AdvisorReviewService,
  ],
  controllers: [AdvisorController],
  exports: [AdvisorService, AdvisorDigestService, AdvisorReviewService, AdvisorSettingsService, LlmProviderFactory],
})
export class AdvisorModule {}
