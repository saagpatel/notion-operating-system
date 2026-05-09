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

It validates the schema, converts rows into an ingestion plan for External Signal Events, and reports `Planned writes: 0`. Live writes should only be added after a separate Notion lane defines source rows, project mapping, dedupe behavior, and review/archival display rules.
