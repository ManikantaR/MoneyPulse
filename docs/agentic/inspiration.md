# Inspiration

## Guiding Inputs

### GitHub Awesome Copilot

- Use native customization surfaces: repo instructions, path instructions, prompts, agents, and portable skills.
- Keep always-on repo instructions short and broad, then move task-specific workflows into prompts, agents, and skills.

Reference:

- [github/awesome-copilot](https://github.com/github/awesome-copilot)

### GitHub And VS Code Customization Docs

- `.github/copilot-instructions.md` is for broad repo guidance.
- `.github/instructions/*.instructions.md` is for path-specific guidance.
- `.github/prompts/*.prompt.md` is for repeatable slash workflows.
- `.github/agents/*.agent.md` is for persistent personas and handoffs.
- `.github/skills/<name>/SKILL.md` is for portable capabilities.

References:

- [GitHub repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
- [VS Code custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
- [VS Code prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files)
- [VS Code agent skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

### Matt Pocock Skills

- Strong skills are narrow, explicit, and easy to compose.
- `grill-me` is a good model for forcing decision-tree clarity before implementation.

Reference:

- [mattpocock/skills](https://github.com/mattpocock/skills)

### Andrej Karpathy

- Prefer first-principles reasoning and specs that surface hidden assumptions.

Reference:

- [karpathy.ai](https://karpathy.ai/)

### Burke Holland

- Keep developer workflows practical and ergonomic; avoid over-complicating the system meant to help coding.

Reference:

- [Burke Holland](https://github.com/burkeholland)