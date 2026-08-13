import { normalizeDevPort, normalizeRootDirectory } from "@/lib/repo-settings";
import { isValidSandboxRootDirectory } from "@/lib/sandbox/launch-config";
import type { BootstrapDetection, BootstrapStrategy } from "./client-types";

export const SANDBOX_BUN_VERSION = "1.3.10";

// Published in the pinned release's SHASUMS256.txt:
// https://github.com/oven-sh/bun/releases/tag/bun-v1.3.10
const SANDBOX_BUN_SHA256 = {
  "bun-linux-aarch64":
    "fa5ecb25cafa8e8f5c87a0f833719d46dd0af0a86c7837d806531212d55636d3",
  "bun-linux-x64-baseline":
    "41201a8c5ee74a9dcbb1ce25a1104f1f929838b57a845aa78d98379b0ce7cde2",
  "bun-linux-x64":
    "f57bc0187e39623de716ba3a389fda5486b2d7be7131a980ba54dc7b733d2e08",
} as const;

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

export function commandRequiresBun(command: string | null | undefined) {
  return /(?:^|[\s;&|()])bunx?(?:$|[\s;&|()])/.test(command ?? "");
}

export function buildWithBunOnPathCommand(command: string) {
  const bunInstallDefault = ["$", "{BUN_INSTALL:-$HOME/.bun}"].join("");
  return (
    `export BUN_INSTALL="${bunInstallDefault}"
export PATH="$BUN_INSTALL/bin:$PATH"
` + command
  );
}

export function buildEnsureBunCommand(version = SANDBOX_BUN_VERSION) {
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    throw new TypeError("Bun version must be a release tag fragment");
  }
  if (version !== SANDBOX_BUN_VERSION) {
    throw new TypeError("Bun version does not have pinned sandbox checksums");
  }

  const bunInstallDefault = ["$", "{BUN_INSTALL:-$HOME/.bun}"].join("");
  const bunTargetExpansion = ["$", "{bun_target}"].join("");

  return `export BUN_INSTALL="${bunInstallDefault}"
export PATH="$BUN_INSTALL/bin:$PATH"
set -eu
mkdir -p "$BUN_INSTALL/bin"
if ! command -v bun >/dev/null 2>&1; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64)
      if grep -qw avx2 /proc/cpuinfo; then
        bun_target="bun-linux-x64"; bun_sha256="${SANDBOX_BUN_SHA256["bun-linux-x64"]}"
      else
        bun_target="bun-linux-x64-baseline"; bun_sha256="${SANDBOX_BUN_SHA256["bun-linux-x64-baseline"]}"
      fi
      ;;
    aarch64|arm64) bun_target="bun-linux-aarch64"; bun_sha256="${SANDBOX_BUN_SHA256["bun-linux-aarch64"]}" ;;
    *) echo "Unsupported Bun sandbox architecture: $arch" >&2; exit 1 ;;
  esac
  bun_zip="/tmp/mogplex-${bunTargetExpansion}.zip"
  command -v curl >/dev/null 2>&1 || { echo "Bun install requires curl" >&2; exit 1; }
  command -v unzip >/dev/null 2>&1 || { echo "Bun install requires unzip" >&2; exit 1; }
  command -v sha256sum >/dev/null 2>&1 || { echo "Bun install requires sha256sum" >&2; exit 1; }
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${bunTargetExpansion}.zip" -o "$bun_zip"
  printf '%s  %s\\n' "$bun_sha256" "$bun_zip" | sha256sum -c -
  unzip -q -o "$bun_zip" -d "$BUN_INSTALL"
  mv "$BUN_INSTALL/$bun_target/bun" "$BUN_INSTALL/bin/bun"
  chmod +x "$BUN_INSTALL/bin/bun"
  rm -rf "$BUN_INSTALL/$bun_target" "$bun_zip"
fi
if ! command -v bunx >/dev/null 2>&1; then
  ln -sf "$(command -v bun)" "$BUN_INSTALL/bin/bunx"
fi
bun --version`;
}

/**
 * Node one-liner (run with `node -e`) that probes the checked-out repo for
 * bun usage the resolved install/dev commands can't reveal: a bun lockfile,
 * a `packageManager: "bun@…"` field, or any package.json script that invokes
 * bun — including scripts in nested workspace packages that run transitively
 * through a root command like `pnpm --filter pkg dev`. Prints "1" or "0".
 *
 * Node is guaranteed present in the sandbox image, so this works regardless
 * of the repo's own toolchain.
 */
export function buildDetectBunUsageScript() {
  return [
    "const fs = require('fs');",
    "const path = require('path');",
    "const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.turbo', 'build']);",
    "const BUN = /(?:^|[\\s;&|()])bunx?(?:$|[\\s;&|()])/;",
    "let found = false;",
    "function walk(dir, depth) {",
    "  if (found || depth > 4) return;",
    "  let entries;",
    "  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }",
    "  for (const entry of entries) {",
    "    if (found) return;",
    "    const p = path.join(dir, entry.name);",
    "    if (entry.isDirectory()) {",
    "      if (!SKIP.has(entry.name)) walk(p, depth + 1);",
    "      continue;",
    "    }",
    "    if (entry.name === 'bun.lock' || entry.name === 'bun.lockb') { found = true; return; }",
    "    if (entry.name !== 'package.json') continue;",
    "    try {",
    "      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));",
    "      if (typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('bun@')) { found = true; return; }",
    "      for (const value of Object.values(pkg.scripts || {})) {",
    "        if (typeof value === 'string' && BUN.test(value)) { found = true; return; }",
    "      }",
    "    } catch {}",
    "  }",
    "}",
    "walk('.', 0);",
    "process.stdout.write(found ? '1' : '0');",
  ].join("\n");
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
