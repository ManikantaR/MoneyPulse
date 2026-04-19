import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import type { SignedPayload } from './sync.types';

@Injectable()
export class SigningService {
  signPayload(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): SignedPayload {
    const keyId = process.env.SYNC_SIGNING_KEY_ID || 'sync-key-v1';
    const keySecret = process.env.SYNC_SIGNING_SECRET;

    if (!keySecret) {
      throw new Error('SYNC_SIGNING_SECRET must be set for sync payload signing');
    }

    const timestamp = new Date().toISOString();
    const canonical = JSON.stringify(body);
    const toSign = `${timestamp}\n${idempotencyKey}\n${canonical}`;

    const signature = createHmac('sha256', keySecret).update(toSign).digest('hex');

    return {
      signature,
      keyId,
      timestamp,
      idempotencyKey,
    };
  }
}
