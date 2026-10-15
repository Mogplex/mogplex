import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { listScanSourceFiles } from "../support/env-example-scan";

const repoRoot = join(import.meta.dirname, "..", "..");

const RUNTIME_PUBLIC_READ =
  /readRuntimeEnv\(\s*["'](NEXT_PUBLIC_[A-Z0-9_]+)["']/g;

/**
 * `NEXT_PUBLIC_*` names that a runtime read in `source` uses without also
 * falling back to the build-time inlined `process.env.NAME`.
 */
function findRuntimeOnlyPublicReads(source: string): string[] {
  const missing = new Set<string>();
  for (const [, name] of source.matchAll(RUNTIME_PUBLIC_READ)) {
    if (!source.includes(`process.env.${name}`)) missing.add(name);
  }
  return [...missing].sort();
}

test("findRuntimeOnlyPublicReads flags a runtime read without the inlined fallback", () => {
  assert.deepEqual(
    findRuntimeOnlyPublicReads('readRuntimeEnv("NEXT_PUBLIC_ONLY_RUNTIME")'),
    ["NEXT_PUBLIC_ONLY_RUNTIME"]
  );
  assert.deepEqual(
    findRuntimeOnlyPublicReads(
      'readRuntimeEnv("NEXT_PUBLIC_BOTH") ?? process.env.NEXT_PUBLIC_BOTH'
    ),
    []
  );
});

// Deployments that set a NEXT_PUBLIC_* value only at build time have it only
// as the inlined value, so a runtime read alone returns undefined (#648).
test("every runtime NEXT_PUBLIC_* read falls back to the build-time value", () => {
  const offenders = listScanSourceFiles(repoRoot).flatMap((file) =>
    findRuntimeOnlyPublicReads(readFileSync(file, "utf8")).map(
      (name) => `${name} in ${relative(repoRoot, file)}`
    )
  );

  assert.deepEqual(
    offenders,
    [],
    `Fall back to the static process.env read, as readAppUrlEnv does:\n  ${offenders.join("\n  ")}`
  );
});
