# GitHub Governed Actions Runbook

Updated: 2026-04-14

## Purpose

Use this runbook for the governed GitHub lane in Notion.

Current proven GitHub actions:

- `github.create_issue`
- `github.update_issue`
- `github.set_issue_labels`
- `github.set_issue_assignees`
- `github.add_issue_comment`
- `github.comment_pull_request`

## Core Rule

Always use the governed request flow:

1. create or update the action request
2. run dry run
3. confirm the request is `Ready for Live`
4. run one live execution
5. verify the GitHub result directly

Do not bypass the request flow with direct GitHub writes when the governed lane is available.

## When To Use Each Action

### `github.create_issue`

Use when:

- the work should become a new tracked GitHub issue
- the target repository is already allowlisted
- the recommendation or manual request is specific enough to become a concrete issue

Do not use when:

- the work belongs on an existing issue
- the target repository is not already in the governed actuation targets

### `github.update_issue`

Use when:

- an existing issue needs title or body changes
- dry run clearly shows the exact issue number and intended delta

Do not use when:

- the request is still ambiguous about which issue should change

### `github.set_issue_labels`

Use when:

- the issue exists already
- the label set is the main thing changing

Do not use when:

- the request is really about rewriting the issue body or comments

### `github.set_issue_assignees`

Use when:

- ownership needs to change
- the assignee delta is explicit in dry run

Do not use when:

- the target issue is still unclear

### `github.add_issue_comment`

Use when:

- the issue exists already
- the response belongs in the issue conversation instead of the issue body

### `github.comment_pull_request`

Use when:

- the request is about a specific pull request
- the comment belongs on the PR review thread or conversation

Do not use when:

- the work should create or update an issue instead

## Pre-Flight Checklist

Before any live GitHub action:

- the request status is `Approved`
- the request intent is `Ready for Live`
- the source type is one of the policy-allowed sources
- the target repository is allowlisted
- `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PEM` are available in the runtime
- `GITHUB_APP_WEBHOOK_SECRET` is present if you expect feedback and reconciliation signals

## Post-Action Verification

After any live GitHub action:

- open the resulting issue or pull request directly
- confirm the target repo and target number match the request
- confirm the exact body, labels, assignees, or comment landed as expected
- confirm the execution record shows `Succeeded` and `Confirmed`

Do not trust request status alone without reading the GitHub result.

## Stop Conditions

Stop immediately if:

- dry run cannot resolve the target repo or target number
- the request is still only `Dry Run`
- the target repo is not allowlisted
- GitHub credentials are missing
- GitHub accepts the write but the resulting issue or comment does not match the request

## First Commands To Reach For

Use these in order when the lane feels uncertain:

1. `npm run governance:health-report`
2. `npm run governance:audit`
3. `npm run governance:actuation-audit`
4. `npx tsx src/cli.ts governance action-dry-run --request <page-id>`
5. `npx tsx src/cli.ts governance action-runner --mode live --request <page-id>`

## Current Recommendation

Keep the GitHub lane boring and explicit.

If an operator is unsure which GitHub action fits, stop at dry run and tighten the request before going live.
