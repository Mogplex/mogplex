import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `tsx` does not currently populate `import.meta.dirname` for imported `.mjs`
// files, so keep a compatibility fallback for unit tests.
/* eslint-disable unicorn/prefer-import-meta-properties */
const CURRENT_DIR =
  import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
const CURRENT_FILENAME = import.meta.filename ?? fileURLToPath(import.meta.url);
/* eslint-enable unicorn/prefer-import-meta-properties */
const ROOT_DIR = path.resolve(CURRENT_DIR, "..");
const HARNESS_CONFIG_PATH = path.join(ROOT_DIR, "lib/harness/config.ts");
const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";

const KNOWN_HARNESS_PACKAGES = ["@anthropic-ai/claude-code", "@openai/codex"];

function escapeRegExp(value) {
  return value.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function buildPinnedHarnessVersionPattern(packageName) {
  const pattern = String.raw`(package:\s*"${escapeRegExp(packageName)}",\s*\n\s*version:\s*")([^"]+)(")`;
  return new RegExp(pattern, "m");
}

export function findPinnedHarnessVersion(source, packageName) {
  const match = source.match(buildPinnedHarnessVersionPattern(packageName));
  if (!match?.[2]) {
    throw new Error(`Could not find pinned version for ${packageName}`);
  }
  return match[2];
}

export function replacePinnedHarnessVersion(source, packageName, nextVersion) {
  const pattern = buildPinnedHarnessVersionPattern(packageName);
  if (!pattern.test(source)) {
    throw new Error(`Could not replace pinned version for ${packageName}`);
  }
  return source.replace(pattern, `$1${nextVersion}$3`);
}

async function fetchLatestHarnessVersion(packageName) {
  const response = await fetch(
    `${NPM_REGISTRY_BASE_URL}/${encodeURIComponent(packageName)}/latest`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "mogplex-harness-pin-sync",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${packageName} metadata: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();
  if (
    typeof payload?.version !== "string" ||
    payload.version.trim().length === 0
  ) {
    throw new Error(
      `Registry response for ${packageName} did not include a version`
    );
  }

  return payload.version.trim();
}

function printLine(message) {
  process.stdout.write(`${message}\n`);
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}

async function syncHarnessPins({ checkOnly, write }) {
  const source = await readFile(HARNESS_CONFIG_PATH, "utf8");

  const latestByPackage = await Promise.all(
    KNOWN_HARNESS_PACKAGES.map(async (packageName) => ({
      packageName,
      currentVersion: findPinnedHarnessVersion(source, packageName),
      latestVersion: await fetchLatestHarnessVersion(packageName),
    }))
  );

  const updates = latestByPackage.filter(
    (entry) => entry.currentVersion !== entry.latestVersion
  );

  if (updates.length === 0) {
    printLine("Harness pins already match npm latest.");
    return { updated: false };
  }

  for (const update of updates) {
    printLine(
      `${update.packageName}: ${update.currentVersion} -> ${update.latestVersion}`
    );
  }

  if (checkOnly) {
    return { updated: false, driftDetected: true };
  }

  if (!write) {
    return { updated: false };
  }

  let nextSource = source;
  for (const update of updates) {
    nextSource = replacePinnedHarnessVersion(
      nextSource,
      update.packageName,
      update.latestVersion
    );
  }

  await writeFile(HARNESS_CONFIG_PATH, nextSource);
  printLine(`Updated ${path.relative(ROOT_DIR, HARNESS_CONFIG_PATH)}`);

  return { updated: true };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has("--check");
  const write = args.has("--write");

  if (checkOnly && write) {
    throw new Error("Use either --check or --write, not both.");
  }

  if (!checkOnly && !write) {
    throw new Error("Pass --check to detect drift or --write to update pins.");
  }

  const result = await syncHarnessPins({ checkOnly, write });
  return result.driftDetected ? 1 : 0;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === CURRENT_FILENAME;

if (isDirectRun) {
  // eslint-disable-next-line unicorn/prefer-top-level-await
  void (async () => {
    try {
      const exitCode = await main();
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    } catch (error) {
      printError(
        error instanceof Error
          ? error.message
          : "Harness sync failed unexpectedly"
      );
      process.exit(1);
    }
  })();
}
