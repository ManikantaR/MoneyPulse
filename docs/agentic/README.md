# Agentic Development Guide

This repository is configured for GitHub Copilot customization in both VS Code chat and Copilot CLI sessions.

## Included Surfaces

- `AGENTS.md` — repo-wide agent operating guidance
- `.github/copilot-instructions.md` — always-on repo instructions
- `.github/instructions` — path-specific instructions
- `.github/agents` — custom agents
- `.github/prompts` — reusable slash prompts
- `.github/skills` — portable Agent Skills
- `docs/agentic/rule-set.md` — mandatory review and decision-tree rules

## Recommended Workflow

1. Start with `mp-lead` to route the task.
2. Use `mp-planner` or `mp-spec-generator` before major implementation.
3. Use `mp-implementor` for coding work.
4. Run `mp-tester` and `mp-reviewer` before completion.
5. Use the `rubber-duck-review` skill or `/mp-rubber-duck` prompt before handoff.

## VS Code Usage

1. Open Chat Customizations.
2. Select the repository agent such as `mp-lead`.
3. Run prompt files from `/` such as `/mp-phase-orchestrate` or `/mp-expand-phase-spec`.
4. Run skills from `/` such as `/grill-me` or `/rubber-duck-review`.

## Copilot CLI Notes

- In VS Code Copilot CLI sessions, workspace custom agents can be selected when creating the session.
- Prompt files and skills are available as slash commands in Copilot CLI sessions.
- Recommended entry points:
  - `/mp-phase-orchestrate phase=PHASE6 task=Implement budget webhook retries constraints=preserve current alert engine`
  - `/mp-expand-phase-spec phase=PHASE7 feature=MCP hardening current-state=phase spec exists but needs more implementation detail`
  - `/mp-rubber-duck work=budget alert retry flow summary=need resilient retry and clear audit trail`

## Memory Best Practice

- Keep stable repo facts in `docs/agentic/memory.md` and repo memory.
- Let the lead agent pass brief and decision context.
- Let worker agents re-check nearby code before editing rather than trusting stale summaries blindly.