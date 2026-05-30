import { Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { AiCategorizerService } from './ai-categorizer.service';
import { LearningService } from './learning.service';
import { CategorizationService } from './categorization.service';
import { MerchantNormalizerService } from './merchant-normalizer.service';
import { AiLogsModule } from '../ai-logs/ai-logs.module';

@Module({
  imports: [AiLogsModule],
  providers: [
    RuleEngineService,
    AiCategorizerService,
    LearningService,
    CategorizationService,
    MerchantNormalizerService,
  ],
  exports: [CategorizationService, RuleEngineService, LearningService, MerchantNormalizerService],
})
export class CategorizationModule {}
