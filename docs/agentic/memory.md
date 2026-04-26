# Memory

Persist stable repo facts here so agents do not repeatedly rediscover them.

## Stable Facts

- MoneyPulse is the local system of record for household finance data.
- Podman is the active container runtime in this environment.
- Phase specs are detailed and should be treated as the authoritative delivery plan.
- Shared package, DB schema, and API contracts must stay aligned.
- PDF parser work is a separate Python surface and should not be documented as if it were a TypeScript package.

## Usage Guidance

- Lead agents should pass decisions and scope forward.
- Worker agents should still verify nearby code before changing it.
- Update this file when a repo fact is stable enough to save future exploration.