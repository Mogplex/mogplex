import assert from "node:assert/strict";
import test from "node:test";
import {
  controlSessionProjectName,
  defaultProjectChoice,
  deriveProjectName,
  parseControlSessionRepoId,
  repoProjectName,
  resolveControlSessionRepo,
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
