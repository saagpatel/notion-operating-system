# Governance + Actuation Layer — Subagent Map

*Produced by map-governance (Explore agent), 2026-07-10. File:line refs cited by the agent; spot-verify before acting on any single claim.*

## ARCHITECTURE — the approval state machine

**Where state lives:** Approval state is authoritative in **Notion**, not local config. The repo is stateless per-run: every command reads Action Request / Policy / Execution pages from Notion data sources, computes readiness in pure functions, performs the external write, then writes results back to Notion. Local JSON config is the **policy source of truth** (what's allowed); Notion is the **human approval surface + system of record** (what's approved, what happened).

**Two status axes on an Action Request** (`src/notion/local-portfolio-governance.ts:33-41`, `:177`):
1. `ActionRequestStatus`: `Draft → Pending Approval → Approved` (or `Rejected`/`Expired`/`Canceled`), then `Executed` / `Shadow Logged`.
2. `executionIntent`: `"Dry Run" | "Ready for Live"` — a second gate layered on top of `Approved`.

**Lifecycle transitions:**
- **Create:** recommendations/weekly-review/manual sources sync into Action Request pages via `runActionRequestSyncCommand` (`src/notion/action-request-sync.ts:61`). Sync also auto-expires stale `Approved` requests past `expiresAt` (`action-request-sync.ts:150-160`; predicate `local-portfolio-governance.ts:1012-1022`).
- **Approve:** a human sets Status→`Approved` in Notion and adds themselves to the Notion `Approver` People property. `approverIds` is read straight from that property (`local-portfolio-governance-live.ts:231`). The runner never self-approves.
- **Dry run:** `runActionRunnerCommand(mode:"dry-run")` (`action-runner.ts:140`) picks `Approved` + `executionIntent==="Dry Run"` (`:178`), runs `prepareActionDryRun` (`action-dry-run.ts:66`) → read-only preflight against the live provider → `computePostDryRunReadiness` (`local-portfolio-actuation.ts:1899`). If the simulated live check passes, it flips the request to `Ready for Live` and writes it back to Notion (`action-runner.ts:420-428`).
- **Live execute:** `runActionRunnerCommand(mode:"live")` picks `Approved` + `Ready for Live` (`:180`), re-runs the full readiness gate, then calls the real provider write. On success Status→`Executed` and `executionIntent` resets to `Dry Run` (`action-runner.ts:388-405`) — every live run must re-earn `Ready for Live` via a fresh dry run.

**Per-run execution record:** for each request the runner creates a Notion Execution page in `Started` state (`action-runner.ts:281-320`), attempts the action in a try/catch, then patches the page to the final status + provider result / failure notes (`:370-386` success, `:507-517` catch). Both executed and failed actions become first-class Notion Execution pages carrying `Response Classification`, `Reconcile Status`, `Failure Notes`, and a `Compensation Plan`.

## MECHANISMS

**Policy evaluation** (`GovernancePolicyPlan`, `local-portfolio-governance.ts:66-78`; config `config/local-portfolio-governance-policies.json`, 9 policies). Each policy carries `executionMode` (`Disabled|Shadow|Approved Live`), `approvalRule` (`No Write|Single|Dual|Emergency`), `identityType`, `dryRunRequired`, `rollbackRequired`, `defaultExpiryHours`, and an `allowedSources` allowlist. Live config: all 9 are `Approved Live` / `Single Approval`, identity `GitHub App` or `Team Token`, classes `Comment`/`Issue`/`Deployment Control`. Strategy notes hard-state "Do not allow any Phase 6 policy to mutate an external system live by default."

**The readiness gate** — `evaluateActionRequestReadiness` (`local-portfolio-actuation.ts:1726`) is the single choke point. Returns an array of blocking notes; non-empty blocks live execution. Checks: linked policy exists; Status===`Approved` (`:1743`); source type in `policy.allowedSources` (`:1748`); approver count meets `approvalRule` (`:1749-1760`); not expired (`:1762`); payload completeness per action key; GitHub additive-only guards — labels/assignees can't *remove* (`:1798-1810`); Vercel preflight "provider exercised" + pinned-target still matches candidate (`:1832-1866`); target resolved; **fresh successful dry run within `freshDryRunMaxAgeHours`** (`:1870-1878`); policy is `Approved Live` (`:1880`); live credentials present (`:1883-1893`).

**Allowlist (targets)** — `config/local-portfolio-actuation-targets.json` (66 target entries), each `{sourceIdentifier, allowedActions, titlePrefix, defaultLabels, supportsIssueCreate, supportsPrComment}`. `resolveActuationTarget` maps a request's source to a target rule; unlisted/mismatched yields "Target … is not resolved" and blocks.

**Runner decision** — `evaluateActionRunnerDecision` (`action-runner.ts:76`): skips if no supported linked policy, live-mode not `Ready for Live`, any validation notes exist, or an **idempotent duplicate** (same `idempotencyKey`, mode `Live`, status `Succeeded`) already exists (`:96-107`). Idempotency key = hash of `{requestId, actionKey, targetSourceId, mode, payload}` (`computeActuationExecutionKey`).

**Provider write paths:**
- **GitHub** (`executeGitHubAction`, `:2148`) mints a short-lived (~9-min JWT) **scoped GitHub App installation token** per owner/repo (`mintGitHubInstallationAccess`, `:2020`) from `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_PEM`. Writes are additive (create issue, comment, additive labels/assignees).
- **Vercel** (`executeVercelRedeploy/Rollback/Promote`, `:2507/:2584/:2666`) uses a raw `VERCEL_TOKEN` bearer, then **post-action verification** confirms the deployment; mismatch returns `Compensation Needed` instead of `Succeeded` (`:2553-2569`).

**Webhook verification** (`local-portfolio-governance.ts:759-782`): `verifyGitHubSignature` (HMAC-SHA256, `sha256=` prefix) and `verifyVercelSignature` (HMAC-SHA1), both via constant-time `safeCompare`. `createWebhookReceiptEnvelope` (`:787`) reads the secret from the provider's `secretEnvVar`, verifies, marks receipt `Verified`/`Rejected`. Webhooks are **shadow/evidence-only** in this phase (`mode:"shadow"`, spool `./var/notion-webhook-shadow`); they don't drive actuation.

## SAFETY RAILS (what prevents an ungoverned external write)

1. **Dual gate:** must be both `Approved` (human, in Notion) AND `Ready for Live` (earned via dry run) — `action-runner.ts:178-180`, `local-portfolio-actuation.ts:1743`.
2. **Mandatory fresh dry run** before live, age-bounded by `freshDryRunMaxAgeHours`; every live success resets intent to `Dry Run` so approval can't be replayed (`:1870`, `action-runner.ts:397`).
3. **Readiness notes hard-block** live in the runner decision (`action-runner.ts:90-92`).
4. **Policy allowlists:** `executionMode` must be `Approved Live` (`:1880`), source type in `allowedSources` (`:1748`), target in the 66-entry targets allowlist.
5. **Idempotency** prevents duplicate live writes (`action-runner.ts:96-107`).
6. **Scoped, ephemeral GitHub identity** (per-repo App installation token, ~9-min TTL), not a broad PAT (`:2020-2028`).
7. **Additive-only GitHub mutations** — preflight blocks label/assignee removals at readiness (`:1798`) and again inside `executeGitHubAction` (`:2240`).
8. **Post-write verification** for Vercel; unconfirmed → `Compensation Needed` + stored compensation plan, not silent success.
9. **Webhook HMAC verification with constant-time compare**, shadow-mode only (no actuation coupling).
10. **Config-declared intent:** policy strategy notes forbid default live mutation; expiry auto-sweeps stale approvals.

## ROUGH EDGES

- **Break-glass tokens are vestigial.** `GITHUB_BREAK_GLASS_TOKEN` / `VERCEL_BREAK_GLASS_TOKEN` are declared in the runtime schema (`src/config/runtime-config.ts:19-20,43-44`), governance `envRefs` (`local-portfolio-governance.ts:373-376`), and Notion select colors — but the ONLY logic reading them is the audit summary, gated on `policy.identityType === "Break Glass Token"` (`:423-426`), and NO policy in config uses that identity. `VERCEL_BREAK_GLASS_TOKEN` is referenced by ZERO execution branches. There is no actual break-glass/emergency-override execution path; it's an audit-only concept with no enforcement wired in.
- **Vercel uses a broad `VERCEL_TOKEN` bearer** (`:2510,2589,2671`) while GitHub uses a narrowly-scoped App token — asymmetric blast radius. Deployment control rides a full-scope token with no per-project scoping at the credential layer; the only project pinning is the `providerRequestKey` candidate-match check (`:1843-1866`).
- **Approver check is weak.** `Single Approval` needs only `approverIds.length >= 1` (`:1751`) from a Notion People property, with NO requester≠approver separation and NO authorization check. `Dual Approval` (`:1754`) and `Emergency` rules are implemented in the type/gate but UNUSED by any config policy, so the two-person path is untested in practice.
- **Dry-run readiness fabricates a synthetic "fresh dry run" record** with `status:"Succeeded"` to simulate the live gate inside `computePostDryRunReadiness` (`:1936-1972`). Reasonable simulation, but easy to misread; real freshness enforcement only bites at live time against persisted executions.
- **Two sequential Notion writes per execution** (create `Started` page `:281`, patch `:288`) with no transaction — a crash between leaves a `Started` page with minimal metadata. Recovery relies on `Reconcile Status: Pending` + webhook drain, not atomicity.
- **`fetchGitHubActionPreflight` silently returns `undefined`** when live creds are missing (`:2086`), so a dry run with no App creds skips preflight entirely rather than flagging it; the missing-credential note only appears once intent is `Ready for Live` (`:1890`). Early dry runs can look "clean" without ever exercising the provider.

**Key files:** `src/notion/local-portfolio-actuation.ts` (readiness gate `:1726`, post-dry-run `:1899`, executors `:2148/:2507/:2584/:2666`, App token `:2020`), `action-runner.ts` (orchestration `:140`, decision `:76`), `action-dry-run.ts` (`:66/:182`), `local-portfolio-governance.ts` (types `:22-56`, webhook verify `:759`, config parsers `:1029`), `config/local-portfolio-governance-policies.json`, `config/local-portfolio-actuation-targets.json`.
