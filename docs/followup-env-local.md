# Executive summary

The current env-local bucket no longer matches the older "all still remaining" posture in the batch and master artifacts. Those artifacts are still the source baseline for what each project originally needed, but the current bucket state now splits cleanly into 3 verified-complete projects and 5 projects with one clear remaining blocker story each.

Verified complete for this bucket:
- `GPT_RAG`
- `SnippetLibrary`
- `Nexus`

Still blocked for this bucket:
- `OPscinema`: one packaged-app Screen Recording permission gate
- `TicketDocumentation`: one final onboarding and monitoring runtime closeout
- `TicketHandoff`: saved Jira config and keychain credential missing
- `PersonalKBDrafter`: saved Jira and Confluence credentials plus local app state missing
- `SlackIncidentBot`: runtime config and Docker/PostgreSQL services missing

No repo-wide audit rerun is needed for this packet. The remaining work is now almost entirely environment setup, credentials, saved app state, macOS permission, or live runtime proof rather than code cleanup.

# Project-by-project plan

| project | already_proven | current_blocker | prerequisite_type | exact_next_action | minimum_verification | user_input_needed | done_signal |
|---|---|---|---|---|---|---|---|
| `PersonalKBDrafter` | Repo surface is normalized. `npm run check:prereqs`, `npm run lint`, `npm run build`, and `cargo test` already pass. | No saved `kb-drafter-jira` or `kb-drafter-confluence` credentials are present, and local app state is empty. | `credentials + saved app state` | Save both keychain credentials, seed one usable local settings row and one draftable article row, then run one real Jira-to-Confluence drafting happy path. | One end-to-end draft completes using the saved credentials and seeded local state, with no manual DB or keychain patching during the run. | Saved Jira credential, saved Confluence credential, and one usable seeded local article/settings state. | A real drafting run succeeds from saved local state and produces the expected Confluence-side draft output. |
| `GPT_RAG` | Local dev environment was restored. Required Ollama models are now present. Reranker dependencies and cache snapshot are now present. `doctor --json` reports `runtime_ready: true`, and `runtime-check --json` passes. | None for this bucket. | `none` | None for env-local follow-up. Keep the verified runtime-ready state and do not reintroduce model or cache drift. | Already closed by the passing `doctor --json` and `runtime-check --json` proofs. | `none` | `runtime_ready` remains true and the runtime smoke stays green. |
| `SlackIncidentBot` | Repo cleanup is complete, and local library proof is already green. | `.env` is still missing, required Slack/PostgreSQL env vars are still absent, and Docker is still unavailable. | `runtime service + credentials` | Populate `.env` with the real Slack and PostgreSQL settings, bring up Docker/PostgreSQL, then run one live Slack-triggered happy path against the configured database. | The app boots with real config, reaches PostgreSQL, and processes one real Slack event or command end to end. | Slack bot token, Slack signing secret, PostgreSQL connection details, and a working Docker/runtime environment. | One live Slack interaction succeeds and the expected DB-backed behavior is visible. |
| `SnippetLibrary` | Swift baseline was already healthy. `origin` was already canonical. The dirty tree was narrowed to the intended desktop interaction slice, and `swift test` now passes on that bounded slice. | None for this bucket. | `none` | None for env-local follow-up. Keep the bucket blocker closed by preserving the narrowed slice and the explicit separation from deferred work. | Already closed by the narrowed worktree plus passing `swift test`. | `none` | The scope-control blocker stays closed: the active slice remains bounded and the deferred work stays explicitly separated. |
| `TicketHandoff` | Earlier dependency cleanup and backend proof were already complete. Frontend baseline is restored, and `npm test -- --run` plus `npm run build` already pass. | The local app database still has no saved `api_config` row, and the macOS keychain still has no `com.tickethandoff.jira` item. | `credentials + saved app state` | Seed one valid Jira config row into the local app DB, save one Jira credential in the expected keychain item, then run one live Jira-backed handoff happy path. | One Jira-backed handoff completes using saved config and keychain credentials rather than manual overrides. | One real or test Jira tenant, one saved Jira keychain credential, and one valid local `api_config` row. | A live handoff succeeds and creates or updates the expected Jira-side result. |
| `OPscinema` | Packaged-app identity is correct, `make smoke-app-verify` passes, and the installed packaged app opens cleanly. | The packaged app still needs Screen Recording permission for `com.opscinema.desktop`. | `macOS permission` | Grant Screen Recording to `com.opscinema.desktop`, relaunch the packaged app, and rerun the packaged smoke checklist covering Start Handoff Session, Apply Step Edit (Retry), export creation, and relaunch persistence. | The full packaged-app smoke checklist passes once after permission is granted. | Manual Screen Recording grant in Privacy & Security for `com.opscinema.desktop`. | The packaged-app happy path runs end to end with export creation and relaunch persistence intact. |
| `Nexus` | Dirty-branch reconciliation with `origin/main` was already done. The missing Electron build scripts were restored. `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e:smoke` now pass. | None for this bucket. | `none` | None for env-local follow-up. Keep the restored desktop build-script surface intact. | Already closed by the passing desktop smoke proof. | `none` | Desktop smoke remains green on the preserved dirty branch. |
| `TicketDocumentation` | Frontend dependency baseline was restored earlier. `pnpm build`, `pnpm test`, and `cargo check` already pass. The app now launches, Screen Recording and Ollama are already satisfied, but onboarding is still incomplete. | The final runtime closeout is still incomplete because monitoring has not been started and the end-to-end documentation-generation flow has not been closed from the app. | `runtime service` | Relaunch the app, complete the onboarding step that starts monitoring, confirm activity capture begins, then run one documentation-generation happy path against the live local model. | `onboarding_completed` flips true, activity rows begin to appear, and one documentation result is generated successfully from the live app flow. | One manual in-app monitoring start/onboarding completion if the webview control still cannot be driven reliably from automation. | The first full runtime pass succeeds: onboarding completes, monitoring records activity, and documentation generation returns output from the live model. |

# Recommended execution order

1. `OPscinema`
2. `TicketDocumentation`
3. `TicketHandoff`
4. `PersonalKBDrafter`
5. `SlackIncidentBot`

`GPT_RAG`, `SnippetLibrary`, and `Nexus` drop out of the execution order because their env-local blockers are already closed.

# Shared prerequisites

- Jira-backed runtime access for both `PersonalKBDrafter` and `TicketHandoff`, including saved keychain credentials and a usable tenant or test fixture.
- One packaged-app Screen Recording grant for `OPscinema` under `com.opscinema.desktop`.
- Real Slack and PostgreSQL runtime inputs for `SlackIncidentBot`, including Docker or the equivalent local service availability.
- One manual in-app monitoring/onboarding completion step for `TicketDocumentation` if automation still cannot reliably reach the final control.

# Done definition

- `GPT_RAG`, `SnippetLibrary`, and `Nexus` remain green on their existing bucket-closure proofs.
- `OPscinema` passes the packaged-app smoke checklist after Screen Recording is granted to `com.opscinema.desktop`.
- `TicketDocumentation` completes onboarding, starts monitoring, records activity, and generates one documentation result with the live local model.
- `TicketHandoff` completes one live Jira-backed handoff using saved local config and keychain credentials.
- `PersonalKBDrafter` completes one Jira-to-Confluence drafting run using saved credentials and seeded local app state.
- `SlackIncidentBot` boots with real config, reaches PostgreSQL, and completes one live Slack-triggered happy path.
- `docs/followup-env-local.md` and `docs/followup-env-local-summary.json` describe the same verified bucket state.
