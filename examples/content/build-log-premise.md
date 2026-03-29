---
title: "Premise: Next.js build passes while standalone type-check is blocked"
---

# Build Log Entry

## What Was Planned

Verify Premise locally, identify the first real blocker if one exists, and turn the project from a generic Notion row into a specific GitHub-backed operating record.

## What Shipped

- Ran `npm run build` and confirmed the Next.js production build completed successfully.
- Verified the current app surface compiles into route output for the public debate pages, auth callback, and debate API routes.
- Identified a concrete tooling blocker in the standalone TypeScript path instead of leaving the row at generic "run it later" language.
- Prepared the project for the missing Notion workflow pass so this check evidence is attached to the live operating record.

## Blockers

`npm run type-check` currently fails because `tsconfig.json` includes stale `.next/types/**/*.ts` paths that are no longer present in the repo. The project can still complete a Next.js production build, but the standalone type-check lane is not healthy until those generated-type references are refreshed or narrowed.

## Lessons

Premise is in a better state than a blank operating row implied. The right story is not "build is unknown" but "production build works and the remaining blocker is a brittle generated-types include."

## Next Steps

- Regenerate or remove the stale `.next/types` include targets in `tsconfig.json`.
- Rerun `npm run type-check` until the standalone TypeScript lane is clean.
- Follow with a manual app pass on the core debate creation and viewing flow.
