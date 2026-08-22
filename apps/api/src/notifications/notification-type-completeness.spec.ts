import fs from 'fs';
import path from 'path';
import * as schema from '../db/schema';

/**
 * #watchdog-market-alerts: 16 notification types were dispatched via
 * NotificationsService.createAndDispatch() but were missing from the
 * notification_type enum / DEFAULT_PREFERENCES, silently downgrading them to
 * in-app-only delivery (Telegram/HA routing dropped). This test scans every
 * source file under apps/api/src for `createAndDispatch({ ... })` call sites
 * and asserts every `type:` / `notificationType:` string literal found inside
 * those calls is registered in notificationTypeEnum, so this drift can't
 * recur silently.
 *
 * Excluded: the notifications controller's manual test-send endpoint, which
 * literally dispatches `type: 'test'` — an internal-only sentinel that is
 * always overridden by `notificationType: 'system_alert'` in the same call
 * (already a registered type), never routed as `'test'` itself.
 */

const SRC_ROOT = path.join(__dirname, '..');

// path (relative to apps/api/src), 'type' literal to ignore for that file
const EXCLUDED_LITERALS: Record<string, Set<string>> = {
  'notifications/notifications.controller.ts': new Set(['test']),
};

/** Extract the raw argument text of every `callName({ ... })` call in `content`, via balanced-paren scanning (handles nested objects like `metadata: {...}`). */
function extractCallArgs(content: string, callName: string): string[] {
  const marker = `${callName}(`;
  const results: string[] = [];
  let searchFrom = 0;
  let idx: number;
  while ((idx = content.indexOf(marker, searchFrom)) !== -1) {
    const start = idx + marker.length;
    let depth = 1;
    let i = start;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === '(') depth++;
      else if (content[i] === ')') depth--;
    }
    results.push(content.slice(start, i - 1));
    searchFrom = i;
  }
  return results;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('createAndDispatch() type/notificationType literals are all registered (#watchdog-market-alerts)', () => {
  it('every literal found is present in notificationTypeEnum.enumValues', () => {
    const registered = new Set(schema.notificationTypeEnum.enumValues as readonly string[]);
    const literalRegex = /\b(?:type|notificationType):\s*'([a-zA-Z0-9_]+)'/g;

    const found: Array<{ file: string; literal: string }> = [];
    for (const absFile of walk(SRC_ROOT)) {
      const relFile = path.relative(SRC_ROOT, absFile).split(path.sep).join('/');
      const content = fs.readFileSync(absFile, 'utf-8');
      const excluded = EXCLUDED_LITERALS[relFile] ?? new Set<string>();

      for (const args of extractCallArgs(content, 'createAndDispatch')) {
        let match: RegExpExecArray | null;
        literalRegex.lastIndex = 0;
        while ((match = literalRegex.exec(args)) !== null) {
          const literal = match[1];
          if (excluded.has(literal)) continue;
          found.push({ file: relFile, literal });
        }
      }
    }

    // Sanity check: make sure the scan actually found call sites (guards against
    // this test silently passing if the scan logic itself regresses to a no-op).
    expect(found.length).toBeGreaterThan(0);

    const unregistered = found.filter(({ literal }) => !registered.has(literal));
    expect(
      unregistered,
      `unregistered notification type literal(s) found in createAndDispatch() calls: ${JSON.stringify(unregistered)}`,
    ).toEqual([]);
  });
});
