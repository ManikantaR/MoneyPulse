import { Injectable, Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { SanitizerV2Service } from './sanitizer-v2.service';
import { AliasMapperService } from './alias-mapper.service';
import { SigningService } from './signing.service';
import { SYNC_MAX_ATTEMPTS } from './sync.constants';
import { hashSyncPayload } from './sync-payload.util';

interface OutboxRow {
  id: string;
  event_type: string;
  user_id: string;
  payload_json: Record<string, unknown>;
  attempts: number;
  idempotency_key: string;
}

@Injectable()
export class SyncDeliveryService {
  private readonly logger = new Logger(SyncDeliveryService.name);
  private readonly endpoint = process.env.FIREBASE_SYNC_ENDPOINT || '';

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: any,
    private readonly sanitizer: SanitizerV2Service,
    private readonly aliasMapper: AliasMapperService,
    private readonly signing: SigningService,
  ) {}

  async deliverPending(limit = 25): Promise<number> {
    const due = await this.db.execute(sql`
      SELECT id, event_type, user_id, payload_json, attempts, idempotency_key
      FROM ${schema.outboxEvents}
      WHERE status IN ('pending', 'retry')
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);

    const rows = (due.rows ?? due) as OutboxRow[];
    for (const row of rows) {
      await this.deliverOne(row);
    }
    return rows.length;
  }

  private async deliverOne(row: OutboxRow): Promise<void> {
    const policy = this.sanitizer.sanitizePayload(row.payload_json);

    if (!policy.policyPassed) {
      await this.markPolicyFailed(
        row,
        policy.policyReason,
        hashSyncPayload(row.payload_json),
      );
      return;
    }

    const userAlias = this.aliasMapper.toAliasId('user', row.user_id);
    const projected = {
      ...policy.sanitizedPayload,
      userAliasId: userAlias,
    };

    const signed = this.signing.signPayload(projected, row.idempotency_key);

    if (!this.endpoint) {
      this.logger.warn('FIREBASE_SYNC_ENDPOINT is not configured, scheduling retry');
      await this.markRetry(
        row,
        'NO_ENDPOINT',
        'Missing FIREBASE_SYNC_ENDPOINT',
        null,
        null,
        hashSyncPayload(projected),
      );
      return;
    }

    const startedAt = Date.now();

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mp-signature': signed.signature,
          'x-mp-key-id': signed.keyId,
          'x-mp-timestamp': signed.timestamp,
          'x-mp-idempotency-key': signed.idempotencyKey,
        },
        body: JSON.stringify(projected),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        await this.db
          .update(schema.outboxEvents)
          .set({
            status: 'delivered',
            deliveredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(sql`${schema.outboxEvents.id} = ${row.id}`);

        await this.insertAudit(
          row,
          hashSyncPayload(projected),
          true,
          'POLICY_PASS',
          row.attempts + 1,
          res.status,
          null,
          null,
          signed.keyId,
        );
        return;
      }

      await this.markRetry(
        row,
        `HTTP_${res.status}`,
        `Delivery failed with status ${res.status}`,
        signed.keyId,
        res.status,
        hashSyncPayload(projected),
      );
      this.logger.warn(`Sync delivery failed for ${row.id} with status ${res.status} in ${Date.now() - startedAt}ms`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await this.markRetry(
        row,
        'NETWORK_ERROR',
        message,
        signed.keyId,
        null,
        hashSyncPayload(projected),
      );
    }
  }

  private computeBackoffMillis(attempt: number): number {
    const caps = [0, 30_000, 120_000, 600_000, 1_800_000, 7_200_000, 28_800_000, 86_400_000];
    const base = caps[Math.min(attempt, caps.length - 1)] || 86_400_000;
    const jitter = Math.floor(Math.random() * 5_000);
    return base + jitter;
  }

  private async markPolicyFailed(
    row: OutboxRow,
    reason: string,
    payloadHash: string,
  ): Promise<void> {
    await this.db
      .update(schema.outboxEvents)
      .set({
        status: 'policy_failed',
        policyPassed: false,
        policyReason: reason,
        updatedAt: new Date(),
      })
      .where(sql`${schema.outboxEvents.id} = ${row.id}`);

    await this.insertAudit(
      row,
      payloadHash,
      false,
      reason,
      row.attempts + 1,
      null,
      'POLICY',
      'Policy rejection',
    );
  }

  private async markRetry(
    row: OutboxRow,
    code: string,
    message: string,
    signatureKeyId: string | null = null,
    httpStatus: number | null = null,
    payloadHash: string | null = null,
  ): Promise<void> {
    const nextAttempts = row.attempts + 1;
    const deadLetter = nextAttempts >= SYNC_MAX_ATTEMPTS;

    await this.db
      .update(schema.outboxEvents)
      .set({
        attempts: nextAttempts,
        status: deadLetter ? 'dead_letter' : 'retry',
        nextAttemptAt: new Date(Date.now() + this.computeBackoffMillis(nextAttempts)),
        lastErrorCode: code,
        lastErrorMessage: message,
        deadLetteredAt: deadLetter ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(sql`${schema.outboxEvents.id} = ${row.id}`);

    await this.insertAudit(
      row,
      payloadHash ?? hashSyncPayload(row.payload_json),
      false,
      'POLICY_PASS',
      nextAttempts,
      httpStatus,
      code,
      message,
      signatureKeyId,
    );
  }

  private async insertAudit(
    row: OutboxRow,
    payloadHash: string,
    policyPassed: boolean,
    policyReason: string,
    attemptNo: number,
    httpStatus: number | null,
    errorCode: string | null,
    errorMessage: string | null,
    signatureKeyId: string | null = null,
  ): Promise<void> {
    await this.db.insert(schema.syncAuditLogs).values({
      outboxEventId: row.id,
      userId: row.user_id,
      action: 'delivery_attempt',
      payloadHash,
      policyPassed,
      policyReason,
      signatureKid: signatureKeyId,
      attemptNo,
      httpStatus,
      errorCode,
      errorMessage,
    });
  }
}
