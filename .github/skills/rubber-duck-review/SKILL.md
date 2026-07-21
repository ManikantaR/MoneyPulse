---
name: rubber-duck-review
description: Run a rubber-duck review on a plan, spec, implementation, or fix before handoff or completion — five forced statements that surface hand-waving before it ships.
---

<!-- Canonical source: https://github.com/ManikantaR/skills/tree/main/rubber-duck-review
     Edit there, not here — this copy exists only because GitHub-native tools
     (Copilot) read .github/skills locally rather than across repos. -->

Checklist — state each of the following explicitly, out loud, not just implicitly
assumed:

1. State the exact problem.
2. State the smallest solving change.
3. State the invariant that must remain true.
4. State the validation that proves success.
5. State the next likely failure mode.

If any answer is unclear or hand-wavy, keep refining the plan or implementation
before treating it as ready.
