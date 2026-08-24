import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxName,
  buildSandboxReplacementName,
} from "../../lib/sandbox/sandbox-name";

test("buildSandboxName produces the mogplex-{repo}-{branch} shape (no userId)", () => {
  const name = buildSandboxName({
    repoId: "01234567-89ab-cdef-0123-456789abcdef",
    workingBranch: "main",
  });
  assert.equal(name, "mogplex-012345-main-root");
});

test("buildSandboxName includes a userId slug when provided", () => {
  const name = buildSandboxName({
    repoId: "01234567-89ab-cdef-0123-456789abcdef",
    workingBranch: "main",
    userId: "abcdef12-3456-7890-abcd-ef1234567890",
  });
  assert.equal(name, "mogplex-abcdef-012345-main-root");
});

test("buildSandboxName includes active team context when provided", () => {
  const personal = buildSandboxName({
    repoId: "01234567-89ab-cdef-0123-456789abcdef",
    workingBranch: "main",
    userId: "abcdef12-3456-7890-abcd-ef1234567890",
  });
  const team = buildSandboxName({
    repoId: "01234567-89ab-cdef-0123-456789abcdef",
    workingBranch: "main",
    userId: "abcdef12-3456-7890-abcd-ef1234567890",
    productTeamId: "fedcba98-7654-3210-fedc-ba9876543210",
  });

  assert.equal(personal, "mogplex-abcdef-012345-main-root");
  assert.equal(team, "mogplex-abcdef-tfedcba-012345-main-root");
  assert.notEqual(personal, team);
});

test("buildSandboxName is stable per (user, team, repo, branch, rootDirectory) — same name across calls", () => {
  const args = {
    repoId: "repo-id",
    workingBranch: "feat/x",
    userId: "user-id",
    productTeamId: "team-id",
    rootDirectory: "apps/web",
  };
  assert.equal(buildSandboxName(args), buildSandboxName(args));
});

test("buildSandboxName separates same repo and branch launches by rootDirectory", () => {
  const root = buildSandboxName({
    repoId: "repo-id",
    workingBranch: "main",
    userId: "user-id",
    rootDirectory: null,
  });
  const app = buildSandboxName({
    repoId: "repo-id",
    workingBranch: "main",
    userId: "user-id",
    rootDirectory: "apps/web",
  });

  assert.equal(root, "mogplex-userid-repoid-main-root");
  assert.equal(app, "mogplex-userid-repoid-main-apps-web");
  assert.notEqual(root, app);
});

test("buildSandboxName ignores the optional recordId parameter", () => {
  const withoutRecord = buildSandboxName({
    repoId: "repo-id",
    workingBranch: "main",
    userId: "user-id",
  });
  const withRecord = buildSandboxName({
    repoId: "repo-id",
    workingBranch: "main",
    userId: "user-id",
    recordId: "fresh-record",
  });
  assert.equal(withoutRecord, withRecord);
});

test("buildSandboxName sanitizes slashes, underscores and uppercase in branch names", () => {
  const name = buildSandboxName({
    repoId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    workingBranch: "Feat/Big_Refactor",
  });
  assert.equal(name, "mogplex-aaaaaa-feat-big-refactor-root");
});

test("buildSandboxName truncates very long branch names without exceeding 60 chars", () => {
  const name = buildSandboxName({
    repoId: "aaaaaaaaaaaa",
    workingBranch: "release/".repeat(20),
  });
  assert.ok(name.length <= 60, `expected <=60 chars, got ${name.length}`);
  assert.ok(name.startsWith("mogplex-"));
});

test("buildSandboxName keeps long branch and rootDirectory segments represented", () => {
  const name = buildSandboxName({
    repoId: "aaaaaaaaaaaa",
    workingBranch: "feature/super-long-branch-name-that-needs-truncation",
    rootDirectory: "packages/super-long-root-directory-that-needs-truncation",
  });

  assert.ok(name.length <= 60, `expected <=60 chars, got ${name.length}`);
  assert.match(name, /feature/);
  assert.match(name, /packages/);
  const segments = name.split("-");
  assert.ok(
    segments[segments.length - 2],
    "expected branch segment to remain present"
  );
  assert.ok(
    segments[segments.length - 1],
    "expected root segment to remain present"
  );
});

test("buildSandboxName falls back to sensible defaults when inputs are empty", () => {
  const name = buildSandboxName({
    repoId: "",
    workingBranch: null,
  });
  assert.equal(name, "mogplex-repo-main-root");
});

test("buildSandboxName output matches the regex [a-z0-9-]+", () => {
  const name = buildSandboxName({
    repoId: "01234567-89ab-cdef-0123-456789abcdef",
    workingBranch: "weird branch @#$ name!",
    userId: "99999999-8888-7777-6666-555555555555",
  });
  assert.match(name, /^[a-z0-9-]+$/);
});

test("buildSandboxReplacementName is stable, distinct, and bounded", () => {
  const stableName = buildSandboxName({
    repoId: "aaaaaaaaaaaa",
    workingBranch: "feature/super-long-branch-name-that-needs-truncation",
    rootDirectory: "packages/super-long-root-directory-that-needs-truncation",
  });
  const replacement = buildSandboxReplacementName(
    stableName,
    "12345678-aaaa-bbbb-cccc-dddddddddddd"
  );

  assert.equal(
    replacement,
    buildSandboxReplacementName(
      stableName,
      "12345678-aaaa-bbbb-cccc-dddddddddddd"
    )
  );
  assert.notEqual(replacement, stableName);
  assert.ok(replacement.length <= 60);
  assert.match(replacement, /-12345678$/);
});
