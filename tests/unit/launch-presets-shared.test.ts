import assert from "node:assert/strict";
import test from "node:test";

async function loadLaunchPresetsShared() {
  // Browser-safe module — no env-var setup needed. The validator
  // doesn't import supabaseAdmin so loading it doesn't trigger the
  // service-role-key requirement.
  return import("../../lib/launch-presets/shared");
}

test("normalizeSandboxLaunchPresetInput accepts a well-formed monorepo preset", async () => {
  const { normalizeSandboxLaunchPresetInput } = await loadLaunchPresetsShared();

  const result = normalizeSandboxLaunchPresetInput({
    name: "apps/web on staging",
    rootDirectory: "apps/web",
    baseBranch: "main",
    workingBranch: "staging",
    createBranch: false,
  });

  assert.deepEqual(result, {
    name: "apps/web on staging",
    rootDirectory: "apps/web",
    baseBranch: "main",
    workingBranch: "staging",
    createBranch: false,
  });
});

test("normalizeSandboxLaunchPresetInput collapses an explicit-null root_directory through unchanged", async () => {
  const { normalizeSandboxLaunchPresetInput } = await loadLaunchPresetsShared();

  const result = normalizeSandboxLaunchPresetInput({
    name: "Repo root",
    rootDirectory: null,
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
  });

  assert.equal(result.rootDirectory, null);
});

test("normalizeSandboxLaunchPresetInput collapses undefined root_directory to null (preset DB cannot represent 'undefined')", async () => {
  const { normalizeSandboxLaunchPresetInput } = await loadLaunchPresetsShared();

  const result = normalizeSandboxLaunchPresetInput({
    name: "default",
    // rootDirectory deliberately omitted
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
  });

  assert.equal(result.rootDirectory, null);
});

test("normalizeSandboxLaunchPresetInput trims and length-caps the name", async () => {
  const {
    normalizeSandboxLaunchPresetInput,
    SANDBOX_LAUNCH_PRESET_MAX_NAME_LENGTH,
  } = await loadLaunchPresetsShared();

  const longName =
    "  " + "x".repeat(SANDBOX_LAUNCH_PRESET_MAX_NAME_LENGTH + 50) + "  ";
  const result = normalizeSandboxLaunchPresetInput({
    name: longName,
    rootDirectory: null,
    baseBranch: "main",
    workingBranch: "main",
    createBranch: false,
  });

  assert.equal(result.name.length, SANDBOX_LAUNCH_PRESET_MAX_NAME_LENGTH);
  assert.equal(result.name.startsWith("x"), true);
});

test("normalizeSandboxLaunchPresetInput rejects an empty name", async () => {
  const {
    normalizeSandboxLaunchPresetInput,
    SandboxLaunchPresetValidationError,
  } = await loadLaunchPresetsShared();

  assert.throws(
    () =>
      normalizeSandboxLaunchPresetInput({
        name: "   ",
        rootDirectory: null,
        baseBranch: "main",
        workingBranch: "main",
        createBranch: false,
      }),
    (err: unknown) => {
      assert.ok(err instanceof SandboxLaunchPresetValidationError);
      assert.equal((err as { field: string }).field, "name");
      return true;
    }
  );
});

test("normalizeSandboxLaunchPresetInput rejects an invalid working branch", async () => {
  const {
    normalizeSandboxLaunchPresetInput,
    SandboxLaunchPresetValidationError,
  } = await loadLaunchPresetsShared();

  assert.throws(
    () =>
      normalizeSandboxLaunchPresetInput({
        name: "bad-branch",
        rootDirectory: null,
        baseBranch: "main",
        workingBranch: "has spaces",
        createBranch: true,
      }),
    SandboxLaunchPresetValidationError
  );
});

test("normalizeSandboxLaunchPresetInput rejects create-branch with working === base", async () => {
  const {
    normalizeSandboxLaunchPresetInput,
    SandboxLaunchPresetValidationError,
  } = await loadLaunchPresetsShared();

  assert.throws(
    () =>
      normalizeSandboxLaunchPresetInput({
        name: "same-branch",
        rootDirectory: null,
        baseBranch: "main",
        workingBranch: "main",
        createBranch: true,
      }),
    (err: unknown) => {
      assert.ok(err instanceof SandboxLaunchPresetValidationError);
      assert.equal((err as { field: string }).field, "workingBranch");
      return true;
    }
  );
});

test("normalizeSandboxLaunchPresetInput rejects parent-traversal in root_directory", async () => {
  const {
    normalizeSandboxLaunchPresetInput,
    SandboxLaunchPresetValidationError,
  } = await loadLaunchPresetsShared();

  assert.throws(
    () =>
      normalizeSandboxLaunchPresetInput({
        name: "evil",
        rootDirectory: "apps/../etc",
        baseBranch: "main",
        workingBranch: "feat/x",
        createBranch: true,
      }),
    SandboxLaunchPresetValidationError
  );
});

test("normalizeSandboxLaunchPresetInput normalizes a relative path with trailing slash", async () => {
  const { normalizeSandboxLaunchPresetInput } = await loadLaunchPresetsShared();

  const result = normalizeSandboxLaunchPresetInput({
    name: "trailing",
    rootDirectory: "apps/web/",
    baseBranch: "main",
    workingBranch: "feat/x",
    createBranch: true,
  });

  assert.equal(result.rootDirectory, "apps/web");
});

test("shouldRejectAtCap: brand-new name at capacity is rejected", async () => {
  const { shouldRejectAtCap, SANDBOX_LAUNCH_PRESET_MAX_PER_REPO } =
    await loadLaunchPresetsShared();
  const existingPresetNames = Array.from(
    { length: SANDBOX_LAUNCH_PRESET_MAX_PER_REPO },
    (_, i) => `existing-${i}`
  );
  assert.equal(
    shouldRejectAtCap({ newName: "brand-new", existingPresetNames }),
    true
  );
});

test("shouldRejectAtCap: overwrite of existing name at capacity is allowed", async () => {
  // Closes the long-standing PR #306 advisory: pin the cap-exempt
  // overwrite path so a regression to "always reject at capacity"
  // can't ship without breaking this test. Users at 25 presets must
  // still be able to overwrite by name.
  const { shouldRejectAtCap, SANDBOX_LAUNCH_PRESET_MAX_PER_REPO } =
    await loadLaunchPresetsShared();
  const existingPresetNames = Array.from(
    { length: SANDBOX_LAUNCH_PRESET_MAX_PER_REPO },
    (_, i) => `existing-${i}`
  );
  assert.equal(
    shouldRejectAtCap({
      newName: "existing-0",
      existingPresetNames,
    }),
    false
  );
});

test("shouldRejectAtCap: brand-new name below capacity is allowed", async () => {
  const { shouldRejectAtCap } = await loadLaunchPresetsShared();
  assert.equal(
    shouldRejectAtCap({
      newName: "brand-new",
      existingPresetNames: ["one", "two"],
    }),
    false
  );
});

test("shouldRejectAtCap: cap argument overrides the default for testing tighter limits", async () => {
  const { shouldRejectAtCap } = await loadLaunchPresetsShared();
  assert.equal(
    shouldRejectAtCap({
      newName: "brand-new",
      existingPresetNames: ["a", "b"],
      cap: 2,
    }),
    true
  );
});
