import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source the deployed app, its Trigger tasks, and the self-hosting scripts
 * read configuration from. Other `scripts/` files are maintainer tooling
 * (smoke tests, evals, one-off runbooks) whose inputs are documented with the
 * script, not in `.env.example`.
 */
export const ENV_SCAN_ROOTS = [
  "app",
  "lib",
  "trigger",
  "proxy.ts",
  "instrumentation.ts",
  "instrumentation-client.ts",
  "next.config.mjs",
  "trigger.config.ts",
  "scripts/apply-neon-migrations.ts",
  "scripts/trigger-cli.ts",
] as const;

/** Prompt templates that quote example code; their env reads are prose. */
const ENV_SCAN_EXCLUDES = new Set(["lib/agents/templates"]);

const SOURCE_FILE = /\.(?:ts|tsx|mjs|js)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|tsx|mjs|js)$/;

/**
 * Read patterns the scan recognizes:
 * - `process.env.NAME`, `process.env?.NAME`, and `process.env["NAME"]`
 * - `env.NAME` / `env?.NAME`, where `env` is an injected `ProcessEnv`
 * - `const SOMETHING_ENV = "NAME"` / `const SOMETHING_FLAG = "NAME"`, the
 *   repo's convention for indirect `process.env[SOMETHING_ENV]` reads
 * - a string literal passed to a local `require…Env("NAME")`,
 *   `read…Env("NAME")`, or `get…Env("NAME")` helper
 *
 * Fully dynamic keys (`process.env[name]` with a computed `name`) are not
 * detectable statically; route them through one of the forms above.
 */
const READ_PATTERNS = [
  /process\.env\??\.([A-Z][A-Z0-9_]+)\b/g,
  /process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
  /(?<![\w.$])env\??\.([A-Z][A-Z0-9_]{2,})\b/g,
  /const\s+[A-Z0-9_]*(?:_ENV|_FLAG)\s*=\s*["']([A-Z][A-Z0-9_]+)["']/g,
  /\b(?:require|read|get)\w*Env\(\s*["']([A-Z][A-Z0-9_]+)["']/g,
];

export function findEnvReads(source: string): Set<string> {
  const names = new Set<string>();
  for (const pattern of READ_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

/** Names `.env.example` declares, as `NAME=` or commented `# NAME=`. */
export function parseEnvExampleNames(contents: string): Set<string> {
  const names = new Set<string>();
  for (const line of contents.split("\n")) {
    const match = /^#?\s*([A-Z][A-Z0-9_]+)=/.exec(line.trim());
    if (match) names.add(match[1]);
  }
  return names;
}

function listSourceFiles(root: string, path: string): string[] {
  if (ENV_SCAN_EXCLUDES.has(path)) return [];
  const absolute = join(root, path);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return SOURCE_FILE.test(path) && !TEST_FILE.test(path) ? [absolute] : [];
  }
  return readdirSync(absolute).flatMap((entry) =>
    entry === "node_modules" ? [] : listSourceFiles(root, join(path, entry))
  );
}

/** Every env name read under `roots`, mapped to the files that read it. */
export function collectEnvReads(
  repoRoot: string,
  roots: readonly string[] = ENV_SCAN_ROOTS
): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  for (const root of roots) {
    for (const file of listSourceFiles(repoRoot, root)) {
      for (const name of findEnvReads(readFileSync(file, "utf8"))) {
        const files = reads.get(name) ?? [];
        files.push(relative(repoRoot, file));
        reads.set(name, files);
      }
    }
  }
  return reads;
}
