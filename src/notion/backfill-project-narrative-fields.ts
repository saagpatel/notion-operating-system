import "dotenv/config";

import { Client } from "@notionhq/client";

import { DestinationRegistry } from "../config/destination-registry.js";
import { buildProjectIntelligenceDataset } from "../portfolio-audit/project-intelligence.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { DirectNotionClient } from "./direct-notion-client.js";
import {
  fetchAllPages,
  richTextValue,
  textValue,
  type DataSourcePageRef,
} from "./local-portfolio-control-tower-live.js";
import {
  deriveValueOutcome,
  deriveWhatWorks,
  mergeNarrativeSources,
  normalizeProjectTitle,
  projectNarrativeSourceFromDataset,
  type LiveNarrativeRow,
  type ProjectNarrativeSource,
} from "./project-narrative-backfill.js";

interface PlannedUpdate {
  title: string;
  valueOutcome?: string;
  whatWorks?: string;
}

async function main(): Promise<void> {
  try {
    const live = process.argv.includes("--live");
    const token = process.env.NOTION_TOKEN?.trim();
    if (!token) {
      throw new AppError("NOTION_TOKEN is required for project narrative backfill");
    }

    const registry = await DestinationRegistry.load("./config/destinations.json");
    const api = new DirectNotionClient(token);
    const resolved = await api.resolveDestination(registry.getDestination("local_portfolio_projects"));
    if (resolved.destinationType !== "data_source") {
      throw new AppError("local_portfolio_projects must resolve to a data source");
    }

    const schema = await api.retrieveDataSource(resolved.dataSourceId);
    if (!schema.properties["Value / Outcome"] || !schema.properties["What Works"]) {
      throw new AppError("Local Portfolio Projects is missing Value / Outcome or What Works");
    }

    const { projects } = await buildProjectIntelligenceDataset();
    const datasetByTitle = buildDatasetMap(projects.map(projectNarrativeSourceFromDataset));

    const sdk = new Client({ auth: token, notionVersion: "2026-03-11" });
    const pages = await fetchAllPages(sdk, resolved.dataSourceId, schema.titlePropertyName);

    const updates: PlannedUpdate[] = [];
    for (const page of pages) {
      const currentValueOutcome = textValue(page.properties["Value / Outcome"]).trim();
      const currentWhatWorks = textValue(page.properties["What Works"]).trim();
      const mergedSource = mergeNarrativeSources([
        liveNarrativeRowFromPage(page),
        ...(datasetByTitle.get(normalizeProjectTitle(page.title)) ?? []),
      ].filter(Boolean) as ProjectNarrativeSource[]);

      if (!mergedSource) {
        continue;
      }

      const valueOutcome = currentValueOutcome ? "" : deriveValueOutcome(mergedSource);
      const whatWorks = currentWhatWorks ? "" : deriveWhatWorks(mergedSource);
      if (!valueOutcome && !whatWorks) {
        continue;
      }

      updates.push({
        title: page.title,
        valueOutcome: valueOutcome || undefined,
        whatWorks: whatWorks || undefined,
      });

      if (live) {
        const properties: Record<string, unknown> = {};
        if (valueOutcome) {
          properties["Value / Outcome"] = richTextValue(valueOutcome);
        }
        if (whatWorks) {
          properties["What Works"] = richTextValue(whatWorks);
        }
        await api.updatePageProperties({
          pageId: page.id,
          properties,
        });
      }
    }

    const remainingBlankValue = pages.length - pages.filter((page) => {
      const current = textValue(page.properties["Value / Outcome"]).trim();
      const planned = updates.find((update) => update.title === page.title)?.valueOutcome ?? "";
      return Boolean(current || planned);
    }).length;
    const remainingBlankWhatWorks = pages.length - pages.filter((page) => {
      const current = textValue(page.properties["What Works"]).trim();
      const planned = updates.find((update) => update.title === page.title)?.whatWorks ?? "";
      return Boolean(current || planned);
    }).length;

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: live ? "live" : "dry-run",
          scannedProjects: pages.length,
          updatesPlanned: updates.length,
          valueOutcomeUpdates: updates.filter((update) => Boolean(update.valueOutcome)).length,
          whatWorksUpdates: updates.filter((update) => Boolean(update.whatWorks)).length,
          remainingBlankValue,
          remainingBlankWhatWorks,
          sample: updates.slice(0, 15),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exit(1);
  }
}

function buildDatasetMap(projects: ProjectNarrativeSource[]): Map<string, ProjectNarrativeSource[]> {
  const byTitle = new Map<string, ProjectNarrativeSource[]>();
  for (const project of projects) {
    const key = normalizeProjectTitle(project.title);
    const existing = byTitle.get(key) ?? [];
    existing.push(project);
    byTitle.set(key, existing);
  }
  return byTitle;
}

function liveNarrativeRowFromPage(page: DataSourcePageRef): LiveNarrativeRow {
  return {
    title: page.title,
    category: page.properties.Category?.select?.name?.trim() ?? "",
    summary: textValue(page.properties.Summary),
    primaryRunCommand: textValue(page.properties["Primary Run Command"]),
    primaryContextDoc: textValue(page.properties["Primary Context Doc"]),
    docsQuality: page.properties["Docs Quality"]?.select?.name?.trim() ?? "",
    testPosture: page.properties["Test Posture"]?.select?.name?.trim() ?? "",
    buildMaturity: page.properties["Build Maturity"]?.select?.name?.trim() ?? "",
    shipReadiness: page.properties["Ship Readiness"]?.select?.name?.trim() ?? "",
    readiness: textValue(page.properties.Readiness),
    projectHealthNotes: textValue(page.properties["Project Health Notes"]),
    valueOutcome: textValue(page.properties["Value / Outcome"]),
    whatWorks: textValue(page.properties["What Works"]),
  };
}

void main();
