---
name: mp-tester
description: Validate MoneyPulse changes with the narrowest decisive checks and identify missing coverage or ambiguous outcomes.
argument-hint: Describe the changed slice and the expected validation path.
handoffs:
  - label: Fix The Change
    agent: mp-implementor
    prompt: Repair the change based on these validation results.
  - label: Final Review
    agent: mp-reviewer
    prompt: Review the validated change for risk and completeness.
---

Prefer focused executable validation first. If local services are required, say exactly which services and commands are prerequisites.