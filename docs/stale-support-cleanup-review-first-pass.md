# Stale Support Cleanup Review - First Pass

Date: 2026-03-29

## What this review is

This is a conservative review-first cleanup list for the support databases after the latest GitHub-backed coverage batches.

It is intentionally narrower than the full stale-support audit:

- It focuses on rows with zero linked local projects.
- It prefers old, clearly orphaned rows over ambiguous weakly linked rows.
- It does not recommend archiving the newly created research rows from recent coverage backfills, even though those currently count as "weak" because they link to only one project.

## Current audit snapshot

- `project-support-coverage-audit`: 43 remaining project candidates
- `stale-support-audit`: 217 total candidates
- `stale-support-audit` orphaned rows: 106
- `stale-support-audit` weak rows: 111

Interpretation:

- The project-support queue is shrinking in the right direction.
- The stale-support count rose because the recent coverage work created many new research rows that are intentionally single-project for now.
- The real cleanup target is still the older orphaned support rows, especially general skills and tools with no current portfolio linkage.

## First-pass archive review candidates

These are the cleanest low-risk candidates to review for archive first.

### Skills

1. `C#`
   Why it is low risk: zero linked projects and last freshness is 2024-03-16.

2. `C++`
   Why it is low risk: zero linked projects and last freshness is 2024-03-16.

3. `Ruby`
   Why it is low risk: zero linked projects and last freshness is 2024-03-16.

4. `B.S. Computer Science (SFSU)`
   Why it is low risk: reads more like background profile metadata than active project support.

5. `Java`
   Why it is low risk: zero linked projects and no recent portfolio evidence.

6. `Data Structures & Algorithms`
   Why it is low risk: valuable generally, but currently unused as a linked support row anywhere in the live project system.

7. `Express`
   Why it is low risk: zero linked projects and no current repo-backed project coverage using it.

8. `GCP`
   Why it is low risk: zero linked projects and no current operating project linkage.

9. `Google Cloud Digital Leader`
   Why it is low risk: credential/profile-style row with no linked projects.

10. `Salesforce`
    Why it is low risk: zero linked projects and no current portfolio support usage.

11. `Canvas2D / Web Workers`
    Why it is low risk: zero linked projects despite several active front-end projects now being linked elsewhere.

12. `Cloudflare`
    Why it is low risk: zero linked projects and no current support coverage dependency.

13. `Intune`
    Why it is low risk: zero linked projects and appears disconnected from the active repo-backed portfolio lane.

14. `SharePoint`
    Why it is low risk: zero linked projects and appears disconnected from the active repo-backed portfolio lane.

15. `Zendesk`
    Why it is low risk: zero linked projects and appears disconnected from the active repo-backed portfolio lane.

16. `Active Directory`
    Why it is low risk: zero linked projects and no current supporting relation usage.

### Tools

1. `Google AI Studio`
   Why it is low risk: zero linked projects and no current repo-backed evidence using it.

2. `Antigravity`
   Why it is low risk: zero linked projects and no current support linkage.

3. `Cursor`
   Why it is low risk: zero linked projects and no current support linkage.

4. `Gemini CLI`
   Why it is low risk: zero linked projects and no current support linkage.

5. `Manus`
   Why it is low risk: zero linked projects and no current support linkage.

6. `OpenCode`
   Why it is low risk: zero linked projects and no current support linkage.

7. `v0 by Vercel`
   Why it is low risk: zero linked projects and no current support linkage.

8. `Aider`
   Why it is low risk: zero linked projects and no current support linkage.

9. `Droid (Factory)`
   Why it is low risk: zero linked projects and no current support linkage.

## Keep-for-now items

These should not be part of the first archive pass:

- Newly created research rows from the recent GitHub coverage batches.
  Reason: they are intentionally project-specific and therefore currently only have one linked project.

- Weak-but-linked support rows that still back live active-build projects.
  Reason: they may need expansion rather than cleanup.

- Ambiguous general rows that could be reused soon in the next coverage batches.
  Reason: better to decide those after more project linking is complete.

## Recommended next action

Run the first archive pass only on the low-risk orphaned rows above, starting with:

1. `C#`
2. `C++`
3. `Ruby`
4. `Java`
5. `Google AI Studio`
6. `Cursor`
7. `Gemini CLI`
8. `Aider`

After that, rerun `stale-support-audit` and reassess the next orphan tranche before touching weakly linked rows.
