import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { VERCEL_SANDBOX_SDK_IMPORTERS } from "../../scripts/eslint-rules/vercel-sandbox-importers.mjs";
import {
  getSandboxProvider,
  resolveSandboxProviderId,
} from "../../lib/sandbox/provider";
import { listScanSourceFiles } from "../support/env-example-scan";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SDK_IMPORT = /from\s+["']@vercel\/sandbox(?:\/[^"']*)?["']/;

test("resolveSandboxProviderId defaults to vercel and normalizes case", () => {
  assert.equal(resolveSandboxProviderId({}), "vercel");
  assert.equal(
    resolveSandboxProviderId({ MOGPLEX_SANDBOX_PROVIDER: "  " }),
    "vercel"
  );
  assert.equal(
    resolveSandboxProviderId({ MOGPLEX_SANDBOX_PROVIDER: "Vercel" }),
    "vercel"
  );
});

test("resolveSandboxProviderId rejects an unknown backend instead of falling back", () => {
  assert.throws(
    () => resolveSandboxProviderId({ MOGPLEX_SANDBOX_PROVIDER: "docker" }),
    /Unknown MOGPLEX_SANDBOX_PROVIDER "docker"\. Supported: vercel\./
  );
});

test("the vercel provider reports every capability", () => {
  const provider = getSandboxProvider({});

  assert.equal(provider.id, "vercel");
  assert.deepEqual(provider.capabilities, {
    snapshots: true,
    previewUrls: true,
    extendTimeout: true,
    detachedCommands: true,
    persistentSandboxes: true,
    nestedSandbox: true,
  });
});

test("the Vercel SDK importer allowlist only lists files that still import it", () => {
  const stale = VERCEL_SANDBOX_SDK_IMPORTERS.filter((file) => {
    const absolute = path.join(REPO_ROOT, file);
    return (
      !existsSync(absolute) || !SDK_IMPORT.test(readFileSync(absolute, "utf8"))
    );
  });

  assert.deepEqual(
    stale,
    [],
    "remove migrated files from scripts/eslint-rules/vercel-sandbox-importers.mjs"
  );
  assert.deepEqual(
    VERCEL_SANDBOX_SDK_IMPORTERS,
    [...new Set(VERCEL_SANDBOX_SDK_IMPORTERS)].sort(),
    "keep the allowlist sorted and unique"
  );
});

test("only the Vercel adapter and allowlisted files import the Vercel SDK", () => {
  const allowed = new Set(VERCEL_SANDBOX_SDK_IMPORTERS);
  const offenders = listScanSourceFiles(REPO_ROOT, [
    "app",
    "components",
    "hooks",
    "lib",
    "scripts",
    "trigger",
  ])
    .map((file) => path.relative(REPO_ROOT, file))
    .filter(
      (file) =>
        !file.startsWith("lib/sandbox/provider/vercel/") &&
        !/\.test\.tsx?$/.test(file) &&
        !allowed.has(file) &&
        SDK_IMPORT.test(readFileSync(path.join(REPO_ROOT, file), "utf8"))
    );

  assert.deepEqual(offenders, []);
});
