import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CONTROL_SESSION_MODEL_ID_LENGTH,
  parseControlSessionModelId,
} from "../../lib/control/session-model";

test("parseControlSessionModelId normalizes an optional model id", () => {
  assert.deepEqual(parseControlSessionModelId(null), { ok: true, value: null });
  assert.deepEqual(parseControlSessionModelId(" zai/glm-5.3-flash "), {
    ok: true,
    value: "zai/glm-5.3-flash",
  });
});

test("parseControlSessionModelId rejects empty, oversized, and non-string values", () => {
  assert.deepEqual(parseControlSessionModelId("  "), { ok: false });
  assert.deepEqual(
    parseControlSessionModelId(
      "m".repeat(MAX_CONTROL_SESSION_MODEL_ID_LENGTH + 1)
    ),
    { ok: false }
  );
  assert.deepEqual(parseControlSessionModelId(42), { ok: false });
});
