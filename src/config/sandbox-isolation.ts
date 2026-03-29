import { access, readFile } from "node:fs/promises";

export interface SandboxRuntimePaths {
  destinationsPath: string;
  controlTowerConfigPath: string;
  localPortfolioViewsPath: string;
  executionViewsPath: string;
  intelligenceViewsPath: string;
  externalSignalSourcesPath: string;
  externalSignalProvidersPath: string;
  externalSignalViewsPath: string;
  governancePoliciesPath: string;
  webhookProvidersPath: string;
  governanceViewsPath: string;
  actuationTargetsPath: string;
  actuationViewsPath: string;
  githubActionFamiliesPath: string;
  githubViewsPath: string;
  nativeDashboardsPath: string;
  nativeAutomationsPath: string;
  nativePilotsPath: string;
}

export interface SandboxNotionRefOccurrence {
  ref: string;
  rawValue: string;
  filePath: string;
  fileLabel: string;
  jsonPath: string;
}

export interface SandboxNotionRefOverlap {
  ref: string;
  primary: SandboxNotionRefOccurrence[];
  sandbox: SandboxNotionRefOccurrence[];
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const NOTION_HEX_PATTERN = /\b[0-9a-f]{32}\b/gi;

const SANDBOX_JSON_PATH_KEYS: Array<keyof SandboxRuntimePaths> = [
  "destinationsPath",
  "controlTowerConfigPath",
  "localPortfolioViewsPath",
  "executionViewsPath",
  "intelligenceViewsPath",
  "externalSignalSourcesPath",
  "externalSignalProvidersPath",
  "externalSignalViewsPath",
  "governancePoliciesPath",
  "webhookProvidersPath",
  "governanceViewsPath",
  "actuationTargetsPath",
  "actuationViewsPath",
  "githubActionFamiliesPath",
  "githubViewsPath",
  "nativeDashboardsPath",
  "nativeAutomationsPath",
  "nativePilotsPath",
];

export async function collectSandboxNotionRefOccurrences(
  paths: SandboxRuntimePaths,
): Promise<SandboxNotionRefOccurrence[]> {
  const occurrences: SandboxNotionRefOccurrence[] = [];

  for (const key of SANDBOX_JSON_PATH_KEYS) {
    const filePath = paths[key];
    if (!(await pathExists(filePath))) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch {
      continue;
    }

    visitForNotionRefs(parsed, occurrences, {
      filePath,
      fileLabel: key,
      jsonPath: "$",
    });
  }

  return occurrences;
}

export function findSandboxNotionRefOverlaps(
  primary: SandboxNotionRefOccurrence[],
  sandbox: SandboxNotionRefOccurrence[],
): SandboxNotionRefOverlap[] {
  const primaryByRef = groupOccurrencesByRef(primary);
  const sandboxByRef = groupOccurrencesByRef(sandbox);
  const overlaps: SandboxNotionRefOverlap[] = [];

  for (const [ref, primaryOccurrences] of primaryByRef.entries()) {
    const sandboxOccurrences = sandboxByRef.get(ref);
    if (!sandboxOccurrences) {
      continue;
    }

    overlaps.push({
      ref,
      primary: primaryOccurrences,
      sandbox: sandboxOccurrences,
    });
  }

  return overlaps.sort((left, right) => left.ref.localeCompare(right.ref));
}

export function summarizeSandboxNotionRefOverlaps(
  overlaps: SandboxNotionRefOverlap[],
  limit = 3,
): string {
  if (overlaps.length === 0) {
    return "No overlapping Notion target references were found.";
  }

  const samples = overlaps.slice(0, limit).map((overlap) => {
    const primarySample = overlap.primary[0];
    const sandboxSample = overlap.sandbox[0];
    return `${sandboxSample?.fileLabel ?? "sandbox"} ${sandboxSample?.jsonPath ?? "$"} overlaps ${primarySample?.fileLabel ?? "primary"} ${primarySample?.jsonPath ?? "$"}`;
  });

  return `${overlaps.length} overlapping Notion reference(s). Sample: ${samples.join("; ")}`;
}

function visitForNotionRefs(
  value: unknown,
  occurrences: SandboxNotionRefOccurrence[],
  context: {
    filePath: string;
    fileLabel: string;
    jsonPath: string;
  },
): void {
  if (typeof value === "string") {
    const refs = extractNormalizedNotionRefs(value);
    for (const ref of refs) {
      occurrences.push({
        ref,
        rawValue: value,
        filePath: context.filePath,
        fileLabel: context.fileLabel,
        jsonPath: context.jsonPath,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      visitForNotionRefs(entry, occurrences, {
        ...context,
        jsonPath: `${context.jsonPath}[${index}]`,
      });
    });
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    visitForNotionRefs(entry, occurrences, {
      ...context,
      jsonPath: context.jsonPath === "$" ? `$.${key}` : `${context.jsonPath}.${key}`,
    });
  }
}

function extractNormalizedNotionRefs(value: string): string[] {
  const refs = new Set<string>();

  for (const match of value.matchAll(UUID_PATTERN)) {
    const raw = match[0]?.trim();
    if (raw) {
      refs.add(normalizeNotionRef(raw));
    }
  }

  if (value.includes("notion.so")) {
    for (const match of value.matchAll(NOTION_HEX_PATTERN)) {
      const raw = match[0]?.trim();
      if (raw) {
        refs.add(normalizeNotionRef(raw));
      }
    }
  }

  return [...refs];
}

function normalizeNotionRef(value: string): string {
  return value.toLowerCase().replace(/-/g, "");
}

function groupOccurrencesByRef(
  occurrences: SandboxNotionRefOccurrence[],
): Map<string, SandboxNotionRefOccurrence[]> {
  const grouped = new Map<string, SandboxNotionRefOccurrence[]>();
  for (const occurrence of occurrences) {
    const existing = grouped.get(occurrence.ref) ?? [];
    existing.push(occurrence);
    grouped.set(occurrence.ref, existing);
  }
  return grouped;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
