import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgentRunnerService } from './agent-runner.service';
import { RecommendationSuppressionService } from './recommendation-suppression.service';
import { CashManagerService } from './cash-manager.service';

/**
 * 12.1 — the recommendation layer's runtime pieces: the agent manifest runner
 * (tool-allowlist + privacy-class enforcement) and decision-aware suppression.
 * The evidence contract itself (`recommendation-evidence.ts`) is pure functions
 * consumed directly by `NotificationsService`, not a provider.
 *
 * 12.5 adds the first real agent, `CashManagerService`, on top of that scaffold.
 */
@Module({
  imports: [NotificationsModule],
  providers: [AgentRunnerService, RecommendationSuppressionService, CashManagerService],
  exports: [AgentRunnerService, RecommendationSuppressionService, CashManagerService],
})
export class RecommendationsModule {}
