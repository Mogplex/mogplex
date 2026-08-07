import assert from "node:assert/strict";
import test from "node:test";
import {
  getRunActionDescriptors,
  getRunActionEmptyState,
} from "../../lib/flows/run-presentation";
import { runActionScenarios } from "./helpers/flow-run-presentation-fixtures";

for (const scenario of runActionScenarios) {
  test(scenario.name, () => {
    assert.deepEqual(getRunActionDescriptors(scenario.run), scenario.expected);

    if (scenario.emptyState) {
      assert.equal(getRunActionEmptyState(scenario.run), scenario.emptyState);
    }
  });
}
