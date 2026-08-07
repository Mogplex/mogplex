import { normalizeDevPort, normalizeRootDirectory } from "@/lib/repo-settings";
import { isValidSandboxRootDirectory } from "@/lib/sandbox/launch-config";
import type { BootstrapDetection, BootstrapStrategy } from "./client-types";

export function escapeShell(value: string) {
  return value.replace(/'/g, String.raw`'\''`);
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

/**
 * INVARIANT: `rootDirectory` MUST have already passed
 * `isValidSandboxRootDirectory` upstream (e.g. via the launch validator
 * in `lib/sandbox/launch-config.ts`). The single-quote shell escape
 * below is the last line of defence — assert the path is well-formed
 * here so a future caller that bypasses the launch flow (a new resume
 * helper, an admin endpoint, a direct DB write reader) cannot smuggle
 * a NUL byte, parent traversal, or absolute path into the shell.
 *
 * Throws TypeError on invalid input so the caller fails loudly instead
 * of silently dropping the `cd` and running the command at the sandbox
 * root, which would be confusing to debug.
 */
export function buildShellCommand(
  command: string,
  rootDirectory?: string | null
) {
  if (!isValidSandboxRootDirectory(rootDirectory)) {
    throw new TypeError(
      "buildShellCommand: rootDirectory must pass isValidSandboxRootDirectory"
    );
  }
  const normalizedRoot = normalizeRootDirectory(rootDirectory);
  if (!normalizedRoot) return command;
  return `cd '${escapeShell(normalizedRoot)}' && ${command}`;
}

export function buildDetachedDevLaunchCommand(devCommand: string) {
  return String.raw`mkdir -p .mogplex && { (${devCommand}) 2>&1 | tee .mogplex/dev.log & printf '%s\n' "$!" > .mogplex/dev.pid; wait "$!"; }`;
}

/** Resolve the dev port based on framework. Vite defaults to 5173, everything else to 3000. */
export function extractPortFromCommand(command?: string | null) {
  if (!command) return null;

  const matchers = [
    /(?:^|\s)--port(?:=|\s+)(\d{2,5})(?=$|\s)/,
    /(?:^|\s)-p(?:=|\s+)(\d{2,5})(?=$|\s)/,
    /(?:^|\s)PORT=(\d{2,5})(?=$|\s)/,
  ];

  for (const matcher of matchers) {
    const matched = command.match(matcher);
    const port = matched?.[1] ? Number(matched[1]) : Number.NaN;
    if (Number.isFinite(port) && port > 0) {
      return normalizeDevPort(port);
    }
  }

  return null;
}

export function resolveDevPort(
  explicit: number | null | undefined,
  framework: string | undefined,
  strategy: { defaultPort: number },
  ...commandHints: Array<string | null | undefined>
) {
  if (explicit) return normalizeDevPort(explicit);
  for (const hint of commandHints) {
    const inferred = extractPortFromCommand(hint);
    if (inferred) return inferred;
  }
  if (framework === "vite") return 5173;
  return normalizeDevPort(strategy.defaultPort);
}

export function buildSelectiveRebuildCommand(
  packageManager: BootstrapDetection["packageManager"],
  rebuildTargets: string[]
) {
  return packageManager === "yarn"
    ? `yarn rebuild ${rebuildTargets.join(" ")} 2>/dev/null || true`
    : `${packageManager} rebuild ${rebuildTargets.join(" ")} 2>/dev/null || true`;
}

/**
 * Strip conflicting Next.js bundler flags from the resolved dev command.
 *
 * When the package.json dev script already contains --turbopack but the
 * resolved command (from a DB override or buildDevCommand) appends --webpack
 * (or vice versa), Next.js crashes with "Multiple bundler flags set".
 *
 * This sanitiser removes the conflicting flag so the project's own choice is
 * respected regardless of where the command originates.
 */
export function sanitizeNextBundlerFlags(
  devCommand: string,
  packageDevScript: string | null | undefined
): string {
  if (!packageDevScript) return devCommand;

  const scriptHasTurbopack = /--turbopack\b/.test(packageDevScript);
  const scriptHasWebpack = /--webpack\b/.test(packageDevScript);

  if (scriptHasTurbopack && /--webpack\b/.test(devCommand)) {
    return devCommand
      .replace(/\s+--\s+--webpack\b/, "")
      .replace(/\s+--webpack\b/, "")
      .trim();
  }

  if (scriptHasWebpack && /--turbopack\b/.test(devCommand)) {
    return devCommand
      .replace(/\s+--\s+--turbopack\b/, "")
      .replace(/\s+--turbopack\b/, "")
      .trim();
  }

  return devCommand;
}

export function resolveBootstrapInstallCommand(
  installCommand: string | null | undefined,
  strategy: BootstrapStrategy,
  packageManager: BootstrapDetection["packageManager"]
) {
  return installCommand?.trim() || strategy.buildInstallCommand(packageManager);
}

export function resolveBootstrapDevCommand(
  devCommand: string | null | undefined,
  strategy: BootstrapStrategy,
  packageManager: BootstrapDetection["packageManager"],
  framework: BootstrapDetection["framework"],
  frameworkEntry: BootstrapDetection["frameworkEntry"],
  packageDevScript?: string | null
) {
  const resolved =
    devCommand?.trim() ||
    strategy.buildDevCommand(
      packageManager,
      framework,
      frameworkEntry,
      packageDevScript
    );

  return sanitizeNextBundlerFlags(resolved, packageDevScript);
}
