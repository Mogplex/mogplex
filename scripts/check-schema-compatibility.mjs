// Run previous-release code before and after candidate migrations in a
// disposable database. This does not connect to any hosted database.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const help = `Usage: pnpm test:schema-compatibility <previous-commit>

Example: pnpm test:schema-compatibility origin/main
Runs previous-release reads, writes, and worker RPCs before and after candidate
Neon migrations in an isolated local database. No hosted database is used.`;
const { values, positionals } = parseArgs({
  options: { help: { type: "boolean", short: "h" } },
  allowPositionals: true,
});
if (values.help) {
  process.stdout.write(`${help}\n`);
  process.exit(0);
}
if (positionals.length !== 1) {
  process.stderr.write(`${help}\n`);
  process.exit(2);
}
const candidate = process.cwd();
const previousRef = positionals[0];
const previousSha = execFileSync(
  "git",
  ["rev-parse", "--verify", "--end-of-options", `${previousRef}^{commit}`],
  { encoding: "utf8" }
).trim();
const scratch = mkdtempSync(
  path.join(os.tmpdir(), "mogplex-schema-compatibility-")
);
const previous = path.join(scratch, "previous");
const database = path.join(scratch, "database");
// Do not pass runtime database, provider, or telemetry credentials to old code.
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "PNPM_HOME", "COREPACK_HOME", "SYSTEMROOT"]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]])
);
env.HUSKY = "0";
env.CI = "true";
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}
function stage(root, mode) {
  run(
    "pnpm",
    [
      "exec",
      "tsx",
      "--tsconfig",
      path.join(root, "tsconfig.json"),
      "--require",
      path.join(root, "tests/support/bundler-shims.cjs"),
      path.join(root, "tests/support/schema-compatibility-stage.ts"),
      mode,
      database,
    ],
    root
  );
}
try {
  mkdirSync(previous);
  const archive = path.join(scratch, "previous.tar");
  writeFileSync(
    archive,
    execFileSync("git", ["archive", "--format=tar", previousSha], {
      maxBuffer: 100 * 1024 * 1024,
    })
  );
  run("tar", ["-xf", archive, "-C", previous], candidate);
  for (const filename of [
    "schema-compatibility-stage.ts",
    "schema-compatibility-contract.ts",
  ]) {
    copyFileSync(
      path.join(candidate, "tests/support", filename),
      path.join(previous, "tests/support", filename)
    );
  }
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], previous);
  process.stdout.write(
    `Checking previous release ${previousSha} against candidate migrations\n`
  );
  stage(previous, "seed");
  stage(candidate, "migrate");
  stage(previous, "verify");
  process.stdout.write(`Schema compatibility passed for ${previousSha}\n`);
} catch {
  process.stderr.write(
    "Schema compatibility failed; see the failed phase above.\n"
  );
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
