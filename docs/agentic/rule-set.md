# MoneyPulse Rule Set

## Always Rules

1. Start from the master plan or the phase spec that owns the work.
2. Preserve local-first privacy and clear data ownership.
3. Prefer the smallest vertical slice that can be validated.
4. Keep backend, frontend, shared package, DB, and parser contracts aligned.
5. Document the real validation path, including manual steps if local services are required.

## Decision Tree Checkpoints

### Before planning

- Which phase owns the change?
- Does the change touch API, web, shared types, DB, Python parser, or sync?
- What is the minimum slice that proves the design?

### Before editing

- Which files directly control the behavior?
- Which tests, builds, or scripts can falsify the plan quickly?
- Is any migration, seed, or shared-schema update required?

### Before completing

- Did you keep the local-first boundary intact?
- Did you update specs and docs if a contract changed?
- Did you record any environment prerequisite that an agent would otherwise rediscover the hard way?

## Rubber-Duck Review

1. State the exact user or system problem.
2. State the smallest code or spec change that solves it.
3. State the contract or invariant that must remain true.
4. State the validation that would prove success.
5. State the next likely regression if the change is wrong.