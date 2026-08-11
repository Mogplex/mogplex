import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultProjectChoice,
  deriveProjectName,
  repoProjectName,
} from "../../lib/control/session-project";

test("repoProjectName prefers the short repo name", () => {
  assert.equal(
    repoProjectName({ name: "widgets", full_name: "acme/widgets" }),
    "widgets"
  );
  assert.equal(repoProjectName({ full_name: "acme/widgets" }), "acme/widgets");
  assert.equal(
    repoProjectName({ name: "  ", full_name: "acme/widgets" }),
    "acme/widgets"
  );
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
