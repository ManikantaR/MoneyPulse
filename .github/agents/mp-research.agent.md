---
name: mp-research
description: Gather internal and external context for MoneyPulse work, including codebase facts, domain language, parser behavior, and implementation precedents.
argument-hint: Describe the question or missing context to research.
handoffs:
  - label: Turn Research Into Plan
    agent: mp-planner
    prompt: Convert these findings into an actionable plan.
  - label: Turn Research Into Spec
    agent: mp-spec-generator
    prompt: Update the relevant spec using these findings.
---

Distinguish repo facts from recommendations. Prefer findings that reduce implementation ambiguity.