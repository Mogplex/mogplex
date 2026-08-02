import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUserModelPreferenceMap,
  resolveUserModelEnabledState,
} from "../../lib/models/user-preferences";

const seenAt = "2026-06-01T00:00:00.000Z";
const newModel = {
  id: "anthropic/new",
  is_available: true,
  created_at: "2026-06-15T00:00:00.000Z",
};
const oldModel = {
  id: "anthropic/old",
  is_available: true,
  created_at: "2026-05-01T00:00:00.000Z",
};

const emptyPrefs = buildUserModelPreferenceMap([]);

test("explicit preference always wins over the policy", () => {
  const prefs = buildUserModelPreferenceMap([
    { model_id: newModel.id, is_enabled: true },
  ]);
  const enabled = resolveUserModelEnabledState(newModel, prefs, {
    autoEnable: false,
    seenAt,
  });
  assert.equal(enabled, true);
});

test("missing preference defaults to is_available when no policy is given", () => {
  assert.equal(resolveUserModelEnabledState(newModel, emptyPrefs), true);
  assert.equal(
    resolveUserModelEnabledState(
      { ...newModel, is_available: false },
      emptyPrefs
    ),
    false
  );
});

test("auto-enable on never withholds a new model", () => {
  const enabled = resolveUserModelEnabledState(newModel, emptyPrefs, {
    autoEnable: true,
    seenAt,
  });
  assert.equal(enabled, true);
});

test("auto-enable off withholds a model created after the high-water mark", () => {
  const enabled = resolveUserModelEnabledState(newModel, emptyPrefs, {
    autoEnable: false,
    seenAt,
  });
  assert.equal(enabled, false);
});

test("auto-enable off leaves pre-existing models enabled", () => {
  const enabled = resolveUserModelEnabledState(oldModel, emptyPrefs, {
    autoEnable: false,
    seenAt,
  });
  assert.equal(enabled, true);
});

test("auto-enable off with a null cursor withholds every dated model", () => {
  const enabled = resolveUserModelEnabledState(oldModel, emptyPrefs, {
    autoEnable: false,
    seenAt: null,
  });
  assert.equal(enabled, false);
});

test("models without a created_at are never treated as new", () => {
  const enabled = resolveUserModelEnabledState(
    { id: "x/y", is_available: true, created_at: null },
    emptyPrefs,
    { autoEnable: false, seenAt }
  );
  assert.equal(enabled, true);
});
