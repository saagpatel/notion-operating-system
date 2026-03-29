import type { ProjectIntelligenceRow } from "../portfolio-audit/project-intelligence.js";

export interface ProjectNarrativeSource {
  title: string;
  category: string;
  summary: string;
  primaryRunCommand: string;
  primaryContextDoc: string;
  docsQuality: string;
  testPosture: string;
  buildMaturity: string;
  shipReadiness: string;
  readiness: string;
  projectHealthNotes: string;
  valueOutcome: string;
  whatWorks: string;
}

export interface LiveNarrativeRow extends ProjectNarrativeSource {}

export function normalizeProjectTitle(title: string): string {
  return title.trim().toLowerCase();
}

export function projectNarrativeSourceFromDataset(project: ProjectIntelligenceRow): ProjectNarrativeSource {
  return {
    title: project.projectName,
    category: project.canonicalCategory,
    summary: project.oneLinePitch,
    primaryRunCommand: project.primaryRunCommand,
    primaryContextDoc: project.primaryContextDoc,
    docsQuality: project.docsQuality,
    testPosture: project.testPosture,
    buildMaturity: project.buildMaturity,
    shipReadiness: project.shipReadiness,
    readiness: project.readiness,
    projectHealthNotes: project.projectHealthNotes,
    valueOutcome: project.valueOutcome,
    whatWorks: project.whatWorks,
  };
}

export function mergeNarrativeSources(sources: ProjectNarrativeSource[]): ProjectNarrativeSource | null {
  if (sources.length === 0) {
    return null;
  }

  const ranked = [...sources].sort((left, right) => scoreSource(right) - scoreSource(left));
  const base = ranked[0]!;

  return {
    title: pickPreferredValue(ranked.map((source) => source.title)) || base.title,
    category: pickPreferredValue(ranked.map((source) => source.category)),
    summary: pickPreferredValue(ranked.map((source) => source.summary)),
    primaryRunCommand: pickPreferredValue(ranked.map((source) => source.primaryRunCommand)),
    primaryContextDoc: pickPreferredValue(ranked.map((source) => source.primaryContextDoc)),
    docsQuality: pickPreferredValue(ranked.map((source) => source.docsQuality)),
    testPosture: pickPreferredValue(ranked.map((source) => source.testPosture)),
    buildMaturity: pickPreferredValue(ranked.map((source) => source.buildMaturity)),
    shipReadiness: pickPreferredValue(ranked.map((source) => source.shipReadiness)),
    readiness: pickPreferredValue(ranked.map((source) => source.readiness)),
    projectHealthNotes: pickPreferredValue(ranked.map((source) => source.projectHealthNotes)),
    valueOutcome: pickPreferredValue(ranked.map((source) => source.valueOutcome)),
    whatWorks: pickPreferredValue(ranked.map((source) => source.whatWorks)),
  };
}

export function deriveValueOutcome(source: ProjectNarrativeSource): string {
  const explicit = source.valueOutcome.trim();
  if (explicit) {
    return explicit;
  }

  const summary = source.summary.trim();
  const text = `${source.category} ${summary}`.toLowerCase();
  if (/document vault|job search|career/.test(text)) {
    return "Supports a more organized and reusable job-search operating system.";
  }
  if (/incident|ticket|kb|support/.test(text)) {
    return "Shortens repetitive operational work and improves response quality.";
  }
  if (/commercial|saas|portal|compliance/.test(text)) {
    return "Can become recurring revenue or portfolio-proof commercial work.";
  }
  if (/game|creative|studio/.test(text)) {
    return "Strong showcase value and a credible portfolio story when polished.";
  }
  if (/dev tool|translator|rag|reasoning|knowledge|foundation|library|workflow/.test(text)) {
    return "Reusable technical leverage across multiple future projects.";
  }
  if (summary) {
    return `Turns the current ${summarizeSurface(summary)} into a stronger portfolio asset once polished.`;
  }
  return "";
}

export function deriveWhatWorks(source: ProjectNarrativeSource): string {
  const explicit = source.whatWorks.trim();
  if (explicit) {
    return ensureSentence(explicit);
  }

  const evidenceClause = firstNonEmpty(
    extractWorkingEvidence(source.readiness),
    extractWorkingEvidence(source.projectHealthNotes),
  );
  if (evidenceClause) {
    const cleanedEvidence = cleanEvidenceClause(evidenceClause);
    if (looksLikeTestCount(cleanedEvidence)) {
      return `There is already meaningful verification coverage (${cleanedEvidence}), and the core ${summarizeSurface(source.summary)} is in place.`;
    }
    return ensureSentence(cleanedEvidence);
  }

  const summaryText = source.summary.trim().toLowerCase();
  if (/document vault|not a software codebase|job search|career/.test(summaryText)) {
    const support: string[] = [];
    if (source.primaryRunCommand.trim()) {
      support.push(`a defined run path via \`${source.primaryRunCommand.trim()}\``);
    }
    if (source.primaryContextDoc.trim() && !/missing|unknown/i.test(source.docsQuality)) {
      support.push(`usable context in \`${source.primaryContextDoc.trim()}\``);
    }
    if (support.length > 0) {
      return `The supporting documents and workflow structure are already in place, with ${joinWithAnd(support)}.`;
    }
    return "The supporting documents and workflow structure are already in place.";
  }

  const subject = source.summary.trim()
    ? `The ${stripTrailingPunctuation(source.summary.trim())}`
    : "The core project surface";
  const support: string[] = [];

  if (source.primaryRunCommand.trim()) {
    support.push(`a defined run path via \`${source.primaryRunCommand.trim()}\``);
  }
  if (source.primaryContextDoc.trim() && !/missing|unknown/i.test(source.docsQuality)) {
    support.push(`usable context in \`${source.primaryContextDoc.trim()}\``);
  }
  const testCoverage = describeTestPosture(source.testPosture);
  if (testCoverage) {
    support.push(testCoverage);
  }

  const maturityClause = describeMaturity(source.buildMaturity, source.shipReadiness);
  if (support.length > 0) {
    const maturity = maturityClause ? ` and ${maturityClause}` : "";
    return `${subject} is already in place${maturity}, with ${joinWithAnd(support)}.`;
  }
  if (maturityClause) {
    return `${subject} is already in place and ${maturityClause}.`;
  }
  return `${subject} is already in place and gives you something concrete to refine instead of restarting from zero.`;
}

function scoreSource(source: ProjectNarrativeSource): number {
  return [
    source.summary,
    source.primaryRunCommand,
    source.primaryContextDoc,
    source.readiness,
    source.projectHealthNotes,
    source.valueOutcome,
    source.whatWorks,
  ].reduce((total, value) => total + value.trim().length, 0);
}

function pickPreferredValue(values: string[]): string {
  return [...values]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}

function extractWorkingEvidence(text: string): string {
  if (!text.trim()) {
    return "";
  }

  const beforeRegistry = text.split("Registry:")[0]?.trim() ?? "";
  const pipeSegments = beforeRegistry
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (pipeSegments.length > 1) {
    return pipeSegments[pipeSegments.length - 1] ?? "";
  }

  const testsMatch = beforeRegistry.match(/\b\d+(?:\+|\/\d+)?\s+(?:Rust\s+)?test(?:s| files?)\b/i);
  return testsMatch?.[0]?.trim() ?? "";
}

function cleanEvidenceClause(text: string): string {
  return stripTrailingPunctuation(
    text
      .replace(/^(Legacy readiness:\s*)/i, "")
      .replace(/^\p{Extended_Pictographic}+(?:\s+Ship-ready)?\s*/u, "")
      .trim(),
  );
}

function looksLikeTestCount(text: string): boolean {
  return /^\d+(?:\+|\/\d+)?\s+(?:Rust\s+)?test(?:s| files?)$/i.test(text.trim());
}

function describeTestPosture(testPosture: string): string {
  const normalized = testPosture.trim().toLowerCase();
  if (normalized === "strong") {
    return "strong test coverage";
  }
  if (normalized === "some") {
    return "some test coverage";
  }
  return "";
}

function describeMaturity(buildMaturity: string, shipReadiness: string): string {
  const maturity = buildMaturity.trim().toLowerCase();
  const readiness = shipReadiness.trim().toLowerCase();

  if (readiness === "ship-ready" || maturity === "shippable") {
    return "already close to ship-ready";
  }
  if (readiness === "near ship") {
    return "already close enough to polish rather than rediscover";
  }
  if (maturity === "feature complete" || maturity === "functional core") {
    return "far enough along to harden instead of restart";
  }
  if (maturity === "demoable") {
    return "already demoable enough to keep iterating from the current core";
  }
  return "";
}

function summarizeSurface(summary: string): string {
  const trimmed = stripTrailingPunctuation(summary.trim());
  if (!trimmed) {
    return "project surface";
  }
  const withoutArticle = trimmed
    .replace(/^(an?|the)\s+/i, "")
    .replace(/\s+/g, " ");

  return lowerCaseLeadingWord(withoutArticle);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.\s]+$/g, "").trim();
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function lowerCaseLeadingWord(value: string): string {
  if (/^[A-Z][a-z]/.test(value)) {
    return value[0]!.toLowerCase() + value.slice(1);
  }
  return value;
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}
