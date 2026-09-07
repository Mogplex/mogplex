import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeControlSessionProjects,
  controlSessionProjectName,
  defaultProjectChoice,
  deriveProjectName,
  parseControlSessionRepoId,
  repoProjectName,
  resolveControlSessionRepo,
  resolveNewSessionRepoId,
} from "../../lib/control/session-project";

test("repoProjectName uses the unambiguous full repository name", () => {
  assert.equal(repoProjectName({ full_name: "acme/widgets" }), "acme/widgets");
});

test("resolveControlSessionRepo prefers repo id and safely restores legacy names", () => {
  const repos = [
    { id: "r1", name: "widgets", full_name: "acme/widgets" },
    { id: "r2", name: "api", full_name: "acme/api" },
  ];

  assert.equal(resolveControlSessionRepo({ repo_id: "r2" }, repos)?.id, "r2");
  assert.equal(
    resolveControlSessionRepo({ project: "acme/widgets" }, repos)?.id,
    "r1"
  );
  assert.equal(
    resolveControlSessionRepo({ project: "widgets" }, repos)?.id,
    "r1"
  );
  assert.equal(
    resolveControlSessionRepo({ project: "widgets" }, [
      ...repos,
      { id: "r3", name: "widgets", full_name: "other/widgets" },
    ]),
    null
  );
});

test("controlSessionProjectName normalizes unambiguous legacy groups", () => {
  const repos = [
    { id: "r1", name: "widgets", full_name: "acme/widgets" },
    { id: "r2", name: "api", full_name: "acme/api" },
  ];

  assert.equal(
    controlSessionProjectName({ project: "widgets" }, repos),
    "acme/widgets"
  );
  assert.equal(
    controlSessionProjectName({ project: "custom-project" }, repos),
    "custom-project"
  );
  assert.equal(controlSessionProjectName({ project: "   " }, repos), null);

  const sessions = [
    { id: "legacy", project: "widgets" },
    { id: "custom", project: "custom-project" },
  ];
  assert.deepEqual(canonicalizeControlSessionProjects(sessions, repos), [
    { id: "legacy", project: "acme/widgets" },
    sessions[1],
  ]);
});

test("parseControlSessionRepoId accepts null or UUID values and rejects malformed input", () => {
  assert.deepEqual(parseControlSessionRepoId(undefined), {
    ok: true,
    value: null,
  });
  assert.deepEqual(parseControlSessionRepoId("   "), {
    ok: true,
    value: null,
  });
  assert.deepEqual(
    parseControlSessionRepoId(" 1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b "),
    {
      ok: true,
      value: "1b4f0e2a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    }
  );
  assert.deepEqual(parseControlSessionRepoId("not-a-uuid"), { ok: false });
  assert.deepEqual(parseControlSessionRepoId(123), { ok: false });
});

test("defaultProjectChoice picks favorite, then first repo, then new", () => {
  const repos = [
    { id: "r1", full_name: "acme/one" },
    { id: "r2", full_name: "acme/two", is_favorite: true },
  ];
  assert.equal(defaultProjectChoice(repos), "r2");
  assert.equal(
    defaultProjectChoice([{ id: "r1", full_name: "acme/one" }]),
    "r1"
  );
  assert.equal(defaultProjectChoice([]), "new");
});

test("deriveProjectName slugs the first five words of the mission text", () => {
  assert.equal(
    deriveProjectName("Ship the new onboarding flow today"),
    "ship-the-new-onboarding-flow"
  );
  assert.equal(deriveProjectName("Fix auth!"), "fix-auth");
  assert.equal(deriveProjectName("   "), "new-project");
  assert.equal(deriveProjectName(""), "new-project");
  assert.ok(deriveProjectName("a".repeat(200)).length <= 48);
});

test("resolveNewSessionRepoId keeps the current project when New carries no target", () => {
  const repos = [
    { id: "r1", name: "cli", full_name: "acme/cli", is_favorite: true },
    { id: "r2", name: "widgets", full_name: "acme/widgets" },
  ];
  const activeSession = { repo_id: "r2", project: "acme/widgets" };

  // Header "+" / collapsed "+": no target, so the open session's repo wins.
  assert.equal(resolveNewSessionRepoId(null, activeSession, repos), "r2");
  // Nothing open: let the composer apply its own default.
  assert.equal(resolveNewSessionRepoId(null, null, repos), null);
});

test("resolveNewSessionRepoId resolves a project group by id or by name", () => {
  const repos = [
    { id: "r1", name: "cli", full_name: "acme/cli", is_favorite: true },
    { id: "r2", name: "widgets", full_name: "acme/widgets" },
  ];
  const activeSession = { repo_id: "r1", project: "acme/cli" };

  assert.equal(
    resolveNewSessionRepoId(
      { project: "acme/widgets", repoId: "r2" },
      activeSession,
      repos
    ),
    "r2"
  );
  // Legacy groups only know the project name.
  assert.equal(
    resolveNewSessionRepoId(
      { project: "acme/widgets", repoId: null },
      activeSession,
      repos
    ),
    "r2"
  );
  // A repo id that no longer exists must not leak into the picker.
  assert.equal(
    resolveNewSessionRepoId(
      { project: "acme/widgets", repoId: "gone" },
      activeSession,
      repos
    ),
    "r2"
  );
  // The General group has no repo: an explicit target never inherits the
  // open session's project.
  assert.equal(
    resolveNewSessionRepoId(
      { project: null, repoId: null },
      activeSession,
      repos
    ),
    null
  );
});
