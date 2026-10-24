import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import {
  WATCHER_SILENT_HOURS,
  WATCHER_SILENT_DUE_HOURS,
  WATCHER_SILENT_CRITICAL_HOURS,
  WATCHER_UNHEALTHY_MINUTES,
  WATCHER_UNHEALTHY_DUE_MINUTES,
} from '@moneypulse/shared';
import { WatcherAgentService } from './watcher-agent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StatementScheduleService } from '../analytics/statement-schedule.service';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Phase 14 S2b — server-side "something looks wrong with the laptop watcher"
 * sweep. Evaluates every `watcher_agents` row for the `watcher_silent` and
 * `watcher_unhealthy` alarm conditions (spec: "Alarms"), opening or
 * resolving a `pipeline_alarms` episode for each, and sends exactly one
 * notification through the existing `NotificationsService` path per episode
 * open (the staged delivery ladder is S2c — see the issue scope note).
 *
 * Runs on the existing `alerts` cron (`import-visibility-check`, every 15
 * minutes) and may also be invoked directly after a heartbeat to react to a
 * transition without waiting for the next sweep tick.
 */
@Injectable()
export class ImportVisibilityDetector {
  private readonly logger = new Logger(ImportVisibilityDetector.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly watcherAgentService: WatcherAgentService,
    private readonly notificationsService: NotificationsService,
    private readonly statementScheduleService: StatementScheduleService,
  ) {}

  /** Entry point for the `import-visibility-check` cron job. */
  async sweep(now: Date = new Date()): Promise<void> {
    const agents = await this.watcherAgentService.listAllAgents();
    for (const agent of agents as any[]) {
      await this.evaluateAgent(agent, now);
    }
  }

  /** Evaluate (and react to) one agent's silence + health state. */
  async evaluateAgent(agent: any, now: Date = new Date()): Promise<void> {
    await this.evaluateSilence(agent, now);
    await this.evaluateUnhealthy(agent, now);
  }

  private async evaluateSilence(agent: any, now: Date): Promise<void> {
    const lastSeen = new Date(agent.lastSeenAt);
    const silentHours = (now.getTime() - lastSeen.getTime()) / HOUR_MS;

    const dueSoon = await this.hasStatementDueSoon(agent.userId);
    const threshold = dueSoon ? WATCHER_SILENT_DUE_HOURS : WATCHER_SILENT_HOURS;
    const silent = silentHours >= threshold;

    const severity = silentHours >= WATCHER_SILENT_CRITICAL_HOURS ? 'critical' : 'warning';

    await this.reconcileAlarm({
      userId: agent.userId,
      type: 'watcher_silent',
      scopeKey: agent.agentId,
      isOpen: silent,
      severity,
      now,
      title: 'Laptop watcher has gone quiet',
      message: `Your laptop watcher hasn't checked in since ${lastSeen.toISOString()}. Statements may be stuck there.`,
    });
  }

  private async evaluateUnhealthy(agent: any, now: Date): Promise<void> {
    const diagnostics = agent.lastDiagnostics;
    const unhealthyNow = WatcherAgentService.isDiagnosticsUnhealthy(diagnostics);

    if (!unhealthyNow) {
      // A fresh healthy heartbeat auto-resolves any open episode immediately.
      await this.reconcileAlarm({
        userId: agent.userId,
        type: 'watcher_unhealthy',
        scopeKey: agent.agentId,
        isOpen: false,
        severity: 'warning',
        now,
        title: '',
        message: '',
      });
      return;
    }

    // "Persisting" is measured from updatedAt of the last heartbeat that
    // carried the unhealthy diagnostics — approximated here by lastSeenAt
    // (the last heartbeat at all), since `watcher_agents` only stores the
    // single latest diagnostics snapshot (no history table in S2b).
    const lastSeen = new Date(agent.lastSeenAt);
    const minutesUnhealthy = (now.getTime() - lastSeen.getTime()) / MINUTE_MS;
    const dueSoon = await this.hasStatementDueSoon(agent.userId);
    const threshold = dueSoon ? WATCHER_UNHEALTHY_DUE_MINUTES : WATCHER_UNHEALTHY_MINUTES;

    await this.reconcileAlarm({
      userId: agent.userId,
      type: 'watcher_unhealthy',
      scopeKey: agent.agentId,
      isOpen: minutesUnhealthy >= threshold,
      severity: 'warning',
      now,
      title: 'Laptop watcher is unhealthy',
      message:
        'Your laptop watcher reports a problem reaching Downloads or the NAS. Statements may not be transferring.',
    });
  }

  private async hasStatementDueSoon(userId: string): Promise<boolean> {
    try {
      const due = await this.statementScheduleService.getOverdueAccountsForUser(userId);
      return Array.isArray(due) && due.length > 0;
    } catch {
      // Statement schedule is best-effort context for the 2h vs 24h
      // threshold; never let it block the silence/unhealthy sweep itself.
      return false;
    }
  }

  /**
   * Open, keep-open, or auto-resolve one `pipeline_alarms` episode, per the
   * spec's dedupe/episode rules: one open row per `userId + type + scopeKey`,
   * one notification sent on open (or severity escalation), silent
   * auto-resolve on the next healthy signal.
   */
  private async reconcileAlarm(params: {
    userId: string;
    type: string;
    scopeKey: string;
    isOpen: boolean;
    severity: 'warning' | 'critical';
    now: Date;
    title: string;
    message: string;
  }): Promise<void> {
    const { userId, type, scopeKey, isOpen, severity, now, title, message } = params;

    const existingRows = await this.db
      .select()
      .from(schema.pipelineAlarms)
      .where(
        and(
          eq(schema.pipelineAlarms.userId, userId),
          eq(schema.pipelineAlarms.type, type),
          eq(schema.pipelineAlarms.scopeKey, scopeKey),
          isNull(schema.pipelineAlarms.resolvedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    if (!isOpen) {
      if (existing) {
        await this.db
          .update(schema.pipelineAlarms)
          .set({ resolvedAt: now, updatedAt: now })
          .where(eq(schema.pipelineAlarms.id, existing.id));
      }
      return;
    }

    if (existing) {
      // Already open at this severity — the escalation-on-severity-increase
      // notification path (critical) is not re-sent for warning-level repeats.
      if (existing.severity === severity) return;
      await this.db
        .update(schema.pipelineAlarms)
        .set({ severity, lastNotifiedAt: now, updatedAt: now })
        .where(eq(schema.pipelineAlarms.id, existing.id));
    } else {
      await this.db.insert(schema.pipelineAlarms).values({
        userId,
        type,
        scopeKey,
        severity,
        openedAt: now,
        lastNotifiedAt: now,
      });
    }

    const dedupeKey = `${type}:${scopeKey}:${now.toISOString()}:${severity}`;
    if (await this.notificationsService.findByMetadata(userId, dedupeKey)) return;

    await this.notificationsService.createAndDispatch({
      userId,
      type,
      title,
      message,
      severity: severity === 'critical' ? 'critical' : 'warning',
      source: 'system',
      data: { href: '/imports' },
      dedupeKey,
    });
  }
}
