import postgres from 'postgres';

/**
 * Truncate all test-data tables in dependency order.
 * Call this at the start of each E2E suite's beforeAll so suites are
 * independent of execution order and don't leak state into one another.
 */
export async function truncateAllTables(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set for E2E tests');

  const sql = postgres(url);
  try {
    await sql`
      TRUNCATE TABLE
        outbox_events,
        sync_audit_logs,
        ai_prompt_logs,
        investment_snapshots,
        investment_accounts,
        audit_logs,
        notifications,
        savings_goals,
        budgets,
        categorization_rules,
        transactions,
        file_uploads,
        categories,
        accounts,
        user_settings,
        users,
        households
      RESTART IDENTITY CASCADE
    `;
  } finally {
    await sql.end();
  }
}
