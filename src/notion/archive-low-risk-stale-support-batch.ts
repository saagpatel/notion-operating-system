import "dotenv/config";

import { Client } from "@notionhq/client";

import { recordCommandOutputSummary } from "../cli/command-summary.js";
import { resolveRequiredNotionToken } from "../cli/context.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { losAngelesToday } from "../utils/date.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH,
  loadLocalPortfolioControlTowerConfig,
} from "./local-portfolio-control-tower.js";
import {
  dateValue,
  fetchAllPages,
  relationIds,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";

const TODAY = losAngelesToday();

type SupportKind = "research" | "skill" | "tool";

interface Flags {
  live: boolean;
  today: string;
  config: string;
  batch: string;
}

interface TargetRow {
  kind: SupportKind;
  title: string;
  id: string;
}

interface PlannedRow {
  kind: SupportKind;
  title: string;
  id: string;
  url: string;
  freshnessDate: string;
  linkedProjectCount: number;
  linkedProjectTitles: string[];
  eligible: boolean;
  skipReason: string;
}

const FIRST_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "C#", id: "326c21f1-caf0-81b4-bef8-df6961d1ee90" },
  { kind: "skill", title: "C++", id: "326c21f1-caf0-81f4-b171-f31012e50551" },
  { kind: "skill", title: "Ruby", id: "326c21f1-caf0-8156-bdb5-e8158d7b7937" },
  { kind: "skill", title: "Java", id: "326c21f1-caf0-81e3-8b80-eda2953347a7" },
  { kind: "tool", title: "Google AI Studio", id: "326c21f1-caf0-8174-9683-cc51fb0b5424" },
  { kind: "tool", title: "Cursor", id: "326c21f1-caf0-8177-84b6-eca0874da4c2" },
  { kind: "tool", title: "Gemini CLI", id: "326c21f1-caf0-81ca-b741-f8f6d421a800" },
  { kind: "tool", title: "Aider", id: "326c21f1-caf0-818c-a79e-f7f8f07a98cc" },
];

const SECOND_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "B.S. Computer Science (SFSU)", id: "326c21f1-caf0-818f-94a3-ec354723bf66" },
  { kind: "skill", title: "Data Structures & Algorithms", id: "326c21f1-caf0-81b7-96c3-f2cd93b2501e" },
  { kind: "skill", title: "Express", id: "326c21f1-caf0-81dc-b831-eae4dd8b35f7" },
  { kind: "skill", title: "GCP", id: "326c21f1-caf0-813f-b927-f80e292fb4bc" },
  { kind: "skill", title: "Google Cloud Digital Leader", id: "326c21f1-caf0-81e3-bb7c-fb5e9f85f81a" },
  { kind: "skill", title: "Salesforce", id: "326c21f1-caf0-81e5-8bc6-fe38b6b0183d" },
  { kind: "tool", title: "Antigravity", id: "326c21f1-caf0-8115-b1fd-e88cece46f75" },
  { kind: "tool", title: "Manus", id: "326c21f1-caf0-8176-abdb-f353f2ee8d7d" },
];

const THIRD_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "tool", title: "OpenCode", id: "326c21f1-caf0-819a-8c8c-d2102e52d72a" },
  { kind: "tool", title: "v0 by Vercel", id: "326c21f1-caf0-81a3-8156-dbed2c45c7a9" },
  { kind: "tool", title: "Droid (Factory)", id: "326c21f1-caf0-81e9-b2e9-de459f5686cc" },
  { kind: "skill", title: "Canvas2D / Web Workers", id: "326c21f1-caf0-81fc-96c7-edd1b05d5620" },
  { kind: "skill", title: "Cloudflare", id: "326c21f1-caf0-8188-a5e2-da62612be71d" },
  { kind: "skill", title: "Intune", id: "326c21f1-caf0-81c4-8d1a-c650df6ad9fb" },
  { kind: "skill", title: "SharePoint", id: "326c21f1-caf0-81e3-a6f8-df144f586a9d" },
  { kind: "skill", title: "Zendesk", id: "326c21f1-caf0-816e-b7e8-ec558a1a6ec5" },
];

const FOURTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "Active Directory", id: "326c21f1-caf0-8118-9431-fc42d974bac9" },
  { kind: "skill", title: "Adobe Admin", id: "326c21f1-caf0-819c-84f4-d19e206bccc7" },
  { kind: "skill", title: "Firewall / ACLs", id: "326c21f1-caf0-81d0-84b2-cbadfad77916" },
  { kind: "skill", title: "Jamf", id: "326c21f1-caf0-81e3-abdb-c68fa9419b1e" },
  { kind: "skill", title: "OOP / Design Patterns", id: "326c21f1-caf0-81cc-ac63-f1956f40b4e7" },
  { kind: "skill", title: "DHCP", id: "326c21f1-caf0-8158-bd5a-f5152d9034f2" },
  { kind: "skill", title: "IT Procurement", id: "326c21f1-caf0-8173-a7c5-ec98779410df" },
  { kind: "skill", title: "SSL/TLS Certificates", id: "326c21f1-caf0-81ae-a3d6-d777215b017f" },
];

const FIFTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "User Training", id: "326c21f1-caf0-8181-81e8-f0356e8f83c6" },
  { kind: "skill", title: "Vendor Management", id: "326c21f1-caf0-81ad-8377-cb612329d0d7" },
  { kind: "skill", title: "Apple Business Manager", id: "326c21f1-caf0-8180-8fb3-f8e1442fe41a" },
  { kind: "skill", title: "Box", id: "326c21f1-caf0-81d0-bb94-e943a8a558ea" },
  { kind: "skill", title: "Change Management", id: "326c21f1-caf0-81b9-b8e9-ed9b0c16a4fb" },
  { kind: "skill", title: "Cursor", id: "326c21f1-caf0-81f1-a4a9-f82ffda7914c" },
  { kind: "skill", title: "Duo (MFA)", id: "326c21f1-caf0-8176-91b4-f32c16ae0d04" },
  { kind: "skill", title: "Electron", id: "326c21f1-caf0-8146-bb22-d7c2aa33241f" },
];

const SIXTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "Linux", id: "326c21f1-caf0-8192-a9ef-d93d81523aa9" },
  { kind: "skill", title: "Microsoft 365", id: "326c21f1-caf0-81f3-ad6b-d60d7cf991c6" },
  { kind: "skill", title: "pyenv", id: "326c21f1-caf0-8140-bf18-f0c7515ce362" },
  { kind: "skill", title: "VPN", id: "326c21f1-caf0-81c9-a2ba-fa9fc1ec0bcc" },
  { kind: "skill", title: "Wi-Fi / WLAN", id: "326c21f1-caf0-8110-b774-e12d46e2d103" },
  { kind: "skill", title: "Zoom", id: "326c21f1-caf0-8129-a646-dc83956aa258" },
  { kind: "skill", title: "Agentic Workflows", id: "326c21f1-caf0-8157-ae97-ea692b575988" },
  { kind: "skill", title: "macOS Keychain", id: "326c21f1-caf0-813b-9872-e64369be7187" },
];

const SEVENTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "nvm", id: "326c21f1-caf0-8114-974c-db46185df8aa" },
  { kind: "skill", title: "Asset Lifecycle Management", id: "326c21f1-caf0-815f-a07a-e5862d1706a9" },
  { kind: "skill", title: "Bash", id: "326c21f1-caf0-8169-9f4a-cda355d21314" },
  { kind: "skill", title: "CISO Award of Excellence", id: "326c21f1-caf0-818b-a340-ff0e4935c63b" },
  { kind: "skill", title: "Cowork", id: "326c21f1-caf0-81b3-b190-f9e19b510c8a" },
  { kind: "skill", title: "CrowdStrike", id: "326c21f1-caf0-8152-bece-cadbe166e949" },
  { kind: "skill", title: "Executive/VIP Support", id: "326c21f1-caf0-8177-94d2-ec722b09a5ea" },
  { kind: "skill", title: "Google Workspace", id: "326c21f1-caf0-81f5-bc49-d542a710da62" },
];

const EIGHTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "Homebrew", id: "326c21f1-caf0-81c4-8735-e8842e0637b8" },
  { kind: "skill", title: "HTML/CSS", id: "326c21f1-caf0-81a4-bc07-d9990ee5cfac" },
  { kind: "skill", title: "Incident Management", id: "326c21f1-caf0-81b8-85f9-c26958a41357" },
  { kind: "skill", title: "ITIL Foundation", id: "326c21f1-caf0-8103-9217-f2448db2bf7e" },
  { kind: "skill", title: "JavaScript", id: "326c21f1-caf0-81ed-b639-e684af8aebf1" },
  { kind: "skill", title: "JQL", id: "326c21f1-caf0-8123-a4da-d7333f42e04a" },
  { kind: "skill", title: "Kandji MDM", id: "326c21f1-caf0-817c-b74a-d74ae80f2ec7" },
  { kind: "skill", title: "NotebookLM", id: "326c21f1-caf0-810e-91b7-e6559aaf89ef" },
];

const NINTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "Onboarding/Offboarding", id: "326c21f1-caf0-8135-9e53-feb3e7214ce0" },
  { kind: "skill", title: "PowerShell", id: "326c21f1-caf0-812b-8f0f-dd13d2c8592b" },
  { kind: "skill", title: "SLA & CSAT Management", id: "326c21f1-caf0-81f9-8b84-c2ede1765ada" },
  { kind: "skill", title: "Slack Admin", id: "326c21f1-caf0-8105-b52e-f3f047ef0b76" },
  { kind: "skill", title: "Stakeholder Communication", id: "326c21f1-caf0-8193-8b5a-fb7412fd0097" },
  { kind: "skill", title: "Tailwind CSS", id: "326c21f1-caf0-810e-9a8e-e603b6704daf" },
  { kind: "skill", title: "TCP/IP & DNS", id: "326c21f1-caf0-8148-9c10-f2bd11cf15ca" },
  { kind: "skill", title: "Ticket Triage & Prioritization", id: "326c21f1-caf0-81ec-a183-caf3f0a93961" },
];

const TENTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "skill", title: "Warp", id: "326c21f1-caf0-815a-bdec-d9f557f8e691" },
  { kind: "tool", title: "Box", id: "326c21f1-caf0-819c-a53b-e83bbcb07c5d" },
  { kind: "tool", title: "Gemini", id: "326c21f1-caf0-81e3-9964-e22eaa7a0d8c" },
  { kind: "tool", title: "Google Workspace", id: "326c21f1-caf0-81a7-b793-e1847d1311d9" },
  { kind: "tool", title: "Grok", id: "326c21f1-caf0-8186-91b1-ccdcfeaf026b" },
  { kind: "tool", title: "Hugging Face", id: "326c21f1-caf0-8183-a4d8-d5f36b5d350c" },
  { kind: "tool", title: "LM Studio", id: "326c21f1-caf0-81a4-8803-dda53a0c3994" },
  { kind: "tool", title: "Beehiiv", id: "326c21f1-caf0-81eb-85f8-dcb1b137a66a" },
];

const ELEVENTH_BATCH_SHORTLIST: TargetRow[] = [
  {
    kind: "research",
    title: "Career Transition: Compensation Benchmarks & Negotiation Strategy",
    id: "32bc21f1-caf0-8143-9a73-cb977455d6e0",
  },
  {
    kind: "research",
    title: "Career Transition: LinkedIn & Passive Candidate Brand Playbook",
    id: "32bc21f1-caf0-814c-802b-eedde8a2140f",
  },
  {
    kind: "research",
    title: "Career Transition: Skills Gap Analysis & 90-Day Learning Plan",
    id: "32bc21f1-caf0-816a-ab7d-e66383ef25d6",
  },
  {
    kind: "research",
    title: "Career Transition: Target Role Analysis (SRE vs Platform Engineer vs AIOps)",
    id: "32bc21f1-caf0-81b4-ae3e-db0e62661108",
  },
  { kind: "tool", title: "Calendly", id: "326c21f1-caf0-8119-9064-ee4ba07d0799" },
  { kind: "tool", title: "ChatGPT", id: "326c21f1-caf0-81a2-a676-e2c27e658820" },
  { kind: "tool", title: "CrowdStrike Falcon", id: "326c21f1-caf0-8185-989a-c7a0de7ded50" },
  { kind: "tool", title: "Docker Desktop", id: "326c21f1-caf0-816b-baa5-f628924e4cec" },
];

const TWELFTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "tool", title: "Homebrew", id: "326c21f1-caf0-81f7-8262-e041649fa754" },
  { kind: "tool", title: "Kandji", id: "326c21f1-caf0-813f-960d-cd9107c5f615" },
  { kind: "tool", title: "Make (Integromat)", id: "326c21f1-caf0-812a-be1a-f35990449f6d" },
  { kind: "tool", title: "nvm", id: "326c21f1-caf0-81cf-b743-e1c8b53b7786" },
  { kind: "tool", title: "Okta", id: "326c21f1-caf0-81eb-a5cb-ef3c0fddf574" },
  { kind: "tool", title: "Perplexity", id: "326c21f1-caf0-81c7-98a3-d03a3a74fa75" },
  { kind: "tool", title: "pyenv", id: "326c21f1-caf0-8146-a66c-f2d2b6651e1b" },
  { kind: "tool", title: "Raycast", id: "326c21f1-caf0-816c-b40e-c90a9d041427" },
];

const THIRTEENTH_BATCH_SHORTLIST: TargetRow[] = [
  { kind: "tool", title: "Rectangle", id: "326c21f1-caf0-81cb-b6d6-f2ee367b60f7" },
  { kind: "tool", title: "Stripe", id: "326c21f1-caf0-81e1-a0e7-f03bd051a275" },
  { kind: "tool", title: "Typeform", id: "326c21f1-caf0-8176-a111-d84c6c7e36c7" },
  { kind: "tool", title: "VS Code", id: "326c21f1-caf0-81fa-8dc3-f545a028058a" },
  { kind: "tool", title: "Warp", id: "326c21f1-caf0-810f-9dfb-cc7d4b954000" },
  { kind: "tool", title: "Zapier", id: "326c21f1-caf0-8147-951e-cd5f318a13a4" },
  { kind: "tool", title: "Zoom", id: "326c21f1-caf0-818f-89e8-d78e068dd2b6" },
];

const FOURTEENTH_BATCH_SHORTLIST: TargetRow[] = [
  {
    kind: "research",
    title: "Multi-Platform Deep Research: Process Evaluation & Tool Comparison",
    id: "32bc21f1-caf0-8156-91b1-edf1b3483a21",
  },
  {
    kind: "research",
    title: "Direct-Manipulation Bayesian Teaching on the Web",
    id: "32dc21f1-caf0-81ed-a627-f2ba2e955eb6",
  },
  {
    kind: "skill",
    title: "Interactive Bayesian Visualization with D3 + Next.js",
    id: "32dc21f1-caf0-81aa-ac20-c35c56f4de7c",
  },
];

const BATCH_SHORTLISTS: Record<string, TargetRow[]> = {
  first: FIRST_BATCH_SHORTLIST,
  second: SECOND_BATCH_SHORTLIST,
  third: THIRD_BATCH_SHORTLIST,
  fourth: FOURTH_BATCH_SHORTLIST,
  fifth: FIFTH_BATCH_SHORTLIST,
  sixth: SIXTH_BATCH_SHORTLIST,
  seventh: SEVENTH_BATCH_SHORTLIST,
  eighth: EIGHTH_BATCH_SHORTLIST,
  ninth: NINTH_BATCH_SHORTLIST,
  tenth: TENTH_BATCH_SHORTLIST,
  eleventh: ELEVENTH_BATCH_SHORTLIST,
  twelfth: TWELFTH_BATCH_SHORTLIST,
  thirteenth: THIRTEENTH_BATCH_SHORTLIST,
  fourteenth: FOURTEENTH_BATCH_SHORTLIST,
};

function parseFlags(argv: string[]): Flags {
  let live = false;
  let today = TODAY;
  let config = DEFAULT_LOCAL_PORTFOLIO_CONTROL_TOWER_PATH;
  let batch = "first";

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--live") {
      live = true;
      continue;
    }
    if (current === "--today") {
      today = argv[index + 1] ?? today;
      index += 1;
      continue;
    }
    if (current === "--config") {
      config = argv[index + 1] ?? config;
      index += 1;
      continue;
    }
    if (current === "--batch") {
      batch = argv[index + 1] ?? batch;
      index += 1;
    }
  }

  return { live, today, config, batch };
}

async function main(): Promise<void> {
  try {
    const output = await runArchiveLowRiskStaleSupportBatch(parseFlags(process.argv.slice(2)));
    recordCommandOutputSummary(output);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

export async function runArchiveLowRiskStaleSupportBatch(flags: Flags): Promise<Record<string, unknown>> {
  const shortlist = BATCH_SHORTLISTS[flags.batch];
  if (!shortlist) {
    throw new AppError(
      `Unknown low-risk stale support batch "${flags.batch}". Expected one of: ${Object.keys(BATCH_SHORTLISTS).join(", ")}`,
    );
  }
  const token = resolveRequiredNotionToken(
    "NOTION_TOKEN is required for the low-risk stale support archive batch",
  );
  const config = await loadLocalPortfolioControlTowerConfig(flags.config);
  const sdk = new Client({
    auth: token,
    notionVersion: "2026-03-11",
  });
  const api = new DirectNotionClient(token);

  const [projectSchema, researchSchema, skillSchema, toolSchema] = await Promise.all([
    api.retrieveDataSource(config.database.dataSourceId),
    api.retrieveDataSource(config.relatedDataSources.researchId),
    api.retrieveDataSource(config.relatedDataSources.skillsId),
    api.retrieveDataSource(config.relatedDataSources.toolsId),
  ]);

  const [projectPages, researchPages, skillPages, toolPages] = await Promise.all([
    fetchAllPages(sdk, config.database.dataSourceId, projectSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.researchId, researchSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.skillsId, skillSchema.titlePropertyName),
    fetchAllPages(sdk, config.relatedDataSources.toolsId, toolSchema.titlePropertyName),
  ]);

  const pagesByKind: Record<SupportKind, DataSourcePageRef[]> = {
    research: researchPages,
    skill: skillPages,
    tool: toolPages,
  };
  const projectById = new Map(projectPages.map((page) => [page.id, page]));

  const plannedRows = shortlist.map((target) => {
    const page = findTargetPage(pagesByKind[target.kind], target);
    if (!page) {
      return {
        kind: target.kind,
        title: target.title,
        id: target.id,
        url: "",
        freshnessDate: "",
        linkedProjectCount: 0,
        linkedProjectTitles: [],
        eligible: false,
        skipReason: "Already archived or no longer present in the live data source",
      } satisfies PlannedRow;
    }
    assertTargetTitle(page, target);
    const linkedProjectIds = relationIds(page.properties[projectRelationProperty(target.kind)]);
    const linkedProjectTitles = linkedProjectIds.map((projectId) => projectById.get(projectId)?.title ?? projectId);
    return {
      kind: target.kind,
      title: target.title,
      id: target.id,
      url: page.url,
      freshnessDate: supportFreshnessDate(target.kind, page),
      linkedProjectCount: linkedProjectIds.length,
      linkedProjectTitles,
      eligible: linkedProjectIds.length === 0,
      skipReason:
        linkedProjectIds.length === 0
          ? ""
          : `Still linked to ${linkedProjectIds.length} local project${linkedProjectIds.length === 1 ? "" : "s"}`,
    } satisfies PlannedRow;
  });

  const eligibleRows = plannedRows.filter((row) => row.eligible);
  const skippedRows = plannedRows.filter((row) => !row.eligible);

  if (flags.live) {
    for (const row of eligibleRows) {
      await sdk.pages.update({
        page_id: row.id,
        in_trash: true,
      });
    }
  }

  return {
    ok: true,
    live: flags.live,
    today: flags.today,
    batch: flags.batch,
    targetCount: shortlist.length,
    eligibleCount: eligibleRows.length,
    skippedCount: skippedRows.length,
    archivedRows: eligibleRows.map((row) => ({
      kind: row.kind,
      title: row.title,
      id: row.id,
      freshnessDate: row.freshnessDate,
    })),
    skippedRows: skippedRows.map((row) => ({
      kind: row.kind,
      title: row.title,
      id: row.id,
      linkedProjectCount: row.linkedProjectCount,
      linkedProjectTitles: row.linkedProjectTitles,
      skipReason: row.skipReason,
    })),
  };
}

function findTargetPage(pages: DataSourcePageRef[], target: TargetRow): DataSourcePageRef | null {
  const page = pages.find((candidate) => candidate.id === target.id);
  return page ?? null;
}

function assertTargetTitle(page: DataSourcePageRef, target: TargetRow): void {
  if (page.title !== target.title) {
    throw new AppError(
      `Expected ${target.kind} row ${target.id} to be titled "${target.title}" but found "${page.title}"`,
    );
  }
}

function projectRelationProperty(kind: SupportKind): string {
  switch (kind) {
    case "research":
      return "Related Local Projects";
    case "skill":
      return "Related Local Projects";
    case "tool":
      return "Linked Local Projects";
  }
}

function supportFreshnessDate(kind: SupportKind, page: DataSourcePageRef): string {
  if (kind === "research") {
    return (
      dateValue(page.properties["Last Verified"]) ||
      dateValue(page.properties["Date Researched"]) ||
      page.createdTime?.slice(0, 10) ||
      ""
    );
  }
  if (kind === "skill") {
    return dateValue(page.properties["Last Practiced"]) || page.createdTime?.slice(0, 10) || "";
  }
  return (
    dateValue(page.properties["Last Reviewed"]) ||
    dateValue(page.properties["Date First Used"]) ||
    page.createdTime?.slice(0, 10) ||
    ""
  );
}

if (process.argv[1]?.endsWith("archive-low-risk-stale-support-batch.ts")) {
  void main();
}
