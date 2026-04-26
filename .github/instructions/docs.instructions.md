---
applyTo: "README.md,docs/**/*.md,PHASE*-SPEC.md,MONEYPULSE-PLAN.md,AGENTS.md,.github/prompts/*.md,.github/agents/*.md,.github/skills/**/SKILL.md"
---

- Write docs so an autonomous coding agent can act with minimal repo exploration.
- Prefer this order when relevant: status, decisions, file inventory, dependencies, implementation steps, validation, risks, handoff.
- Keep commands copy-pasteable and repo-specific.
- When a workflow depends on Podman, local services, or optional AI components, say so explicitly.
- Every plan, spec, and implementation workflow must include a rubber-duck review checkpoint.