import { z } from 'zod';

// Cross-repo consumption note (issue #99 / PHASE11-AWARENESS-SPEC §11.1):
// moneypulse-web (the separate Firebase-hosted ingest project — see
// docs/FIREBASE-SETUP-SECRETS-HANDOFF.md) lives in its own repo/deploy
// pipeline, so it cannot `import` this package directly.
//
// STATUS as of 2026-07-21: no mirror of these schemas exists in
// moneypulse-web yet (verified directly against that repo's working tree —
// no `functions/src/sync-contracts.ts`, zero hits for ALIAS_ID_PATTERN /
// sync-contract / POLICY_FAIL_SCHEMA). This sandbox's write access is
// scoped to the MyMoney worktree only, so that mirror could not be created
// from here. TODO (tracked follow-up, separate PR in the moneypulse-web
// repo): add `functions/src/sync-contracts.ts` as a verbatim, version-pinned
// copy of this file's exports (pin the source commit in a comment there),
// add `zod` to functions/package.json, and wire it into the ingest handler
// under functions/src/sync/. Until that lands, moneypulse-web's ingest does
// NOT enforce this allowlist — only this repo's outbound sanitizer does.
export const ALIAS_ID_PATTERN = /^a\d+_[0-9a-f]{40}$/;

const aliasIdSchema = z.string().regex(ALIAS_ID_PATTERN);
const isoInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

export const transactionProjectedV1Schema = z.strictObject({
  transactionAliasId: aliasIdSchema,
  accountAliasId: aliasIdSchema,
  amountCents: z.number().int(),
  date: isoInstantSchema,
  categoryId: aliasIdSchema.nullable(),
  isCredit: z.boolean(),
  isTransfer: z.boolean(),
  isManual: z.boolean(),
  isSplitParent: z.boolean().optional(),
  tags: z.array(z.string()),
  originalAmountCents: z.number().int().nullable().optional(),
  currencyCode: z.string().trim().min(1).nullable().optional(),
});

export const categoryProjectedV1Schema = z.strictObject({
  categoryId: aliasIdSchema,
  name: z.string().trim().min(1),
  icon: z.string().trim().min(1).nullable(),
  color: z.string().trim().min(1).nullable(),
  parentCategoryId: aliasIdSchema.nullable(),
  sortOrder: z.number().int(),
  isTransfer: z.boolean(),
});

export const accountProjectedV1Schema = z.strictObject({
  accountAliasId: aliasIdSchema,
  institution: z.string().trim().min(1),
  accountType: z.string().trim().min(1),
  nickname: z.string().trim().min(1),
  startingBalanceCents: z.number().int(),
});

export const budgetProjectedV1Schema = z.strictObject({
  categoryId: aliasIdSchema,
  amountCents: z.number().int(),
  period: z.enum(['monthly', 'weekly']),
  householdId: aliasIdSchema.nullable(),
});

export const notificationProjectedV1Schema = z.strictObject({
  notificationAliasId: aliasIdSchema,
  type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  body: z.string(),
});

export const syncPayloadSchemas = {
  'transaction.projected.v1': transactionProjectedV1Schema,
  'category.projected.v1': categoryProjectedV1Schema,
  'account.projected.v1': accountProjectedV1Schema,
  'budget.projected.v1': budgetProjectedV1Schema,
  'notification.projected.v1': notificationProjectedV1Schema,
} as const;

export type SyncEventType = keyof typeof syncPayloadSchemas;

export function getSyncPayloadSchema(eventType: string) {
  return syncPayloadSchemas[eventType as SyncEventType];
}
