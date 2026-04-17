export interface DirectScriptHelpOption {
  flag: string;
  description: string;
}

export interface DirectScriptHelpConfig {
  command: string;
  description: string;
  options?: DirectScriptHelpOption[];
  notes?: string[];
}

export function shouldShowDirectScriptHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function renderDirectScriptHelp(config: DirectScriptHelpConfig): string {
  const lines = [
    config.command,
    "",
    config.description,
  ];

  if (config.options?.length) {
    lines.push("", "Options:");
    for (const option of config.options) {
      lines.push(`  ${option.flag.padEnd(18)} ${option.description}`);
    }
  }

  if (config.notes?.length) {
    lines.push("", "Notes:");
    for (const note of config.notes) {
      lines.push(`  - ${note}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
