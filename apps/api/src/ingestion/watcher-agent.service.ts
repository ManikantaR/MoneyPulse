import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';
import type { WatcherHeartbeatInput } from '@moneypulse/shared';

/**
 * Phase 14 S2b — `WatcherAgentService`.
 *
 * Upserts a `watcher_agents` row per heartbeat and reports whether the
 * agent's own self-test ("diagnostics") is currently healthy. The server-side
 * silence/unhealthy *alarm* evaluation (how long unhealthy, episodes, auto
 * resolve) lives in `ImportVisibilityDetector` — this service only owns the
 * heartbeat record itself, per the spec's "Data Model".
 */
@Injectable()
export class WatcherAgentService {
  private readonly logger = new Logger(WatcherAgentService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Record a heartbeat from the laptop watcher. `userId` is the caller's
   * resolved owner (JWT `sub`, or the configured `INGEST_DEFAULT_USER_ID`
   * fallback for the shared-key path — resolved by the controller, same
   * pattern as `watcher-events`).
   *
   * Upserts by `agentId` (unique): a brand-new agent id creates a row owned
   * by this caller; a known agent id already owned by a *different* user is
   * never silently reassigned (same ownership-hijack guard as
   * `recordWatcherEvent`) — the heartbeat is still accepted (so a shared key
   * misconfiguration never 500s the watcher) but the row is left untouched.
   */
  async recordHeartbeat(userId: string, body: WatcherHeartbeatInput) {
    const existing = await this.db
      .select()
      .from(schema.watcherAgents)
      .where(eq(schema.watcherAgents.agentId, body.agentId))
      .limit(1);

    const diagnostics = body.diagnostics;
    const now = new Date();

    if (existing.length > 0) {
      const row = existing[0];
      if (row.userId !== userId) {
        this.logger.warn(
          `Heartbeat for agentId already owned by a different user; ignoring update (keeping existing owner)`,
        );
        return { commands: [] };
      }
      await this.db
        .update(schema.watcherAgents)
        .set({
          version: body.version,
          processPath: diagnostics.processPath,
          pythonVersion: diagnostics.pythonVersion,
          startedAt: new Date(body.startedAt),
          lastSeenAt: now,
          lastDiagnostics: diagnostics,
          updatedAt: now,
        })
        .where(eq(schema.watcherAgents.id, row.id));
    } else {
      await this.db.insert(schema.watcherAgents).values({
        userId,
        agentId: body.agentId,
        version: body.version,
        processPath: diagnostics.processPath,
        pythonVersion: diagnostics.pythonVersion,
        startedAt: new Date(body.startedAt),
        lastSeenAt: now,
        lastDiagnostics: diagnostics,
      });
    }

    // S4 adds real commands delivered via the heartbeat response; today's
    // contract always returns an empty array (per the heartbeat contract).
    return { commands: [] };
  }

  /** Current heartbeat row for a user's agent(s) — used by the sweep and `/imports`. */
  async listAgentsForUser(userId: string) {
    return this.db
      .select()
      .from(schema.watcherAgents)
      .where(eq(schema.watcherAgents.userId, userId));
  }

  /** All agent rows across every user — used by the sweep. */
  async listAllAgents() {
    return this.db.select().from(schema.watcherAgents);
  }

  /**
   * Whether the latest heartbeat's self-test reports a problem: unreadable
   * Downloads, missing NAS mount, or a non-empty dead-letter queue (spec:
   * `watcher_unhealthy` condition).
   */
  static isDiagnosticsUnhealthy(diagnostics: any): boolean {
    if (!diagnostics) return false;
    return (
      diagnostics.downloadsReadable === false ||
      diagnostics.nasMountPresent === false ||
      (diagnostics.deadLetterDepth ?? 0) > 0
    );
  }
}
