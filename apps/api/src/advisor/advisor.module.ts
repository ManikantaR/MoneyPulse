import { Module } from '@nestjs/common';
import { AiLogsModule } from '../ai-logs/ai-logs.module';
import { McpClientService } from './mcp-client.service';
import { AdvisorService } from './advisor.service';
import { AdvisorController } from './advisor.controller';
import { AdvisorSettingsService } from './advisor-settings.service';
import { LlmProviderFactory } from './llm/provider-factory';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [AiLogsModule],
  providers: [
    McpClientService,
    AdvisorService,
    AdvisorSettingsService,
    LlmProviderFactory,
    TelegramService,
  ],
  controllers: [AdvisorController, TelegramController],
  exports: [AdvisorService],
})
export class AdvisorModule {}
