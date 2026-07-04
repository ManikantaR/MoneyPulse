import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Guardrail: every MCP tool queries a single user's data. A tool that hits the
 * user-scoped tables (transactions/accounts/budgets) without resolving and
 * filtering by the user would silently span accounts — this test fails if any
 * tool forgets to scope. It reads the tool sources statically (no DB needed).
 */
const toolsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith('.ts'));

describe('MCP tool user-scoping', () => {
  it('has tool files to check', () => {
    expect(toolFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of toolFiles) {
    const src = readFileSync(join(toolsDir, file), 'utf8');
    const touchesUserTables = /\b(transactions|accounts|budgets)\b/i.test(src);

    it(`${file} resolves the current user`, () => {
      if (!touchesUserTables) return;
      expect(src).toMatch(/getUserId\s*\(\s*\)/);
    });

    it(`${file} filters by user_id`, () => {
      if (!touchesUserTables) return;
      expect(src).toMatch(/\.user_id\s*=\s*\$/);
    });
  }
});
