export interface InternalScriptHelpOption {
  flag: string;
  description: string;
}

export interface InternalScriptHelpConfig {
  command: string;
  description: string;
  options?: InternalScriptHelpOption[];
  notes?: string[];
}

export function shouldShowHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function renderInternalScriptHelp(config: InternalScriptHelpConfig): string {
  const lines = [
    config.description,
    "",
    `Usage: ${config.command} [options]`,
  ];

  if (config.options && config.options.length > 0) {
    lines.push("", "Options:");
    for (const option of config.options) {
      lines.push(`  ${option.flag.padEnd(28)}${option.description}`);
    }
  }

  if (config.notes && config.notes.length > 0) {
    lines.push("", "Notes:");
    for (const note of config.notes) {
      lines.push(`- ${note}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
