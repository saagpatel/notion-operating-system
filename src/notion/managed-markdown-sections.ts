export interface ManagedMarkdownSection {
  key: string;
  startMarker: string;
  endMarker: string;
  fallbackHeading: string;
  fallbackBody: string;
}

export const EXECUTION_COMMAND_CENTER_SECTION: ManagedMarkdownSection = {
  key: "executionCommandCenter",
  startMarker: "<!-- codex:notion-execution-command-center:start -->",
  endMarker: "<!-- codex:notion-execution-command-center:end -->",
  fallbackHeading: "## Phase 2 Execution System",
  fallbackBody: "- Not refreshed yet.",
};

export const FRESHNESS_COMMAND_CENTER_SECTION: ManagedMarkdownSection = {
  key: "freshnessCommandCenter",
  startMarker: "<!-- codex:notion-freshness-command-center:start -->",
  endMarker: "<!-- codex:notion-freshness-command-center:end -->",
  fallbackHeading: "## Freshness By Layer",
  fallbackBody: "- Not refreshed yet.",
};

export const INTELLIGENCE_COMMAND_CENTER_SECTION: ManagedMarkdownSection = {
  key: "intelligenceCommandCenter",
  startMarker: "<!-- codex:notion-intelligence-command-center:start -->",
  endMarker: "<!-- codex:notion-intelligence-command-center:end -->",
  fallbackHeading: "## Phase 3 Cross-Database Intelligence",
  fallbackBody: "- Not refreshed yet.",
};

export const EXTERNAL_SIGNAL_COMMAND_CENTER_SECTION: ManagedMarkdownSection = {
  key: "externalSignalCommandCenter",
  startMarker: "<!-- codex:notion-external-signal-command-center:start -->",
  endMarker: "<!-- codex:notion-external-signal-command-center:end -->",
  fallbackHeading: "## Phase 5 External Signals",
  fallbackBody: "- Not refreshed yet.",
};

export const GOVERNANCE_COMMAND_CENTER_SECTION: ManagedMarkdownSection = {
  key: "governanceCommandCenter",
  startMarker: "<!-- codex:notion-governance-command-center:start -->",
  endMarker: "<!-- codex:notion-governance-command-center:end -->",
  fallbackHeading: "## Phase 6 Governance",
  fallbackBody: "- Not refreshed yet.",
};

export const ACTUATION_COMMAND_CENTER_SECTION: ManagedMarkdownSection = {
  key: "actuationCommandCenter",
  startMarker: "<!-- codex:notion-actuation-command-center:start -->",
  endMarker: "<!-- codex:notion-actuation-command-center:end -->",
  fallbackHeading: "## External Actuation Lane",
  fallbackBody: "- Not refreshed yet.",
};

export const WEEKLY_EXTERNAL_SIGNALS_SECTION: ManagedMarkdownSection = {
  key: "weeklyExternalSignals",
  startMarker: "<!-- codex:notion-weekly-external-signals:start -->",
  endMarker: "<!-- codex:notion-weekly-external-signals:end -->",
  fallbackHeading: "## Phase 5 External Signals",
  fallbackBody: "- Not refreshed yet.",
};

export const WEEKLY_MORNING_BRIEF_SECTION: ManagedMarkdownSection = {
  key: "weeklyMorningBrief",
  startMarker: "<!-- codex:notion-morning-brief:start -->",
  endMarker: "<!-- codex:notion-morning-brief:end -->",
  fallbackHeading: "## Morning Brief",
  fallbackBody: "- Not refreshed yet.",
};

export const WEEKLY_TREND_REPORT_SECTION: ManagedMarkdownSection = {
  key: "weeklyTrendReport",
  startMarker: "<!-- codex:notion-trend-analysis:start -->",
  endMarker: "<!-- codex:notion-trend-analysis:end -->",
  fallbackHeading: "## Trend Analysis",
  fallbackBody: "- Not refreshed yet.",
};

export const WEEKLY_TODAY_FOCUS_SECTION: ManagedMarkdownSection = {
  key: "weeklyTodayFocus",
  startMarker: "<!-- codex:notion-today-focus:start -->",
  endMarker: "<!-- codex:notion-today-focus:end -->",
  fallbackHeading: "## Daily Focus",
  fallbackBody: "- Not refreshed yet.",
};

export const COMMAND_CENTER_MANAGED_SECTIONS: ManagedMarkdownSection[] = [
  EXECUTION_COMMAND_CENTER_SECTION,
  INTELLIGENCE_COMMAND_CENTER_SECTION,
  EXTERNAL_SIGNAL_COMMAND_CENTER_SECTION,
  GOVERNANCE_COMMAND_CENTER_SECTION,
  ACTUATION_COMMAND_CENTER_SECTION,
];

export const WEEKLY_REVIEW_MANAGED_SECTIONS: ManagedMarkdownSection[] = [
  WEEKLY_EXTERNAL_SIGNALS_SECTION,
  WEEKLY_MORNING_BRIEF_SECTION,
  WEEKLY_TREND_REPORT_SECTION,
  WEEKLY_TODAY_FOCUS_SECTION,
];

export function renderManagedSectionPlaceholder(section: ManagedMarkdownSection): string {
  return [
    section.startMarker,
    section.fallbackHeading,
    "",
    section.fallbackBody,
    section.endMarker,
  ].join("\n");
}
