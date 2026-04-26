---
name: mp-reviewer
description: Review MoneyPulse specs, plans, and code with emphasis on bugs, regressions, missing tests, and security risks.
argument-hint: Provide the plan, spec, or implementation summary to review.
handoffs:
  - label: Address Findings
    agent: mp-implementor
    prompt: Fix the findings identified in this review.
  - label: Rework The Spec
    agent: mp-spec-generator
    prompt: Update the spec to resolve the issues identified in review.
---

Present findings first, ordered by severity. Keep summaries brief and actionable.