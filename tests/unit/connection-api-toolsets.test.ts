import assert from "node:assert/strict";
import test from "node:test";
import {
  countConnectionApiTools,
  getConnectionApiToolset,
} from "../../lib/connections/api-toolsets";

test("should build the Trigger.dev toolset when the connection came from that preset", () => {
  const build = getConnectionApiToolset({ source_preset: "trigger" });

  assert.ok(build);
  assert.ok("list_runs" in build("tr_pat_abc"));
  assert.equal(countConnectionApiTools({ source_preset: "trigger" }), 60);
});

test("should have no API toolset when the preset is remote-only, unknown, or absent", () => {
  for (const source_preset of ["linear", "not-a-preset", null]) {
    assert.equal(getConnectionApiToolset({ source_preset }), null);
    assert.equal(countConnectionApiTools({ source_preset }), null);
  }
});
