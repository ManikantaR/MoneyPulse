export type SyncPolicyReason =
  | 'POLICY_PASS'
  | 'POLICY_FAIL_BANNED_FIELD'
  | 'POLICY_FAIL_PATTERN_MATCH'
  | 'POLICY_FAIL_SCHEMA';

export interface SyncPolicyResult {
  policyPassed: boolean;
  policyReason: SyncPolicyReason;
  sanitizedPayload: Record<string, unknown>;
  bannedField?: string;
}

export interface SignedPayload {
  signature: string;
  keyId: string;
  timestamp: string;
  idempotencyKey: string;
}
