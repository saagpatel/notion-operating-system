# Maintenance Playbook

Use this as the default maintenance rhythm now that the numbered structural phases are complete.

## Weekly

- Review incoming Dependabot pull requests.
- Review the latest `Dependency Hygiene` workflow run.
- Triage any failed workflow, audit finding, or install-smoke regression within the same week.

## Monthly

- Run `npm run release:prepare`.
- Run `npm run verify:fresh-clone`.
- Review `package.json` overrides and remove any mitigation that upstream no longer needs.

## Quarterly

- Review GitHub Actions major versions and update workflow pins when needed.
- Confirm the required branch-protection checks still match the active workflow names:
  - `workflow-lint`
  - `quality-gates`
  - `fresh-clone-verify`
- Re-check both supported install paths:
  - GitHub ref install
  - GitHub release tarball install

## After workflow or package-surface changes

- Run `npm run verify`.
- Run `npm run release:prepare` if install, package, or release behavior changed.
- Update `README.md` if operator or consumer behavior changed materially.
- Update `HANDOFF.md` so the next session inherits the current reality instead of stale assumptions.

## Sandbox rule

Use the `sandbox` profile before live changes that touch:

- `control-tower`
- `signals`
- `governance`
- `rollout`
- profile clone, bootstrap, import, export, or upgrade flows

Treat `notion-os --profile sandbox doctor` as the proof gate for live sandbox safety. If it reports token overlap, target overlap, or path masking, fix the sandbox config before any live rehearsal.
