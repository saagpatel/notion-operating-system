import {
  renderCommandHelp,
  type CliCommandDefinition,
  type CliInvocation,
} from "./framework.js";
import { runDestinationsCheckCommand, runDestinationsResolveCommand, runDoctorCommand, runPublishCommand } from "./core-commands.js";
import {
  runProfilesBootstrapCommand,
  runProfilesCloneCommand,
  runProfilesDiffCommand,
  runProfilesExportCommand,
  runProfilesImportCommand,
  runProfilesListCommand,
  runProfilesMigrateCommand,
  runProfilesShowCommand,
  runProfilesUpgradeCommand,
} from "./profile-commands.js";
import { runLogsRecentCommand } from "./log-commands.js";
import { resolveOptionalControlTowerConfigPath } from "./context.js";
import { runControlTowerSyncCommand } from "../notion/control-tower-sync.js";
import { runReviewPacketCommand } from "../notion/review-packet.js";
import { runPhaseCloseoutCommand } from "../notion/phase-closeout.js";
import { runLocalPortfolioViewsPlanCommand } from "../notion/plan-local-portfolio-views.js";
import { runLocalPortfolioViewsValidateCommand } from "../notion/validate-local-portfolio-views.js";
import { runExecutionSyncCommand } from "../notion/execution-sync.js";
import { runWeeklyPlanCommand } from "../notion/weekly-plan.js";
import { runExecutionViewsValidateCommand } from "../notion/validate-local-portfolio-execution-views.js";
import { runIntelligenceSyncCommand } from "../notion/intelligence-sync.js";
import { runRecommendationRunCommand } from "../notion/recommendation-run.js";
import { runLinkSuggestionsSyncCommand } from "../notion/link-suggestions-sync.js";
import { runIntelligenceViewsValidateCommand } from "../notion/validate-local-portfolio-intelligence-views.js";
import { runExternalSignalSyncCommand } from "../notion/external-signal-sync.js";
import { runExternalSignalSeedMappingsCommand } from "../notion/external-signal-seed-mappings.js";
import { runActivityRefreshCommand } from "../notion/activity-refresh.js";
import { runExternalSignalViewsValidateCommand } from "../notion/validate-local-portfolio-external-signal-views.js";
import { runProviderExpansionAuditCommand } from "../notion/provider-expansion-audit.js";
import { runActionRequestSyncCommand } from "../notion/action-request-sync.js";
import { runActionDryRunCommand } from "../notion/action-dry-run.js";
import { runActionRunnerCommand } from "../notion/action-runner.js";
import { runGovernanceAuditCommand } from "../notion/governance-audit.js";
import { runGovernanceHealthReportCommand } from "../notion/governance-health-report.js";
import { runGovernanceViewsValidateCommand } from "../notion/validate-local-portfolio-governance-views.js";
import { runActuationAuditCommand } from "../notion/actuation-audit.js";
import { runWebhookShadowDrainCommand } from "../notion/webhook-shadow-drain.js";
import { runWebhookReconcileCommand } from "../notion/webhook-reconcile.js";
import { runOperationalRolloutCommand } from "../notion/operational-rollout.js";
import { runCohortRolloutCommand } from "../notion/cohort-rollout.js";
import { runWeeklyRefreshCommand } from "../notion/weekly-refresh.js";

const commonOptions = {
  live: {
    name: "live",
    description: "Run against live Notion instead of staying in a safe planning mode.",
    type: "boolean",
  },
  today: {
    name: "today",
    description: "Override the command date anchor in YYYY-MM-DD format.",
    type: "string",
    valueName: "date",
  },
  config: {
    name: "config",
    description: "Path to the control-tower config file.",
    type: "string",
    valueName: "path",
  },
} as const;

const localPortfolioViewsConfigOption = {
  name: "config",
  description: "Path to the saved-view plan file.",
  type: "string",
  valueName: "path",
} as const;

export const cliRegistry: CliCommandDefinition[] = [
  {
    name: "publish",
    description: "Publish local content into Notion using a destination alias.",
    options: [
      { name: "request", description: "Path to a publish request JSON file.", type: "string", valueName: "path" },
      { name: "destination", description: "Destination alias to publish into.", type: "string", valueName: "alias" },
      { name: "file", description: "Path to the input markdown or text file.", type: "string", valueName: "path" },
      { name: "dryRun", description: "Force dry-run mode.", type: "boolean" },
      { name: "live", description: "Run a live publish.", type: "boolean" },
      { name: "title", description: "Override the destination title.", type: "string", valueName: "text" },
      { name: "property", description: "Repeatable property override in key=value form.", type: "string-array", valueName: "key=value" },
    ],
    examples: [
      "tsx src/cli.ts publish --request examples/requests/weekly_review.dry-run.json --dry-run",
      "tsx src/cli.ts publish --destination weekly_reviews --file ./notes/weekly.md --live",
    ],
    run: async ({ parsed }: CliInvocation) =>
      runPublishCommand({
        request: asString(parsed.options.request),
        destination: asString(parsed.options.destination),
        file: asString(parsed.options.file),
        dryRun: asBoolean(parsed.options.dryRun),
        live: asBoolean(parsed.options.live),
        title: asString(parsed.options.title),
        property: asStringArray(parsed.options.property),
      }),
  },
  {
    name: "doctor",
    description: "Verify local setup, Notion connectivity, and destination config.",
    options: [{ name: "json", description: "Emit the doctor report as JSON.", type: "boolean" }],
    run: async ({ parsed }) => runDoctorCommand({ json: asBoolean(parsed.options.json) }),
  },
  {
    name: "destinations",
    description: "Inspect and resolve destination aliases.",
    subcommands: [
      {
        name: "check",
        description: "List configured destination aliases.",
        run: async () => runDestinationsCheckCommand(),
      },
      {
        name: "resolve",
        description: "Resolve and persist live destination IDs.",
        options: [{ name: "write", description: "Legacy compatibility flag; ignored.", type: "boolean" }],
        run: async () => runDestinationsResolveCommand(),
      },
    ],
  },
  {
    name: "profiles",
    description: "Manage workspace profiles and profile bundles.",
    subcommands: [
      {
        name: "list",
        description: "List available workspace profiles.",
        run: async () => runProfilesListCommand(),
      },
      {
        name: "show",
        description: "Show the active workspace profile and resolved paths.",
        run: async () => runProfilesShowCommand(),
      },
      {
        name: "migrate",
        description: "Materialize the legacy single-workspace layout into an explicit default profile.",
        options: [{ name: "write", description: "Persist the registry and descriptor files.", type: "boolean" }],
        run: async ({ parsed }) => runProfilesMigrateCommand({ write: asBoolean(parsed.options.write) }),
      },
      {
        name: "export",
        description: "Export the active profile into a portable non-secret bundle.",
        options: [{ name: "output", description: "Path to the bundle JSON file.", type: "string", valueName: "path", required: true }],
        run: async ({ parsed }) => runProfilesExportCommand({ output: asString(parsed.options.output) }),
      },
      {
        name: "diff",
        description: "Compare the active profile against another profile or profile bundle.",
        options: [
          { name: "against-profile", description: "Profile name to compare against.", type: "string", valueName: "name" },
          { name: "against-bundle", description: "Path to a profile bundle JSON file.", type: "string", valueName: "path" },
          { name: "json", description: "Emit the diff as JSON.", type: "boolean" },
        ],
        run: async ({ parsed }) =>
          runProfilesDiffCommand({
            againstProfile: asString(parsed.options["against-profile"]),
            againstBundle: asString(parsed.options["against-bundle"]),
            json: asBoolean(parsed.options.json),
          }),
      },
      {
        name: "clone",
        description: "Create or refresh a profile from another profile's portable config state.",
        options: [
          { name: "source", description: "Source profile name.", type: "string", valueName: "name", required: true },
          { name: "target", description: "Target profile name.", type: "string", valueName: "name", required: true },
          { name: "label", description: "Optional label for the target profile.", type: "string", valueName: "text" },
          {
            name: "kind",
            description: "Optional profile kind for the target profile.",
            type: "enum",
            valueName: "kind",
            choices: ["primary", "sandbox"],
          },
          { name: "write", description: "Persist the cloned profile files.", type: "boolean" },
          { name: "json", description: "Emit the clone plan as JSON.", type: "boolean" },
        ],
        run: async ({ parsed }) =>
          runProfilesCloneCommand({
            source: asString(parsed.options.source),
            target: asString(parsed.options.target),
            label: asString(parsed.options.label),
            kind: asEnum(parsed.options.kind, ["primary", "sandbox"]),
            write: asBoolean(parsed.options.write),
            json: asBoolean(parsed.options.json),
          }),
      },
      {
        name: "bootstrap",
        description: "Initialize a profile safely from the active setup or a non-secret bundle.",
        options: [
          { name: "target", description: "Target profile name.", type: "string", valueName: "name", required: true },
          { name: "from-bundle", description: "Optional bundle JSON path to bootstrap from.", type: "string", valueName: "path" },
          {
            name: "kind",
            description: "Optional profile kind for the target profile.",
            type: "enum",
            valueName: "kind",
            choices: ["primary", "sandbox"],
          },
          { name: "write", description: "Persist only the missing profile files.", type: "boolean" },
          { name: "json", description: "Emit the bootstrap plan as JSON.", type: "boolean" },
        ],
        run: async ({ parsed }) =>
          runProfilesBootstrapCommand({
            target: asString(parsed.options.target),
            fromBundle: asString(parsed.options["from-bundle"]),
            kind: asEnum(parsed.options.kind, ["primary", "sandbox"]),
            write: asBoolean(parsed.options.write),
            json: asBoolean(parsed.options.json),
          }),
      },
      {
        name: "upgrade",
        description: "Preview or apply profile config-version migrations for the active profile.",
        options: [
          { name: "write", description: "Persist the migrated profile descriptor.", type: "boolean" },
          { name: "json", description: "Emit the upgrade plan as JSON.", type: "boolean" },
        ],
        run: async ({ parsed }) =>
          runProfilesUpgradeCommand({
            write: asBoolean(parsed.options.write),
            json: asBoolean(parsed.options.json),
          }),
      },
      {
        name: "import",
        description: "Preview or restore a bundle into a named workspace profile.",
        options: [
          { name: "bundle", description: "Path to the bundle JSON file.", type: "string", valueName: "path", required: true },
          { name: "target", description: "Target profile name. Defaults to the bundle profile name.", type: "string", valueName: "name" },
          { name: "write", description: "Persist the imported profile files.", type: "boolean" },
        ],
        run: async ({ parsed }) =>
          runProfilesImportCommand({
            bundle: asString(parsed.options.bundle),
            target: asString(parsed.options.target),
            write: asBoolean(parsed.options.write),
          }),
      },
    ],
  },
  {
    name: "logs",
    description: "Inspect recent command run logs and summaries.",
    subcommands: [
      {
        name: "recent",
        description: "Show recent completed or failed command runs from the active log directory.",
        options: [
          { name: "json", description: "Emit recent runs as JSON.", type: "boolean" },
          { name: "limit", description: "Maximum number of runs to show.", type: "number", valueName: "count", defaultValue: 10 },
        ],
        run: async ({ parsed }) =>
          runLogsRecentCommand({
            json: asBoolean(parsed.options.json),
            limit: asNumber(parsed.options.limit) ?? 10,
          }),
      },
    ],
  },
  buildFamily("control-tower", "Operate the project control tower.", [
    buildConfigCommand("sync", "Refresh control-tower derived fields and command center.", [commonOptions.live, commonOptions.today, commonOptions.config], ({ parsed }) =>
      runControlTowerSyncCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("review-packet", "Publish or preview the weekly review packet.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "include-next-phase", description: "Include the next-phase brief section.", type: "boolean" }], ({ parsed }) =>
      runReviewPacketCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        includeNextPhase: asBoolean(parsed.options["include-next-phase"]),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("phase-closeout", "Close a roadmap phase and persist repo memory artifacts.", [commonOptions.today, commonOptions.config, { name: "phase", description: "Specific phase number to close.", type: "number", valueName: "number" }], ({ parsed }) =>
      runPhaseCloseoutCommand({
        phase: asNumber(parsed.options.phase),
        today: asString(parsed.options.today),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("views-plan", "Print the saved-view sync plan.", [localPortfolioViewsConfigOption], ({ parsed }) =>
      runLocalPortfolioViewsPlanCommand({
        config: asString(parsed.options.config) ?? parsed.positionals[0],
      }),
    ),
    buildConfigCommand("views-validate", "Validate the saved-view plan against the live schema.", [localPortfolioViewsConfigOption], ({ parsed }) =>
      runLocalPortfolioViewsValidateCommand({
        config: asString(parsed.options.config) ?? parsed.positionals[0],
      }),
    ),
  ]),
  buildFamily("execution", "Run execution-system workflows.", [
    buildConfigCommand("sync", "Refresh execution briefs, metrics, and command center content.", [commonOptions.live, commonOptions.today, commonOptions.config], ({ parsed }) =>
      runExecutionSyncCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    {
      name: "views-validate",
      description: "Validate the execution saved-view plan against the live schema.",
      run: async () => runExecutionViewsValidateCommand(),
    },
    buildConfigCommand("weekly-plan", "Generate or publish the weekly execution planning packet.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "include-next-phase", description: "Include the next-phase brief in the weekly packet.", type: "boolean" }], ({ parsed }) =>
      runWeeklyPlanCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        includeNextPhase: asBoolean(parsed.options["include-next-phase"]),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
  ]),
  buildFamily("intelligence", "Run intelligence and recommendation workflows.", [
    buildConfigCommand("sync", "Refresh recommendation briefs and intelligence command center content.", [commonOptions.live, commonOptions.today, commonOptions.config], ({ parsed }) =>
      runIntelligenceSyncCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("views-validate", "Validate the intelligence saved-view plan against the live schema.", [commonOptions.config], ({ parsed }) =>
      runIntelligenceViewsValidateCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("recommendation-run", "Create a recommendation run record and weekly intelligence summary.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "type", description: "Recommendation run type.", type: "enum", valueName: "type", choices: ["weekly", "daily", "adhoc"], defaultValue: "weekly" }], ({ parsed }) =>
      runRecommendationRunCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        type: (asString(parsed.options.type) as "weekly" | "daily" | "adhoc" | undefined) ?? "weekly",
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("link-suggestions-sync", "Generate or publish suggested project support links.", [commonOptions.live, commonOptions.config], ({ parsed }) =>
      runLinkSuggestionsSyncCommand({
        live: asBoolean(parsed.options.live),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
  ]),
  buildFamily("signals", "Run external-signal and activity workflows.", [
    buildConfigCommand("sync", "Sync external provider signals into the Notion system.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "provider", description: "Provider selection.", type: "enum", valueName: "provider", choices: ["github", "vercel", "all"], defaultValue: "all" }, { name: "source-limit", description: "Optional maximum number of active sources to sync.", type: "number", valueName: "count" }, { name: "max-events-per-source", description: "Optional override for events fetched per source.", type: "number", valueName: "count" }], ({ parsed }) =>
      runExternalSignalSyncCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        provider: (asString(parsed.options.provider) as "github" | "vercel" | "all" | undefined) ?? "all",
        sourceLimit: asNumber(parsed.options["source-limit"]),
        maxEventsPerSource: asNumber(parsed.options["max-events-per-source"]),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("seed-mappings", "Seed external signal source mappings for priority projects.", [commonOptions.live, commonOptions.config, { name: "limit", description: "Maximum number of seed mappings to create.", type: "number", valueName: "count", defaultValue: 15 }], ({ parsed }) =>
      runExternalSignalSeedMappingsCommand({
        live: asBoolean(parsed.options.live),
        limit: asNumber(parsed.options.limit) ?? 15,
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("activity-refresh", "Refresh latest activity and build evidence on project rows.", [commonOptions.live, commonOptions.config, { name: "limit", description: "Limit the number of changed projects shown in output.", type: "number", valueName: "count", defaultValue: 10 }], ({ parsed }) =>
      runActivityRefreshCommand({
        live: asBoolean(parsed.options.live),
        limit: asNumber(parsed.options.limit) ?? 10,
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("views-validate", "Validate the external-signal saved-view plan against the live schema.", [commonOptions.config], ({ parsed }) =>
      runExternalSignalViewsValidateCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("provider-expansion-audit", "Audit whether non-GitHub provider expansion is ready for a bounded pilot.", [commonOptions.config], ({ parsed }) =>
      runProviderExpansionAuditCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
  ]),
  buildFamily("governance", "Run governance and actuation workflows.", [
    buildConfigCommand("audit", "Audit the governance policy and webhook posture.", [commonOptions.config], ({ parsed }) =>
      runGovernanceAuditCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("health-report", "Print a compact governance and actuation health snapshot.", [commonOptions.config], ({ parsed }) =>
      runGovernanceHealthReportCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("views-validate", "Validate the governance saved-view plan against the live schema.", [commonOptions.config], ({ parsed }) =>
      runGovernanceViewsValidateCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("action-request-sync", "Refresh action-request, governance, and actuation summaries.", [commonOptions.live, commonOptions.today, commonOptions.config], ({ parsed }) =>
      runActionRequestSyncCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("actuation-audit", "Audit the GitHub actuation lane and allowlisted target posture.", [commonOptions.config], ({ parsed }) =>
      runActuationAuditCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("action-dry-run", "Run a dry-run execution preview for one action request.", [commonOptions.config, { name: "request", description: "Action request page ID.", type: "string", valueName: "page-id", required: true }], ({ parsed }) =>
      runActionDryRunCommand({
        request: asString(parsed.options.request),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("action-runner", "Run approved action requests in dry-run or live mode.", [commonOptions.config, { name: "request", description: "Optional action request page ID override.", type: "string", valueName: "page-id" }, { name: "mode", description: "Execution mode.", type: "enum", valueName: "mode", choices: ["dry-run", "live"], defaultValue: "dry-run" }, { name: "limit", description: "Optional maximum number of requests to execute.", type: "number", valueName: "count" }], ({ parsed }) =>
      runActionRunnerCommand({
        request: asString(parsed.options.request),
        mode: (asString(parsed.options.mode) as "dry-run" | "live" | undefined) ?? "dry-run",
        limit: asNumber(parsed.options.limit),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("webhook-shadow-drain", "Drain captured webhook receipts into Notion governance records.", [commonOptions.config], ({ parsed }) =>
      runWebhookShadowDrainCommand({
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("webhook-reconcile", "List webhook deliveries that still need reconcile follow-up.", [commonOptions.config, { name: "provider", description: "Provider selection.", type: "enum", valueName: "provider", choices: ["github", "vercel", "google_calendar"], defaultValue: "github" }], ({ parsed }) =>
      runWebhookReconcileCommand({
        provider: (asString(parsed.options.provider) as "github" | "vercel" | "google_calendar" | undefined) ?? "github",
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
  ]),
  buildFamily("rollout", "Run project rollout flows.", [
    buildConfigCommand("operational", "Classify rollout candidates and optionally run the pilot flow.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "run-pilot-dry-run", description: "Run the pilot request in dry-run mode after classification.", type: "boolean" }, { name: "run-pilot-live", description: "Run the pilot request live after classification.", type: "boolean" }, { name: "approve-pilot", description: "Auto-approve the pilot request during live mode.", type: "boolean" }], ({ parsed }) =>
      runOperationalRolloutCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        runPilotDryRun: asBoolean(parsed.options["run-pilot-dry-run"]),
        runPilotLive: asBoolean(parsed.options["run-pilot-live"]),
        approvePilot: asBoolean(parsed.options["approve-pilot"]),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
    buildConfigCommand("cohort", "Run the bounded cohort rollout for the selected projects.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "approve", description: "Auto-approve the created requests during live mode.", type: "boolean" }, { name: "run-dry", description: "Run dry-run execution steps after creating requests.", type: "boolean" }, { name: "run-live", description: "Run live execution steps after creating requests.", type: "boolean" }, { name: "projects", description: "Comma-separated cohort project titles.", type: "string", valueName: "titles" }], ({ parsed }) =>
      runCohortRolloutCommand({
        live: asBoolean(parsed.options.live),
        approve: asBoolean(parsed.options.approve),
        runDry: asBoolean(parsed.options["run-dry"]),
        runLive: asBoolean(parsed.options["run-live"]),
        today: asString(parsed.options.today),
        projects: asString(parsed.options.projects),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
      }),
    ),
  ]),
  buildFamily("maintenance", "Run recurring portfolio maintenance workflows.", [
    buildConfigCommand("weekly-refresh", "Run the safe weekly refresh orchestrator.", [commonOptions.live, commonOptions.today, commonOptions.config, { name: "owner", description: "GitHub owner used for support maintenance.", type: "string", valueName: "owner" }, { name: "signal-source-limit", description: "Optional cap for GitHub sources during the weekly external-signal step.", type: "number", valueName: "count" }, { name: "signal-max-events-per-source", description: "Optional cap for events fetched per GitHub source during the weekly external-signal step.", type: "number", valueName: "count" }], ({ parsed }) =>
      runWeeklyRefreshCommand({
        live: asBoolean(parsed.options.live),
        today: asString(parsed.options.today),
        config: resolveOptionalControlTowerConfigPath({ config: asString(parsed.options.config), positionals: parsed.positionals }),
        owner: asString(parsed.options.owner),
        signalSourceLimit: asNumber(parsed.options["signal-source-limit"]),
        signalMaxEventsPerSource: asNumber(parsed.options["signal-max-events-per-source"]),
      }),
    ),
  ]),
];

export function getCommandHelp(commandPath: string[]): string | undefined {
  let currentCommands = cliRegistry;
  let current: CliCommandDefinition | undefined;

  for (const segment of commandPath) {
    current = currentCommands.find((command) => command.name === segment);
    if (!current) {
      return undefined;
    }
    currentCommands = current.subcommands ?? [];
  }

  return current ? renderCommandHelp(current, commandPath.slice(0, -1)) : undefined;
}

function buildFamily(name: string, description: string, subcommands: CliCommandDefinition[]): CliCommandDefinition {
  return { name, description, subcommands };
}

function buildConfigCommand(
  name: string,
  description: string,
  options: CliCommandDefinition["options"],
  run: NonNullable<CliCommandDefinition["run"]>,
): CliCommandDefinition {
  return {
    name,
    description,
    options,
    legacyConfigPath: true,
    run,
  };
}

function asBoolean(value: boolean | string | number | string[] | undefined): boolean {
  return value === true;
}

function asString(value: boolean | string | number | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: boolean | string | number | string[] | undefined): string[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asNumber(value: boolean | string | number | string[] | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asEnum<T extends string>(
  value: boolean | string | number | string[] | undefined,
  choices: readonly T[],
): T | undefined {
  return typeof value === "string" && choices.includes(value as T) ? (value as T) : undefined;
}
