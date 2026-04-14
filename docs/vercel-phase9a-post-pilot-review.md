# Vercel Phase 9A Post-Pilot Review

Updated: 2026-04-13

## Summary

Phase 9A succeeded.

The repo now has one real non-GitHub governed mutation lane:

- provider: `Vercel`
- action: `vercel.redeploy`
- pilot target: `evolutionsandbox`
- scope: one team-owned production project
- webhook posture: shadow/evidence-only

The pilot proved that the Notion governance lane, provider sync lane, and provider execution lane can work together without widening into a broad multi-provider abstraction.

## What Changed

- Vercel readiness checks now require `VERCEL_TOKEN` and fail honestly when the provider is not exercised.
- Vercel dry sync now performs a real provider read in dry mode instead of silently skipping provider execution.
- External signal source modeling now includes explicit Vercel scope fields:
  - `Provider Scope Type`
  - `Provider Scope ID`
  - `Provider Scope Slug`
- The actuation layer now supports one Vercel action family:
  - `vercel.redeploy`
- The actuation target model now supports explicit Vercel fields:
  - `vercelProjectId`
  - `vercelTeamId`
  - `vercelTeamSlug`
  - `vercelScopeType`
  - `vercelEnvironment`
- The governance policy for `vercel.redeploy` is now live-capable.
- `vercel.promote_or_rollback` remains disabled.

## Evidence

### Provider readiness

- `governance:audit` passed with no missing auth refs when `VERCEL_TOKEN` was present.
- `provider-expansion-audit` moved Vercel from `scaffolded` to `ready`.
- `signals:sync -- --provider vercel` exercised one real Vercel source in dry mode.

### Governance lane

- A real Notion action request was created for `Redeploy evolutionsandbox (Phase 9A pilot)`.
- The dry-run command completed successfully.
- The request graduated to `Ready for Live`.

### Live execution

- The live action runner executed successfully.
- The execution row recorded:
  - provider: `Vercel`
  - status: `Succeeded`
  - reconcile status: `Confirmed`
- Vercel showed the new production deployment:
  - new deployment id: `dpl_CRVMfPx7eDjjgFwsn6rMNqwZDMvM`
  - original deployment id: `dpl_Assb8HTLaYqeA6Ljio6ewgi62mUi`

## What Phase 9A Proved

- The existing approval and execution-ledger contract is portable beyond GitHub.
- A bounded Vercel deployment-control lane can stay understandable when it is narrowly scoped.
- Team-scoped provider metadata must be explicit in both source and target models.
- “Provider exercised” must be a first-class readiness concept; otherwise dry mode can create false confidence.

## What Phase 9A Did Not Prove

- Multi-project Vercel rollout behavior
- Promotion flows
- Rollback flows
- Webhook-driven trust for Vercel execution
- Whether broader provider expansion remains low-noise at larger scale

## Decision

Phase 9A should be treated as complete.

The next step should not be “add more verbs.” The next step should be a narrow widening step that tests whether the redeploy lane stays boring and auditable across a few more explicit projects.

## Recommendation

Proceed to **Phase 9B: small allowlist expansion for `vercel.redeploy`**.

Do not combine the following in the same phase:

- widening redeploy to more projects
- adding `vercel.promote`
- adding `vercel.rollback`

Those should remain separate decisions.
