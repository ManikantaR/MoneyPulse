import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InvestmentsModule } from '../investments/investments.module';
import { AgentRunnerService } from './agent-runner.service';
import { RecommendationSuppressionService } from './recommendation-suppression.service';
import { CashManagerService } from './cash-manager.service';
import { InvestmentCoachService } from './investment-coach.service';

/**
 * 12.1 — the recommendation layer's runtime pieces: the agent manifest runner
 * (tool-allowlist + privacy-class enforcement) and decision-aware suppression.
 * The evidence contract itself (`recommendation-evidence.ts`) is pure functions
 * consumed directly by `NotificationsService`, not a provider.
 *
 * 12.5 adds the first real agent, `CashManagerService`, on top of that scaffold.
 * 12.6 adds the second, `InvestmentCoachService`.
 */
@Module({
  imports: [NotificationsModule, AnalyticsModule, InvestmentsModule],
  providers: [AgentRunnerService, RecommendationSuppressionService, CashManagerService, InvestmentCoachService],
  exports: [AgentRunnerService, RecommendationSuppressionService, CashManagerService, InvestmentCoachService],
})
export class RecommendationsModule {}
