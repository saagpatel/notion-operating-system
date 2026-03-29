# Audit Prompt Templates

These templates are for future audit and remediation planning chats that work against the same Notion operating system in this repo.

## Database role rule

Always apply this database split during audits:

- `Local Portfolio Projects` is for projects that are completed or currently in some kind of build, review, resume, or active-working status.
- `Project Portfolio` is for projects that have not been started yet.
- Audits should explicitly check for rows that are in the wrong database, duplicated across both databases without a valid reason, or partially represented in one while being actively operated from the other.

## Full Portfolio Audit And Remediation Prompt

```text
Plan mode. Same workspace as the other chats: /Users/d/Notion.

All project batches have now been completed. This chat is for a full end-to-end audit of the entire in-scope portfolio, followed by an implementation plan for fixing anything that is still wrong.

Scope:
- Audit all in-scope projects that were part of the batch work.
- Exclude the intentionally out-of-scope projects we are not touching.
- Treat this as a completion-and-remediation planning chat.

Primary goal:
- Find anything that still needs to be fixed.
- Then produce a concrete implementation plan to fix it.

Important Notion database rule:
- `Local Portfolio Projects` is for projects that are completed or currently in some kind of build, review, resume, or active-working status.
- `Project Portfolio` is for projects that have not been started yet.
- Explicitly audit for wrong-database placement, duplicate rows across both systems, stale placeholder rows, and projects whose operating state is split across the two databases.

What “done” means:
- Each in-scope project is present and correctly represented in the Notion operating system.
- Each in-scope project is in the correct Notion project database based on its real status.
- Git/GitHub setup is correct for each in-scope project.
- Projects that should be connected to the GitHub operating flow are connected correctly.
- Control-tower and support-link state is clean, with no unexpected orphaned projects, broken mappings, stale placeholders, or partial records.
- Checks/readiness state is clearly understood, including anything still needed to call a project fully set.
- Any remaining gaps, drift, duplication, or inconsistencies are identified and turned into actionable repair work.

Please inspect the current state across:
- the Notion repo at /Users/d/Notion
- the local project folders under /Users/d/Projects
- the current Notion control-tower/project state
- Git/GitHub wiring and remotes where relevant

Return a planning packet with these sections:
1. Executive summary
2. Overall portfolio status
3. Verified complete areas
4. Findings: everything that still needs to be fixed
5. Project-by-project exceptions only
6. Cross-project systemic issues, if any
7. Implementation plan to fix everything remaining
8. Recommended execution order
9. Dependencies and blockers
10. Final done definition for closing this entire effort

Important:
- Be strict and evidence-based.
- Do not assume earlier batch work was correct; verify it.
- Call out anything that looks complete on the surface but is still missing underlying setup.
- The implementation plan should be practical and sequenced, not vague.
- Do not do live writes yet. This chat is for planning and audit only.
```

## Batch Audit Prompt Add-On

Use this add-on in any smaller audit/remediation prompt:

```text
Important Notion database rule:
- `Local Portfolio Projects` is for projects that are completed or currently in some kind of build, review, resume, or active-working status.
- `Project Portfolio` is for projects that have not been started yet.
- Explicitly check whether any project in this batch is in the wrong database, duplicated across both databases without a good reason, or missing from the database that should actually own it.
```
