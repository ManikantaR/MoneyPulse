Run the mandatory rubber-duck review for MoneyPulse before any handoff or completion.

**Input from the user:** what was built or changed, and a one-line problem statement.

**Answer each of these five questions. If any answer is fuzzy, keep refining.**

1. **The exact problem.** What was broken, missing, or needed? One sentence.

2. **The smallest solving change.** What is the minimum edit across API, web, shared, DB, and parser that addresses the problem?

3. **The invariant that must remain true.** For MoneyPulse this is almost always one of:
   - No full account numbers in any DB column
   - PII encrypted at rest (AES-256-GCM) for sensitive columns
   - Sync events sanitized before cloud delivery
   - Local-first: no mandatory cloud call in the critical transaction path
   - TDD: tests exist and pass

4. **The validation that proves success.** Name the exact command or test file. Do not say "it should work." Say `pnpm test`, or the specific spec file, or the manual step with the exact expected output.

5. **The next likely failure mode.** What breaks after this change succeeds? Example: API test passes but shared type not updated causes web build to fail; sync sanitizer passes but alias mapper produces different IDs if ALIAS_SECRET changes.

If all five are answered cleanly: the work is ready. Otherwise keep working.
