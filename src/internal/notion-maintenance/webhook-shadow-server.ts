import "../../config/load-default-env.js";

import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadLocalPortfolioWebhookProviderConfig, createWebhookReceiptEnvelope } from "../../notion/local-portfolio-governance.js";
import { AppError, toErrorMessage } from "../../utils/errors.js";
import { losAngelesToday } from "../../utils/date.js";
import { renderInternalScriptHelp, shouldShowHelp } from "./help.js";

async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2);
    if (shouldShowHelp(argv)) {
      process.stdout.write(
        renderInternalScriptHelp({
          command: "npm run portfolio-audit:webhook-shadow-server --",
          description: "Start the local webhook shadow spool server for receipt capture.",
          options: [
            { flag: "--help, -h", description: "Show this help message." },
            { flag: "--host <host>", description: "Host interface to bind. Defaults to 127.0.0.1." },
            { flag: "--port <port>", description: "Port to bind. Defaults to 8788." },
          ],
          notes: [
            "This command starts a local server and keeps running until stopped.",
          ],
        }),
      );
      return;
    }

    const flags = parseFlags(argv);
    const providerConfig = await loadLocalPortfolioWebhookProviderConfig();
    const pendingDir = path.resolve(providerConfig.spoolDirectory, "pending");
    await mkdir(pendingDir, { recursive: true });

    const server = createServer(async (req, res) => {
      if (req.method !== "POST" || !req.url) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      const pathname = new URL(req.url, `http://${req.headers.host ?? "127.0.0.1"}`).pathname;
      const provider = providerConfig.providers.find((entry) => entry.endpointPath === pathname);
      if (!provider) {
        res.statusCode = 202;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, verificationResult: "Unknown Endpoint" }));
        return;
      }

      const body = await readBody(req);
      const receivedAt = new Date().toISOString();
      const envelope = createWebhookReceiptEnvelope({
        providerPlan: provider,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]),
        ),
        body,
        receivedAt,
        requestId: randomUUID(),
      });

      const fileName = `${receivedAt.replace(/[:.]/g, "-")}-${envelope.requestId}.json`;
      await writeFile(path.join(pendingDir, fileName), `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

      res.statusCode = 202;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          provider: envelope.provider,
          verificationResult: envelope.verificationResult,
          deliveryId: envelope.deliveryId,
        }),
      );
    });

    server.listen(flags.port, flags.host, () => {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "shadow",
            host: flags.host,
            port: flags.port,
            spoolDirectory: providerConfig.spoolDirectory,
            startedAt: losAngelesToday(),
          },
          null,
          2,
        ),
      );
    });
  } catch (error) {
    console.error(toErrorMessage(error));
    process.exitCode = 1;
  }
}

function parseFlags(argv: string[]): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = 8788;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--host") {
      host = argv[index + 1] ?? host;
      index += 1;
      continue;
    }
    if (current === "--port") {
      port = Number(argv[index + 1] ?? port);
      index += 1;
    }
  }

  if (!Number.isFinite(port) || port <= 0) {
    throw new AppError("Port must be a positive number");
  }

  return { host, port };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1]?.endsWith("webhook-shadow-server.ts")) {
  void main();
}
