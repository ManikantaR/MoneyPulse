---
name: mp-phase-orchestrate
description: Route a MoneyPulse task through the right specialist agent and phase context.
agent: mp-lead
argument-hint: phase=<phase> task=<goal> constraints=<constraints>
---

Inputs:
- phase: ${input:phase:phase number or domain}
- task: ${input:task:goal or request}
- constraints: ${input:constraints:security, parser, infra, UX, or timeline constraints}

Steps:
1. Identify the owning phase spec and domain surface.
2. Decide whether the next step is planning, spec work, implementation, testing, review, architecture, security, or research.
3. Summarize the next specialist handoff in 5-10 lines.
4. Include the rubber-duck checkpoint before implementation begins.