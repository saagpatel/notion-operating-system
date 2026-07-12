# PR-3 Design — Unified Write Verification (P6)

*Fable, 2026-07-11. Design spec for delegation. Grounded in bytes: publisher.ts:259-423 (publishToDataSource), publisher.ts:594-604 (collectReadWarnings), managed-markdown-sync.ts:161-168 (read_back_converged), utils/markdown.ts exports.*

## The defect, precisely

Every live `Publisher` write ends with `readPageMarkdown` + `collectReadWarnings`. That readback is inspected for exactly two things: `truncated` and `unknownBlockIds`. The content is captured into `finalMarkdownReadback` and returned, but **nothing ever compares it to what we meant to write**. A patch the WAF mangled, a template that swallowed the body, a search-replace that matched the wrong span — all report success with a clean summary.

The repo already owns the hard part. `src/utils/markdown.ts` exports the normalized-equivalence family (`normalizeMarkdown`, `pageMarkdownMatches`, `normalizePageBodyMarkdown`), and three of the four write surfaces use it (managed-markdown-sync's `read_back_converged` rung, control-tower-sync, review-packet). The Publisher is the one surface flying blind. PR-3 closes that asymmetry — no new equivalence logic, just wiring the existing definition of "same" into the pathway that lacks it.

## Design

### 1. One verification primitive

New module `src/publishing/write-verification.ts`:

```ts
export type WriteVerification =
  | { status: "verified" }
  | { status: "diverged"; detail: string }
  | { status: "unverifiable"; reason: string };

export function verifyPublishedContent(input: {
  readbackMarkdown: string;
  title: string | undefined;
  expectation: WriteExpectation;
}): WriteVerification;
```

`WriteExpectation` is a discriminated union computed by the caller per mode (below). Pure function, no API calls — the readback the Publisher already performs is the input. Comparison goes through `pageMarkdownMatches` / `normalizeMarkdown`; PR-3 adds zero new normalization rules.

### 2. Expectation per publish mode

| Mode | Expectation | Rationale |
|---|---|---|
| `create_new_page`, no template | `{ kind: "full", markdown: parsedBody }` | We wrote the whole body; readback must normalize-match it. |
| `create_new_page` + template + post-patch | `{ kind: "full", markdown: parsedBody }` | The replace patch made parsedBody the whole content. |
| `create_new_page` + template, `postTemplatePatchMode: "none"` | `{ kind: "none" }` → `unverifiable`, reason `"template content is not locally known"` | Honest gap, reported as such — never silently "verified". |
| `replace_full_content` | `{ kind: "full", markdown: parsedBody }`, with child-reference lines (`extractChildReferenceBlocks`) stripped from BOTH sides before compare | Replace preserves child pages by design; they aren't divergence. |
| `targeted_search_replace` / `update_existing_page` | `{ kind: "contains", updates }` — for each content update, normalized readback must contain the normalized replacement text; if the search text is distinct from the replacement and still present, flag it in `detail` | We did not write the whole page, so full-compare would false-alarm on everyone else's content. Contains-check verifies what we actually claimed to do, nothing more. |

Deliberately NOT in scope: replicating Notion's `update_content` patch semantics locally to predict the exact post-patch page. A homemade patch engine that disagrees with Notion's would produce falsified verification — worse than the contains-check's admitted narrowness.

### 3. Outcome plumbing

- `PublishSummary` gains `verification?: WriteVerification` (present on live runs, absent on dry runs).
- Per-destination knob in `safeDefaults`: `verifyWrites: "warn" | "fail" | "off"`, default `"warn"`.
  - `warn`: log a warning + summary field. Behavior-compatible rollout default.
  - `fail`: `diverged` throws `AppError` after the summary is assembled (the page state is still reported — verification failure is information, not rollback). `unverifiable` never fails; it warns.
  - `off`: skip comparison, still record `{ status: "unverifiable", reason: "verification disabled" }`.
- Config schema for destinations gains the optional key; missing key = `"warn"` (no config migration needed).

### 4. Explicitly out of scope

- Retry/convergence ladder for the Publisher (that is managed-sync's rung machinery; grafting it here is a different, bigger proposal).
- Any change to dry-run behavior (stays read-only, gains nothing).
- New normalization rules in utils/markdown.ts. If verification exposes a normalizer gap, that is a finding to report, not to hotfix inside PR-3.

## Tests (Vitest, existing fake-api harness style from publisher tests)

1. Full-compare passes across known round-trip quirks (escaped links, reflowed whitespace) — i.e. normalizer equivalence, not byte equality, decides.
2. `replace_full_content` divergence (readback missing a section) → `diverged` with detail; `verifyWrites: "fail"` throws, `"warn"` returns summary with warning.
3. Child-reference lines present in readback but not in parsedBody → still `verified`.
4. Contains-check: replacement present → verified; replacement absent → diverged; search text still present alongside replacement → diverged with the both-present detail.
5. Template + `postTemplatePatchMode: "none"` → `unverifiable`, never `verified`.
6. Dry run → no `verification` field.
7. `verifyWrites: "off"` → recorded as disabled, no comparison performed.

## Verification gate for the implementer

`npm run typecheck` exit 0; new test file green via targeted vitest; full `npm test` with only the known pre-existing `package-surface` subprocess-timeout flake.

## Sequencing note

Independent of PR-1/PR-2 (different files). Branch from main. Suggested branch: `feat/publisher-write-verification`.
