import {
  parseCliArgs,
  validateRequiredCliOptions,
  renderCommandHelp,
  renderRootHelp,
  matchCommand,
  defaultCliIo,
  type CliIo,
  extractGlobalCliOptions,
} from "./framework.js";
import { cliRegistry } from "./registry.js";
import { AppError, toErrorMessage } from "../utils/errors.js";
import { logCommandCompleted, logCommandFailed, withCommandRunContext } from "./run-observability.js";

export async function runCli(argv: string[], io: CliIo = defaultCliIo): Promise<void> {
  const previousProfile = process.env.NOTION_PROFILE;

  try {
    const extracted = extractGlobalCliOptions(argv);
    argv = extracted.argv;

    if (extracted.options.profile) {
      process.env.NOTION_PROFILE = extracted.options.profile;
    } else if (previousProfile === undefined) {
      delete process.env.NOTION_PROFILE;
    }

    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      io.stdout(renderRootHelp(cliRegistry));
      return;
    }

    const { command, commandPath, remainingArgs } = matchCommand(cliRegistry, argv);
    if (!command) {
      throw new AppError(`Unknown command "${argv[0]}"`);
    }

    if (command.subcommands?.length && !command.run) {
      if (remainingArgs[0] && !remainingArgs[0].startsWith("-")) {
        throw new AppError(`Unknown subcommand "${remainingArgs[0]}" for "${commandPath.join(" ")}"`);
      }
      io.stdout(renderCommandHelp(command, commandPath.slice(0, -1)));
      return;
    }

    const parsed = parseCliArgs(remainingArgs, command.options);
    if (parsed.helpRequested) {
      io.stdout(renderCommandHelp(command, commandPath.slice(0, -1)));
      return;
    }
    validateRequiredCliOptions(parsed, command.options);

    if (command.subcommands?.length && !command.run) {
      io.stdout(renderCommandHelp(command, commandPath.slice(0, -1)));
      return;
    }

    if (!command.run) {
      throw new AppError(`Command "${commandPath.join(" ")}" is not executable`);
    }
    const runCommand = command.run;

    await withCommandRunContext({ commandPath, parsed }, async () => {
      try {
        await runCommand({
          command,
          commandPath,
          globals: extracted.options,
          parsed,
        });
        await logCommandCompleted();
      } catch (error) {
        await logCommandFailed(error);
        throw error;
      }
    });
  } catch (error) {
    io.stderr(toErrorMessage(error));
    io.setExitCode(1);
  } finally {
    if (previousProfile === undefined) {
      delete process.env.NOTION_PROFILE;
    } else {
      process.env.NOTION_PROFILE = previousProfile;
    }
  }
}
