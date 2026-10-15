import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  collectEnvReads,
  findDuplicateEnvExampleNames,
  findEnvReads,
  parseEnvExampleNames,
} from "../support/env-example-scan";

const repoRoot = join(import.meta.dirname, "..", "..");

/**
 * Names the code reads that an operator never sets in `.env.example`.
 * Each entry says who provides the value. Add to this list only when that
 * is true; a configurable setting belongs in `.env.example` instead.
 */
const NOT_OPERATOR_CONFIG: Record<string, string> = {
  CI: "set by CI providers",
  NODE_ENV: "set by Next.js and Node tooling",
  NEXT_RUNTIME: "set by Next.js per runtime",
  VITEST: "set by Vitest",
  PLAYWRIGHT: "set by the e2e harness (playwright.config.ts)",
  PLAYWRIGHT_AUTH_BYPASS_SECRET: "e2e-only; inert unless PLAYWRIGHT=1",
  VERCEL: "Vercel system variable",
  VERCEL_ENV: "Vercel system variable",
  VERCEL_URL: "Vercel system variable",
  VERCEL_DEPLOYMENT_ID: "Vercel system variable",
  VERCEL_GIT_COMMIT_REF: "Vercel system variable",
  VERCEL_GIT_COMMIT_SHA: "Vercel system variable",
  VERCEL_OIDC_TOKEN: "Vercel system variable",
  NEXT_PUBLIC_VERCEL_ENV: "Vercel system variable",
  NEXT_PUBLIC_MOGPLEX_DEPLOYMENT_ID: "defined at build time by next.config.mjs",
  TRIGGER_VERSION: "set by Trigger.dev workers and the deploy workflow",
  TRIGGER_EXTERNAL_DEPLOYMENT_ID: "set by deploy-production.yml per release",
  TRIGGER_AUTOMATIC_SKEW_VERSION_PROTECTION: "set by Trigger.dev",
  OPENAI_BASE_URL: "set by Mogplex inside sandboxes for harness CLIs",
  MOGPLEX_RESEARCH_MCP_URL: "set by Mogplex inside sandboxes (run-scoped)",
  MOGPLEX_RESEARCH_TOKEN: "set by Mogplex inside sandboxes (run-scoped)",
  MOGPLEX_TERMINAL_BRIDGE_PORT: "set by Mogplex inside sandboxes",
  MOGPLEX_TERMINAL_BRIDGE_TOKEN: "set by Mogplex inside sandboxes",
  SANDBOX_DISABLE_USER_BILLING:
    "retired name; instrumentation.ts reads it only to reject it",
  NEXT_PUBLIC_SANDBOX_DISABLE_USER_BILLING:
    "read only by the retired-name check in instrumentation.ts",
};

test("findEnvReads recognizes every supported read form", () => {
  const source = [
    "const a = process.env.DIRECT_READ;",
    "const b = process.env?.OPTIONAL_READ;",
    'const c = process.env["BRACKET_READ"];',
    "const d = (env = process.env) => env.INJECTED_READ;",
    'const FEATURE_TOGGLE_ENV = "INDIRECT_READ";',
    'const e = requireGithubAppEnv("HELPER_READ");',
    "const f = someEnv.NOT_A_READ; const g = process.env[name];",
  ].join("\n");

  assert.deepEqual([...findEnvReads(source)].sort(), [
    "BRACKET_READ",
    "DIRECT_READ",
    "HELPER_READ",
    "INDIRECT_READ",
    "INJECTED_READ",
    "OPTIONAL_READ",
  ]);
});

test("parseEnvExampleNames accepts set and commented declarations", () => {
  const names = parseEnvExampleNames(
    "SET_VALUE=1\n# COMMENTED_VALUE=off\n# Prose mentioning NOT_DECLARED.\n"
  );
  assert.deepEqual([...names].sort(), ["COMMENTED_VALUE", "SET_VALUE"]);
});

test("findDuplicateEnvExampleNames reports names declared twice", () => {
  assert.deepEqual(
    findDuplicateEnvExampleNames(
      "API_URL=1\n# API_KEY=\nUNIQUE=\n# API_URL=2\nAPI_KEY=x\n"
    ),
    ["API_KEY", "API_URL"]
  );
});

test(".env.example declares each name once", () => {
  const duplicates = findDuplicateEnvExampleNames(
    readFileSync(join(repoRoot, ".env.example"), "utf8")
  );
  assert.deepEqual(
    duplicates,
    [],
    `Keep one declaration of each (a merge often leaves both copies): ${duplicates.join(", ")}`
  );
});

test("every env var the app reads is declared in .env.example", () => {
  const declared = parseEnvExampleNames(
    readFileSync(join(repoRoot, ".env.example"), "utf8")
  );
  const missing = [...collectEnvReads(repoRoot)]
    .filter(([name]) => !(declared.has(name) || name in NOT_OPERATOR_CONFIG))
    .map(([name, files]) => `${name} (read in ${files.slice(0, 3).join(", ")})`)
    .sort();

  assert.deepEqual(
    missing,
    [],
    `Add these to .env.example with a short comment, or to NOT_OPERATOR_CONFIG if no operator sets them:\n  ${missing.join("\n  ")}`
  );
});

test("NOT_OPERATOR_CONFIG lists only names the code still reads", () => {
  const read = collectEnvReads(repoRoot);
  const stale = Object.keys(NOT_OPERATOR_CONFIG).filter(
    (name) => !read.has(name)
  );
  assert.deepEqual(stale, [], `Remove stale entries: ${stale.join(", ")}`);
});
