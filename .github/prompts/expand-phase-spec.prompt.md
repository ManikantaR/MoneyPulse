---
name: mp-expand-phase-spec
description: Expand a MoneyPulse phase spec into an implementation-ready document.
agent: mp-spec-generator
argument-hint: phase=<phase> feature=<feature> current-state=<summary>
---

Expand the target phase spec using the repository's established structure:

- status and goals
- decisions summary
- file inventory by layer
- dependency commands
- implementation steps
- validation and acceptance criteria
- risks and handoff notes

Ground the spec in existing code and current repo conventions.