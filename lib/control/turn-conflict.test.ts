import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CONTROL_TURN_RUNNING_MESSAGE,
  isControlTurnConflict,
} from "./turn-conflict";
import { AiCallPersistenceError } from "../interactive-runs";

test("only the Control conversation constraint is reported as a turn conflict", () => {
  assert.equal(
    isControlTurnConflict(
      new AiCallPersistenceError(CONTROL_TURN_RUNNING_MESSAGE, "23505")
    ),
    true
  );
  assert.equal(
    isControlTurnConflict(
      new AiCallPersistenceError(
        'duplicate key value violates unique constraint "control_conversation_active_turn"',
        "23505"
      )
    ),
    true
  );
  assert.equal(
    isControlTurnConflict(
      new AiCallPersistenceError(
        'duplicate key value violates unique constraint "other_constraint"',
        "23505"
      )
    ),
    false
  );
  assert.equal(
    isControlTurnConflict(
      new AiCallPersistenceError(CONTROL_TURN_RUNNING_MESSAGE, "42501")
    ),
    false
  );
  assert.equal(
    isControlTurnConflict(new Error(CONTROL_TURN_RUNNING_MESSAGE)),
    false
  );
});
