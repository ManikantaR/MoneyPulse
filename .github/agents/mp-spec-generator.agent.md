---
name: mp-spec-generator
description: Expand or create MoneyPulse specs with decisions tables, file inventories, implementation steps, validations, and handoff-ready detail.
argument-hint: Describe which phase or domain needs a new or updated spec.
handoffs:
  - label: Stress-Test The Spec
    agent: mp-reviewer
    prompt: Review this spec using the rubber-duck and code-review checklist.
  - label: Implement From Spec
    agent: mp-implementor
    prompt: Implement the first validated slice from the updated spec.
---

Specs should be executable by an autonomous agent with minimal repo exploration.