import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const workflow = parse(
  readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8"
  )
);

test("e2e uses preinstalled browsers matching the locked Playwright package", () => {
  const { version } = require("@playwright/test/package.json") as {
    version: string;
  };
  const shard = workflow.jobs["e2e-shard"];
  assert.equal(
    shard.container?.image,
    `mcr.microsoft.com/playwright:v${version}-noble`
  );
  assert.equal(shard.defaults?.run?.shell, "bash");
  const commands = shard.steps
    .map((step: { run?: string }) => step.run ?? "")
    .join("\n");
  assert.doesNotMatch(commands, /playwright install|apt-get|\bjq\b/);
  assert.match(commands, /pnpm test:e2e --shard=\$\{\{ matrix.shard \}\}\/4/);
});

test("containerized e2e retains the four shards and required fan-in on the merge queue", () => {
  assert.deepEqual(
    workflow.jobs["e2e-shard"].strategy.matrix.shard,
    [1, 2, 3, 4]
  );
  assert.equal(workflow.jobs.e2e.name, "e2e");
  assert.ok(workflow.jobs.e2e.needs.includes("e2e-shard"));
  assert.ok(Object.hasOwn(workflow.on, "merge_group"));
});

test("candidate migrations finish on the isolated database before any e2e shard starts", () => {
  const preparation = workflow.jobs["neon-branch"];
  const steps = preparation.steps as {
    name: string;
    if?: string;
    run?: string;
  }[];
  const migrateIndex = steps.findIndex((step) =>
    step.run?.includes("tsx scripts/apply-neon-migrations.ts")
  );
  assert.ok(migrateIndex > 0, "CI must apply candidate migrations before e2e");
  const resolveIndex = steps.findIndex((step) =>
    /echo "DATABASE_URL=.* >> "\$GITHUB_ENV"/.test(step.run ?? "")
  );
  assert.ok(resolveIndex > 0 && resolveIndex < migrateIndex);
  // Never migrate the shared/production fallback when branch creation is unavailable.
  assert.equal(steps[migrateIndex].if, "steps.create.outputs.branch_id != ''");
  assert.equal(steps[resolveIndex].if, "steps.create.outputs.branch_id != ''");
  assert.equal(workflow.jobs["e2e-shard"].needs, "neon-branch");
  assert.ok(workflow.jobs["neon-branch-cleanup"].needs.includes("neon-branch"));
  assert.match(workflow.jobs["neon-branch-cleanup"].if, /always\(\)/);
});
