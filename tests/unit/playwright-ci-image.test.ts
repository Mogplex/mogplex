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
