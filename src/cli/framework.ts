import { AppError } from "../utils/errors.js";

export type CliOptionType = "boolean" | "string" | "number" | "enum" | "string-array";

export interface GlobalCliOptions {
  profile?: string;
}

export interface CliOptionDefinition {
  name: string;
  aliases?: string[];
  description: string;
  type: CliOptionType;
  valueName?: string;
  choices?: string[];
  defaultValue?: boolean | string | number | string[];
  required?: boolean;
}

export interface CliCommandDefinition {
  name: string;
  description: string;
  options?: CliOptionDefinition[];
  examples?: string[];
  legacyConfigPath?: boolean;
  subcommands?: CliCommandDefinition[];
  run?: (input: CliInvocation) => Promise<void>;
}

export interface CliInvocation {
  command: CliCommandDefinition;
  commandPath: string[];
  globals: GlobalCliOptions;
  parsed: ParsedCliArgs;
}

export interface ParsedCliArgs {
  options: Record<string, boolean | string | number | string[] | undefined>;
  positionals: string[];
  helpRequested: boolean;
}

export interface CliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  setExitCode: (code: number) => void;
}

export const defaultCliIo: CliIo = {
  stdout: (value) => console.log(value),
  stderr: (value) => console.error(value),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export const globalCliOptions = [
  {
    name: "profile",
    description: "Select a workspace profile by name.",
    type: "string" as const,
    valueName: "name",
  },
];

export function parseCliArgs(argv: string[], options: CliOptionDefinition[] = []): ParsedCliArgs {
  const optionMap = new Map<string, CliOptionDefinition>();
  for (const option of options) {
    optionMap.set(option.name, option);
    for (const alias of option.aliases ?? []) {
      optionMap.set(alias, option);
    }
  }
  const parsedOptions: Record<string, boolean | string | number | string[] | undefined> = {};
  const positionals: string[] = [];
  let helpRequested = false;

  for (const option of options) {
    if (option.defaultValue !== undefined) {
      parsedOptions[option.name] = Array.isArray(option.defaultValue)
        ? [...option.defaultValue]
        : option.defaultValue;
    } else if (option.type === "boolean") {
      parsedOptions[option.name] = false;
    }
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }

    if (current === "--help" || current === "-h") {
      helpRequested = true;
      continue;
    }

    if (current === "--") {
      positionals.push(...argv.slice(index + 1).filter(Boolean));
      break;
    }

    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const option = optionMap.get(current.slice(2));
    if (!option) {
      throw new AppError(`Unknown flag "${current}"`);
    }

    if (option.type === "boolean") {
      parsedOptions[option.name] = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new AppError(`Expected a value for "--${option.name}"`);
    }

    if (option.type === "string") {
      parsedOptions[option.name] = next;
    } else if (option.type === "number") {
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) {
        throw new AppError(`Expected a numeric value for "--${option.name}"`);
      }
      parsedOptions[option.name] = parsed;
    } else if (option.type === "enum") {
      if (!option.choices?.includes(next)) {
        throw new AppError(
          `Expected one of ${option.choices?.join(", ") ?? "(none)"} for "--${option.name}", received "${next}"`,
        );
      }
      parsedOptions[option.name] = next;
    } else if (option.type === "string-array") {
      const existing = Array.isArray(parsedOptions[option.name]) ? (parsedOptions[option.name] as string[]) : [];
      parsedOptions[option.name] = [...existing, next];
    }

    index += 1;
  }

  return {
    options: parsedOptions,
    positionals,
    helpRequested,
  };
}

export function validateRequiredCliOptions(
  parsed: ParsedCliArgs,
  options: CliOptionDefinition[] = [],
): void {
  if (parsed.helpRequested) {
    return;
  }

  for (const option of options) {
    if (option.required && parsed.options[option.name] === undefined) {
      throw new AppError(`--${option.name} is required`);
    }
  }
}

export function renderCommandHelp(command: CliCommandDefinition, commandPath: string[] = []): string {
  const usagePath = ["notion-os", ...commandPath, command.name].join(" ");
  const lines = [command.description, "", `Usage: ${usagePath}${renderUsageSuffix(command)}`];

  if (command.legacyConfigPath) {
    lines.push("");
    lines.push("Legacy compatibility: an optional leading config path is still accepted.");
  }

  if (command.subcommands?.length) {
    lines.push("");
    lines.push("Subcommands:");
    for (const subcommand of command.subcommands) {
      lines.push(`  ${subcommand.name.padEnd(22)} ${subcommand.description}`);
    }
  }

  if (command.options?.length) {
    lines.push("");
    lines.push("Options:");
    lines.push("  --help".padEnd(26) + "Show help for this command");
    for (const option of command.options) {
      const valueSuffix = option.type === "boolean" ? "" : ` <${option.valueName ?? option.name}>`;
      const displayNames = [option.name, ...(option.aliases ?? [])].sort(
        (left, right) => Number(!left.includes("-")) - Number(!right.includes("-")),
      );
      const label = displayNames.map((name) => `--${name}${valueSuffix}`).join(", ");
      const suffix =
        option.type === "enum" && option.choices
          ? ` Choices: ${option.choices.join(", ")}.`
          : option.defaultValue !== undefined
            ? ` Default: ${Array.isArray(option.defaultValue) ? option.defaultValue.join(", ") : option.defaultValue}.`
            : "";
      lines.push(`  ${label.padEnd(26)} ${option.description}${suffix}`);
    }
  }

  lines.push("");
  lines.push("Global options:");
  for (const option of globalCliOptions) {
    lines.push(`  --${option.name} <${option.valueName ?? option.name}>`.padEnd(26) + option.description);
  }

  if (command.examples?.length) {
    lines.push("");
    lines.push("Examples:");
    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join("\n");
}

export function renderRootHelp(commands: CliCommandDefinition[]): string {
  const lines = [
    "Notion Operating System CLI",
    "",
    "Usage: notion-os [--profile <name>] <command> [subcommand] [options]",
    "Compatibility: `tsx src/cli.ts ...` still works inside the repo.",
    "",
    "Commands:",
  ];

  for (const command of commands) {
    lines.push(`  ${command.name.padEnd(18)} ${command.description}`);
  }

  lines.push("");
  lines.push("Global options:");
  lines.push("  --profile <name>     Select a workspace profile by name");
  lines.push("");
  lines.push("Run `notion-os <command> --help` for more detail.");
  return lines.join("\n");
}

export function extractGlobalCliOptions(argv: string[]): { argv: string[]; options: GlobalCliOptions } {
  const remainingArgs: string[] = [];
  const options: GlobalCliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current) {
      continue;
    }
    if (current !== "--profile") {
      remainingArgs.push(current);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new AppError('Expected a value for "--profile"');
    }

    options.profile = next;
    index += 1;
  }

  return {
    argv: remainingArgs,
    options,
  };
}

export function matchCommand(
  commands: CliCommandDefinition[],
  argv: string[],
): { command?: CliCommandDefinition; commandPath: string[]; remainingArgs: string[] } {
  let remainingArgs = [...argv];
  const commandPath: string[] = [];
  let currentCommands = commands;
  let matched: CliCommandDefinition | undefined;

  while (remainingArgs.length > 0) {
    const current = remainingArgs[0];
    if (!current || current.startsWith("-")) {
      break;
    }

    const next = currentCommands.find((command) => command.name === current);
    if (!next) {
      break;
    }

    matched = next;
    commandPath.push(next.name);
    remainingArgs = remainingArgs.slice(1);
    currentCommands = next.subcommands ?? [];
  }

  return {
    command: matched,
    commandPath,
    remainingArgs,
  };
}

function renderUsageSuffix(command: CliCommandDefinition): string {
  const parts: string[] = [];
  if (command.subcommands?.length) {
    parts.push(" <subcommand>");
  }
  if (command.legacyConfigPath) {
    parts.push(" [config-path]");
  }
  if (command.options?.length) {
    parts.push(" [options]");
  }
  return parts.join("");
}
