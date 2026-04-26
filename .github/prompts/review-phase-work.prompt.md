---
name: mp-review-phase-work
description: Review a MoneyPulse spec or implementation for bugs, regressions, missing tests, and security issues.
agent: mp-reviewer
argument-hint: target=<spec or change> focus=<bugs|security|tests|architecture>
---

Review the target work and present findings first.

Inputs:
- target: ${input:target:spec section, files, or change summary}
- focus: ${input:focus:bugs, security, tests, architecture, or all}

Use the repository rule set and relevant phase spec as the baseline.