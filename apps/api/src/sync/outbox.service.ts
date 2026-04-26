import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DATABASE_CONNECTION } from '../db/db.module';
import * as schema from '../db/schema';
import { hashSyncPayload } from './sync-payload.util';

export interface OutboxEnqueueInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  userId: string;
  householdId?: string | null;
  payload: Record<string, unknown>;
  schemaVersion?: number;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: any) {}

  /**
   * Enqueue a sync event for outbound delivery.
   * Non-fatal: logs errors rather than throwing, so domain operations succeed
   * even when the outbox insert fails (eventual consistency).
   */
  async enqueue(input: OutboxEnqueueInput): Promise<void> {
    try {
      await this.insertRow(this.db, input);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue outbox event ${input.eventType} for ${input.aggregateId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Enqueue a sync event within an existing Drizzle transaction context.
   * Propagates errors so the outer transaction can roll back atomically.
   * Use this when the domain write and outbox insert must succeed or fail together.
   */
  async enqueueInTx(tx: any, input: OutboxEnqueueInput): Promise<void> {
    await this.insertRow(tx, input);
  }

  private async insertRow(executor: any, input: OutboxEnqueueInput): Promise<void> {
    const idempotencyKey = `${input.eventType}:${input.aggregateId}:${randomUUID()}`;
    const payloadHash = hashSyncPayload(input.payload);

    await executor.insert(schema.outboxEvents).values({
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      userId: input.userId,
      householdId: input.householdId ?? null,
      payloadJson: input.payload,
      payloadHash,
      schemaVersion: input.schemaVersion ?? 1,
      idempotencyKey,
      status: 'pending',
      nextAttemptAt: new Date(),
    });
  }
}
