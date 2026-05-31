import { Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { AiCategorizerService } from './ai-categorizer.service';
import { LearningService } from './learning.service';
import { CategorizationService } from './categorization.service';
import { MerchantNormalizerService } from './merchant-normalizer.service';
import { MerchantAliasController } from './merchant-alias.controller';
import { MerchantAliasService } from './merchant-alias.service';
import { OllamaHealthService } from './ollama-health.service';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [AiLogsModule],
  controllers: [MerchantAliasController],
  providers: [
    RuleEngineService,
    AiCategorizerService,
    LearningService,
    CategorizationService,
    MerchantNormalizerService,
    MerchantAliasService,
    OllamaHealthService,
  ],
  exports: [
    CategorizationService,
    RuleEngineService,
    LearningService,
    MerchantNormalizerService,
    OllamaHealthService,
  ],
})
export class CategorizationModule {}
