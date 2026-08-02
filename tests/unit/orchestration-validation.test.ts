import assert from "node:assert/strict";
import test from "node:test";

async function loadValidation() {
  return import("../../lib/orchestrations/validation");
}

test("slug helpers normalize run and task titles", async () => {
  const {
    MAX_ORCHESTRATION_SLUG_LENGTH,
    isValidOrchestrationSlug,
    toRunSlug,
    toTaskSlug,
  } = await loadValidation();

  assert.equal(
    toRunSlug("Build Multi-Agent Git Tree Orchestration!"),
    "build-multi-agent-git-tree-orchestration"
  );
  assert.equal(toTaskSlug("OCH-003: State Machine"), "och-003-state-machine");
  assert.equal(toRunSlug("   "), "run");
  assert.equal(toTaskSlug("!!!"), "task");
  assert.equal(
    toRunSlug("a".repeat(MAX_ORCHESTRATION_SLUG_LENGTH + 20)).length,
    MAX_ORCHESTRATION_SLUG_LENGTH
  );
  assert.equal(isValidOrchestrationSlug(toRunSlug("a-".repeat(33))), true);
  assert.equal(
    isValidOrchestrationSlug("a".repeat(MAX_ORCHESTRATION_SLUG_LENGTH)),
    true
  );
  assert.equal(
    isValidOrchestrationSlug("a".repeat(MAX_ORCHESTRATION_SLUG_LENGTH + 1)),
    false
  );
});

test("spec path helpers require the master spec layout", async () => {
  const { buildMasterSpecPath, isValidMasterSpecPath, isValidSpecPath } =
    await loadValidation();

  assert.equal(
    buildMasterSpecPath("git-tree-orchestration"),
    "specs/git-tree-orchestration/MASTER.md"
  );
  assert.equal(
    isValidMasterSpecPath(
      "specs/git-tree-orchestration/MASTER.md",
      "git-tree-orchestration"
    ),
    true
  );
  assert.equal(
    isValidSpecPath(
      "specs/git-tree-orchestration/tasks/1-state-machine.md",
      "git-tree-orchestration"
    ),
    true
  );
  assert.equal(
    isValidMasterSpecPath(
      "specs/other-run/MASTER.md",
      "git-tree-orchestration"
    ),
    false
  );
  assert.equal(
    isValidSpecPath(
      "specs/git-tree-orchestration/../MASTER.md",
      "git-tree-orchestration"
    ),
    false
  );
});

test("task spec paths must stay under specs/<run-slug>/tasks", async () => {
  const { buildTaskSpecPath, isValidTaskSpecPath, parseTaskSpecPath } =
    await loadValidation();

  const path = buildTaskSpecPath("git-tree-orchestration", 3, "validation");
  assert.equal(path, "specs/git-tree-orchestration/tasks/3-validation.md");
  assert.equal(
    buildTaskSpecPath("git-tree-orchestration", 0, "validation"),
    "specs/git-tree-orchestration/tasks/0-validation.md"
  );
  assert.deepEqual(parseTaskSpecPath(path, "git-tree-orchestration"), {
    orderIndex: 3,
    taskSlug: "validation",
  });
  assert.equal(
    parseTaskSpecPath(
      "specs/git-tree-orchestration/tasks/9007199254740993-validation.md",
      "git-tree-orchestration"
    ),
    null
  );
  assert.equal(
    parseTaskSpecPath(
      "specs/git-tree-orchestration/tasks/123456789012345678901-validation.md",
      "git-tree-orchestration"
    ),
    null
  );
  assert.equal(
    parseTaskSpecPath(
      `specs/git-tree-orchestration/tasks/1-${"a".repeat(65)}.md`,
      "git-tree-orchestration"
    ),
    null
  );
  assert.equal(
    isValidTaskSpecPath(path, "git-tree-orchestration", "validation"),
    true
  );
  assert.equal(
    isValidTaskSpecPath(path, "git-tree-orchestration", "state-machine"),
    false
  );
  assert.equal(
    isValidTaskSpecPath(
      "specs/git-tree-orchestration/tasks/state-machine.md",
      "git-tree-orchestration"
    ),
    false
  );
  assert.throws(() =>
    buildTaskSpecPath("git-tree-orchestration", -1, "validation")
  );
  assert.throws(() =>
    buildTaskSpecPath("git-tree-orchestration", 1.5, "validation")
  );
  assert.throws(() =>
    buildTaskSpecPath("git-tree-orchestration", 1, "Invalid-Task")
  );
  assert.throws(() => buildTaskSpecPath("Invalid-Run", 1, "validation"));
});

test("branch and root validators reuse sandbox validation rules", async () => {
  const {
    validateOrchestrationBranchName,
    validateOrchestrationRootDirectory,
  } = await loadValidation();

  assert.deepEqual(validateOrchestrationBranchName("mogplex/task/run/task"), {
    ok: true,
    value: "mogplex/task/run/task",
  });
  assert.deepEqual(validateOrchestrationBranchName("bad branch"), {
    ok: false,
    error: "Invalid branch name",
  });
  assert.deepEqual(validateOrchestrationBranchName("feature//double-slash"), {
    ok: false,
    error: "Invalid branch name",
  });

  assert.deepEqual(validateOrchestrationRootDirectory("apps//web/"), {
    ok: true,
    value: "apps/web",
  });
  assert.deepEqual(validateOrchestrationRootDirectory("."), {
    ok: true,
    value: null,
  });
  assert.deepEqual(validateOrchestrationRootDirectory(null), {
    ok: true,
    value: null,
  });
  assert.deepEqual(validateOrchestrationRootDirectory(undefined), {
    ok: true,
    value: null,
  });
  assert.deepEqual(validateOrchestrationRootDirectory("apps/../etc"), {
    ok: false,
    error: "Invalid root directory",
  });
});

test("owned path overlap helper ignores non-overlapping path claims", async () => {
  const { findOwnedPathOverlaps } = await loadValidation();

  assert.deepEqual(
    findOwnedPathOverlaps([
      { slug: "types", ownedPaths: ["lib/orchestrations/types.ts"] },
      { slug: "state", ownedPaths: ["lib/orchestrations/state-machine.ts"] },
      { slug: "tests", ownedPaths: ["tests/unit/orchestration-types.test.ts"] },
    ]),
    []
  );
});

test("owned path overlap helper rejects duplicate spec slugs", async () => {
  const { findOwnedPathOverlaps } = await loadValidation();

  assert.throws(
    () =>
      findOwnedPathOverlaps([
        { slug: "state", ownedPaths: ["lib/orchestrations"] },
        { slug: "state", ownedPaths: ["app/api/orchestrations"] },
      ]),
    /Duplicate OwnedPathClaimSpec slug: "state"/
  );
});

test("owned path overlap helper rejects invalid owned path specs", async () => {
  const { findOwnedPathOverlaps } = await loadValidation();

  assert.throws(
    () =>
      findOwnedPathOverlaps([
        { slug: "escape", ownedPaths: ["../etc/passwd"] },
        { slug: "state", ownedPaths: ["lib/orchestrations/state-machine.ts"] },
      ]),
    /Invalid owned path for "escape": "\.\.\/etc\/passwd"/
  );
  assert.throws(
    () =>
      findOwnedPathOverlaps([
        { slug: "empty", ownedPaths: [] },
        { slug: "state", ownedPaths: ["lib/orchestrations/state-machine.ts"] },
      ]),
    /OwnedPathClaimSpec "empty" must declare at least one owned path/
  );
});

test("owned path overlap helper rejects cyclic dependencies", async () => {
  const { findOwnedPathOverlaps } = await loadValidation();

  assert.throws(
    () =>
      findOwnedPathOverlaps([
        {
          slug: "foundation",
          ownedPaths: ["lib/orchestrations"],
          dependsOn: ["state"],
        },
        {
          slug: "state",
          ownedPaths: ["lib/orchestrations/state-machine.ts"],
          dependsOn: ["foundation"],
        },
      ]),
    /Cyclic OwnedPathClaimSpec dependsOn graph: "foundation" -> "state" -> "foundation"/
  );
});

test("owned path overlap helper returns independent overlapping claims", async () => {
  const { findOwnedPathOverlaps, normalizeOwnedPath } = await loadValidation();

  assert.equal(
    normalizeOwnedPath("lib/./orchestrations"),
    "lib/orchestrations"
  );
  assert.equal(
    normalizeOwnedPath("lib/orchestrations/."),
    "lib/orchestrations"
  );

  assert.deepEqual(
    findOwnedPathOverlaps([
      { slug: "foundation", ownedPaths: ["lib/orchestrations"] },
      { slug: "state", ownedPaths: ["lib/./orchestrations/state-machine.ts"] },
    ]),
    [
      {
        leftSlug: "foundation",
        rightSlug: "state",
        leftPath: "lib/orchestrations",
        rightPath: "lib/orchestrations/state-machine.ts",
      },
    ]
  );
});

test("owned path overlap helper allows overlapping dependent claims", async () => {
  const { findOwnedPathOverlaps } = await loadValidation();

  assert.deepEqual(
    findOwnedPathOverlaps([
      { slug: "foundation", ownedPaths: ["lib/orchestrations"] },
      {
        slug: "state",
        ownedPaths: ["lib/orchestrations/state-machine.ts"],
        dependsOn: ["foundation"],
      },
    ]),
    []
  );
});

test("owned path overlap helper allows overlapping transitively dependent claims", async () => {
  const { findOwnedPathOverlaps } = await loadValidation();

  assert.deepEqual(
    findOwnedPathOverlaps([
      {
        slug: "ui",
        ownedPaths: ["lib/orchestrations"],
        dependsOn: ["api"],
      },
      {
        slug: "api",
        ownedPaths: ["app/api/orchestrations"],
        dependsOn: ["schema"],
      },
      {
        slug: "schema",
        ownedPaths: ["lib/orchestrations/status.ts"],
      },
    ]),
    []
  );
});
