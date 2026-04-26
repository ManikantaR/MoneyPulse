---
name: mp-rubber-duck
description: Run the mandatory rubber-duck review for MoneyPulse plans, specs, fixes, or implementations.
agent: mp-reviewer
argument-hint: work=<plan/spec/change> summary=<one line>
---

Run the rubber-duck checklist from `docs/agentic/rule-set.md`.

Output:
1. The problem.
2. The smallest solving change.
3. The invariant or security consequence if wrong.
4. The validation that proves success.
5. The next likely failure mode.