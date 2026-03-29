import { promises as fs } from "node:fs";
import path from "node:path";

import type { LogEvent, LogLevel } from "../types.js";

export class RunLogger {
  public readonly runId: string;

  private readonly logFilePath: string;

  public constructor(logDir: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.runId = `run-${timestamp}`;
    this.logFilePath = path.resolve(logDir, `${this.runId}.jsonl`);
  }

  public async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
  }

  public async debug(action: string, details?: Record<string, unknown>): Promise<void> {
    await this.write("debug", action, details);
  }

  public async info(action: string, details?: Record<string, unknown>): Promise<void> {
    await this.write("info", action, details);
  }

  public async warn(action: string, details?: Record<string, unknown>): Promise<void> {
    await this.write("warn", action, details);
  }

  public async error(action: string, details?: Record<string, unknown>): Promise<void> {
    await this.write("error", action, details);
  }

  public get filePath(): string {
    return this.logFilePath;
  }

  private async write(level: LogLevel, action: string, details?: Record<string, unknown>): Promise<void> {
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      action,
    };
    if (details) {
      event.details = details;
    }

    const line = `${JSON.stringify(event)}\n`;
    await fs.appendFile(this.logFilePath, line, "utf8");

    const preview = details ? ` ${JSON.stringify(details)}` : "";
    const stream = level === "error" || level === "warn" ? console.error : console.log;
    stream(`[${level}] ${action}${preview}`);
  }
}
