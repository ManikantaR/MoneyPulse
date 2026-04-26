import { describe, expect, it } from 'vitest';
import {
  canonicalizeSyncPayload,
  hashSyncPayload,
} from '../sync-payload.util';

describe('sync-payload.util', () => {
  it('canonicalizes object keys deterministically', () => {
    const left = canonicalizeSyncPayload({
      zebra: 1,
      alpha: { y: 2, x: 1 },
      list: [{ b: 2, a: 1 }],
    });

    const right = canonicalizeSyncPayload({
      list: [{ a: 1, b: 2 }],
      alpha: { x: 1, y: 2 },
      zebra: 1,
    });

    expect(left).toBe(right);
    expect(left).toBe('{"alpha":{"x":1,"y":2},"list":[{"a":1,"b":2}],"zebra":1}');
  });

  it('drops undefined values from canonical form and hashes consistently', () => {
    const first = hashSyncPayload({ a: 1, b: undefined, c: 'ok' });
    const second = hashSyncPayload({ c: 'ok', a: 1 });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });
});