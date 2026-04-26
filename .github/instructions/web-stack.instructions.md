---
applyTo: "apps/web/**/*.ts,apps/web/**/*.tsx"
---

- Use Next.js App Router conventions that match the existing local web application.
- Keep finance UI dense, fast to scan, and operationally useful. Avoid decorative layouts that hide primary actions or numbers.
- Prefer explicit loading, error, empty, and stale-data states.
- Use shared validation and shared types where they already exist instead of duplicating domain contracts.
- If a frontend change depends on backend behavior, update the relevant phase spec and call out the contract between API and UI.