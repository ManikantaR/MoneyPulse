import { Module } from '@nestjs/common';
import { AgentRunnerService } from './agent-runner.service';
import { RecommendationSuppressionService } from './recommendation-suppression.service';

/**
 * 12.1 — the recommendation layer's runtime pieces: the agent manifest runner
 * (tool-allowlist + privacy-class enforcement) and decision-aware suppression.
 * The evidence contract itself (`recommendation-evidence.ts`) is pure functions
 * consumed directly by `NotificationsService`, not a provider.
 */
@Module({
  providers: [AgentRunnerService, RecommendationSuppressionService],
  exports: [AgentRunnerService, RecommendationSuppressionService],
})
export class RecommendationsModule {}
