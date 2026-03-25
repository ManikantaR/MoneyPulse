import { Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { AiCategorizerService } from './ai-categorizer.service';
import { LearningService } from './learning.service';
import { CategorizationService } from './categorization.service';

@Module({
  providers: [
    RuleEngineService,
    AiCategorizerService,
    LearningService,
    CategorizationService,
  ],
  exports: [CategorizationService, RuleEngineService, LearningService],
})
export class CategorizationModule {}
