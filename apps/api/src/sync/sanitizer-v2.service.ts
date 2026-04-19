import { Injectable } from '@nestjs/common';
import { SYNC_BANNED_FIELDS, SYNC_PII_PATTERNS } from './sync.constants';
import type { SyncPolicyResult } from './sync.types';

@Injectable()
export class SanitizerV2Service {
  sanitizePayload(payload: Record<string, unknown>): SyncPolicyResult {
    const bannedField = this.findBannedField(payload);
    if (bannedField) {
      return {
        policyPassed: false,
        policyReason: 'POLICY_FAIL_BANNED_FIELD',
        sanitizedPayload: {},
        bannedField,
      };
    }

    if (this.containsPiiLikeValue(payload)) {
      return {
        policyPassed: false,
        policyReason: 'POLICY_FAIL_PATTERN_MATCH',
        sanitizedPayload: {},
      };
    }

    const sanitizedPayload = this.dropUndefined(payload);
    return {
      policyPassed: true,
      policyReason: 'POLICY_PASS',
      sanitizedPayload,
    };
  }

  private findBannedField(node: unknown): string | null {
    if (!node || typeof node !== 'object') {
      return null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = this.findBannedField(item);
        if (found) return found;
      }
      return null;
    }

    for (const [key, value] of Object.entries(node)) {
      if (SYNC_BANNED_FIELDS.has(key)) {
        return key;
      }
      const found = this.findBannedField(value);
      if (found) return found;
    }

    return null;
  }

  private containsPiiLikeValue(node: unknown): boolean {
    if (node == null) return false;

    if (typeof node === 'string') {
      return SYNC_PII_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        const matched = pattern.test(node);
        pattern.lastIndex = 0;
        return matched;
      });
    }

    if (Array.isArray(node)) {
      return node.some((item) => this.containsPiiLikeValue(item));
    }

    if (typeof node === 'object') {
      return Object.values(node).some((value) => this.containsPiiLikeValue(value));
    }

    return false;
  }

  private dropUndefined(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }
}
