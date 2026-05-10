# Personal Ops Coordination Ingestion

Personal Ops owns generation of the Coordination Snapshot. Notion owns durable display and ledger workflows.

The first Notion-side path is dry-run only:

```bash
notion-os signals coordination-snapshot --input /path/to/personal-ops-coordination-export.json
notion-os signals coordination-snapshot --input /path/to/personal-ops-coordination-export.json --json
```

The command accepts the `personal_ops.coordination_notion_export.v1` payload emitted by:

```bash
personal-ops coordination export --for notion --json
```

It validates the schema, snapshot identity, dry-run handoff contract, unique dedupe keys, and evidence references before converting rows into an ingestion plan for External Signal Events. The plan reports `Planned writes: 0` and `Dry-run contract: verified`.

The first hardening pass intentionally fails early if a row does not match the source snapshot id, has a duplicate dedupe key, lacks evidence, or if the Personal Ops export no longer declares `write_mode: dry_run_only`.

Live writes should only be added after a separate Notion lane defines source rows, project mapping, dedupe behavior, and review/archival display rules.
