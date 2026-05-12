# Architecture Decision: Persistence Strategy
## Devil's Advocate + DecisionStressTest

**Date:** 2026-05-12
**Status:** Decision pending
**Author:** Claude Code (analysis only, no code changed)

---

## 1. Current State

### Devil's Advocate (`/Users/d/Projects/Devil's Advocate`)
- **Stack:** Next.js 15, React 18, `better-sqlite3` (raw SQL, no ORM), Anthropic SDK
- **DB layer:** `src/lib/db/index.ts` — singleton `better-sqlite3` instance, WAL mode, schema applied inline via `applySchema()` at startup
- **DB path:** hardcoded to `<cwd>/database/devils-advocate.db`
- **Deployment state:** Local-only. `DEPLOY.md` explicitly warns **do not deploy to Vercel** (ephemeral filesystem kills the DB). Identifies Turso as the recommended next step.
- **Tests:** Vitest unit tests on `queries.ts`

### DecisionStressTest (`/Users/d/Projects/DecisionStressTest`)
- **Stack:** Next.js 16, React 19, `better-sqlite3` + `drizzle-orm`, OpenAI structured outputs
- **DB layer:** `src/lib/db/client.ts` — singleton via `globalThis.__decisionStressDb__`, WAL + foreign keys + busy timeout. `DATABASE_PATH` env var configures path; defaults to `.local/dev.sqlite`. Full backup/restore CLI (`db:backup`, `db:restore`).
- **Deployment state:** Explicitly designed as a **private local app**. `env-schema.ts` includes an `UNSAFE_ALLOW_NONLOCALHOST` flag — non-localhost access is guarded and off by default. `APP_ENV: local-prod` is the production mode. No Vercel deployment intent.
- **Tests:** Vitest unit + Playwright E2E, fixture evals, `npm run release:check` gate

---

## 2. Data Model Summary

### Devil's Advocate — 2 tables + 1 virtual

| Table | Key columns | Notes |
|---|---|---|
| `analyses` | id, title, input_text, context, report_json, model, tokens_used, created_at, deleted_at | Soft delete; report_json is the full AI critique blob |
| `messages` | id, analysis_id (FK), role, content, created_at | Chat drill-down per analysis |
| `analyses_fts` | virtual FTS5 table over title + input_text | Full-text search |

- **Relations:** 1 analysis → N messages (cascade delete)
- **Scale:** Personal tool. Hundreds to low thousands of rows. Single user, no tenancy.
- **Query patterns:** List by created_at DESC, soft-delete filter, FTS search, fetch by id.

### DecisionStressTest — 8 tables

| Table | Purpose |
|---|---|
| `decisions` | Root record: slug, title, decision_type, current_stage, latest_snapshot_id |
| `decision_snapshots` | Immutable intake revisions (versioned). raw_intake_json as JSON blob. |
| `stage_runs` | Each AI analysis stage run: stage name, version, status, prompt_version, timing |
| `normalized_decisions` | Normalization stage structured output (JSON payload) |
| `premortem_analyses` | Premortem stage output (JSON payload) |
| `regret_analyses` | Regret minimization stage output (JSON payload) |
| `synthesis_drafts` | Final synthesis/recommendation draft (JSON payload) |
| `recommendations` | Structured recommendation with label, confidence, factors |
| `decision_memos` | Final exported memo record |

- **Relations:** Decisions → Snapshots → StageRuns → {normalized, premortem, regret, synthesis, recommendations, memos} (all cascade delete)
- **Scale:** Personal workbench. Tens to hundreds of decisions with deep snapshot/run trees. Single user.
- **Query patterns:** Current-snapshot projection (5+ table join), historical comparison, stage status aggregation, supersede runs on re-intake. Meaningful relational depth.

---

## 3. Shared Database / Cross-Project Relationship

No shared database. These are independent apps with separate SQLite files and no cross-references. They share a conceptual domain (decision analysis) but have no data model overlap. There is no reason to co-locate them in a shared database.

---

## 4. Trade-off Analysis

### Option A: LibSQL / Turso (edge-native SQLite)

| Dimension | Devil's Advocate | DecisionStressTest |
|---|---|---|
| **Fit** | Excellent — simple schema, blob-heavy, single user | Good — complex schema still within SQLite's strengths for personal scale |
| **Migration effort** | Low — replace `better-sqlite3` with `@libsql/client`; SQL stays the same | Medium — Drizzle has a libSQL adapter; dialect swap needed; WAL pragma handling differs |
| **Ops** | Near-zero — Turso free tier; or self-host sqld | Same |
| **FTS5** | Turso cloud does not support FTS5; embedded replica mode preserves it locally | Same limitation |
| **Cost** | Free tier: 9GB / 500M reads/month — far exceeds personal scale | Same |
| **Enables** | Vercel deployment | Could enable deployment, but DST is private-local by design |

### Option B: Stateful Host (Vercel Postgres / Neon / Railway)

| Dimension | Devil's Advocate | DecisionStressTest |
|---|---|---|
| **Fit** | Overkill — 2 tables, no analytics | Moderate — 8 tables with real relational depth; Postgres handles joins cleanly |
| **Migration effort** | High — rewrite raw SQL to pg driver; FTS5 → tsvector; schema migration | High — Drizzle supports Postgres natively but full dialect rewrite required |
| **Ops** | Neon/Railway managed = near-zero | Same |
| **Cold-start latency** | Neon serverless has connection overhead | Same |
| **Cost** | Neon free tier or Railway $5/mo hobby | Same |
| **Enables** | Vercel deployment | Overkill for a local-private tool |

### Option C: Standard Postgres (Supabase, Fly.io, self-hosted)

| Dimension | Devil's Advocate | DecisionStressTest |
|---|---|---|
| **Fit** | Overkill — no RLS, realtime, or complex analytics needed | Moderate — would benefit from Postgres JSON operators + window functions for history queries |
| **Migration effort** | High — same as B plus infrastructure setup | High — same |
| **Ops** | Higher than A or B | Same |
| **Cost** | Supabase free tier or Fly.io ~$5–10/mo | Same |
| **Enables** | Vercel + multi-user if ever needed | Overkill; DST is intentionally single-user private |

---

## 5. Recommendations

### Devil's Advocate → Migrate to Turso (libSQL)

**Recommended: Option A**

Rationale:
- `DEPLOY.md` already identifies Turso as the preferred path — this memo confirms it.
- 2-table schema with blob storage and FTS is SQLite's sweet spot. No query complexity justifies Postgres.
- `better-sqlite3` → `@libsql/client` is a thin swap; raw SQL strings are reused as-is.
- Enables Vercel deployment without any architectural rethink.
- Free tier covers any realistic personal-tool scale indefinitely.

**FTS5 caveat:** Turso cloud does not support the `fts5` extension. Two practical options:
  1. Use Turso's embedded replica mode — the local SQLite file syncs to cloud and FTS5 runs locally.
  2. Replace FTS5 with `WHERE title LIKE ? OR input_text LIKE ?` — sufficient at personal scale with a small dataset.

**Migration steps:**

1. Remove `better-sqlite3`, add `@libsql/client`
2. Rewrite `src/lib/db/index.ts`: create client via `createClient({ url, authToken })` from env vars `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
3. Convert `applySchema()` calls to async `client.batch([...])` statements for DDL
4. Rewrite `queries.ts`: replace synchronous `db.prepare().get/all/run()` with async `client.execute()` — all query functions become async
5. Update server actions in `src/actions/` to await the new async query functions (minimal change — actions are already async)
6. Decide on FTS: keep FTS5 via embedded replica OR replace search with LIKE-based fallback
7. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to `.env.example`
8. Provision the database via Turso CLI or dashboard; apply schema via the migration script
9. Update `next.config.mjs`: add `serverExternalPackages: ['@libsql/client']` if needed

**Estimated effort:** 1 focused session (~3–5 hours including testing).

---

### DecisionStressTest → Stay on Local SQLite

**Recommended: Keep current local `better-sqlite3` + Drizzle**

Rationale:
- DST is explicitly architected as a **private local workbench** — the `UNSAFE_ALLOW_NONLOCALHOST` guard is the architectural tell.
- The data model is more complex (8 tables, versioned snapshots, multi-stage runs), but it is well within SQLite's capabilities for single-user personal scale.
- DST already has mature local infrastructure: `db:backup`, `db:restore`, `npm run doctor`, `npm run release:check`. Cloud deployment would require rebuilding all of this for a remote target.
- Drizzle ORM is already in place — if the app ever outgrows local SQLite (team use, remote access), migrating to Postgres via Drizzle's `postgres-js` adapter would be the clean path with no query-layer changes.
- There is no deployment intent: no `DEPLOY.md`, no Vercel config, `APP_ENV: local-prod` as the production mode.

**Future path if cloud deployment becomes desired:** Drizzle `postgres-js` adapter + Neon (serverless Postgres) is the lowest-friction upgrade. Schema changes: `sqliteTable` → `pgTable`, text-stored dates → `timestamp`, JSON columns → `jsonb`. All repository query code stays unchanged.

---

## 6. Summary

| Project | Current | Recommendation | Change required |
|---|---|---|---|
| Devil's Advocate | `better-sqlite3`, local-only, Vercel-incompatible | **Turso (libSQL)** — cloud SQLite | Yes — driver swap, async refactor, FTS decision |
| DecisionStressTest | `better-sqlite3` + Drizzle, local-private by design | **Stay on local SQLite** | No |

---

## 7. Scope Boundary

This memo covers persistence and hosting strategy only. The following are out of scope:

- Multi-user access or auth for either project (both are personal tools)
- Merging the two projects into a shared database (no data model overlap)
- DST cloud deployment (intentionally out of scope by design)
- Production monitoring or backup strategy for Turso (operator responsibility post-migration)
