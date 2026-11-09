import { describe, expect, it } from "vitest";
import {
  AWAIT_EVENT_KINDS,
  AWAIT_TIMEOUT_UNITS,
  CONDITION_OPERATORS,
  TRANSFORM_OPERATIONS,
  TRIGGER_EVENTS,
} from "./assistant-tools-constants";
import { CONDITION_OPERATORS as RUNTIME_CONDITION_OPERATORS } from "./graph-helpers";
import { ACTION_OPERATIONS, FLOW_NODE_TYPES } from "./capabilities";

describe("flow capability contract", () => {
  it("shares assistant and runtime lists by identity", () => {
    expect(CONDITION_OPERATORS).toBe(RUNTIME_CONDITION_OPERATORS);
    expect(AWAIT_EVENT_KINDS).toEqual([
      "github_label_added",
      "github_comment_added",
      "ci_workflow_completed",
      "vercel_preview_ready",
      "manual_approval",
    ]);
    expect(AWAIT_TIMEOUT_UNITS).toEqual(["minutes", "hours", "days"]);
    expect(TRANSFORM_OPERATIONS).toContain("files_match_glob");
    expect(TRIGGER_EVENTS).toContain("api");
  });

  it("covers every public node and action operation", () => {
    expect(FLOW_NODE_TYPES).toHaveLength(12);
    expect(ACTION_OPERATIONS).toHaveLength(8);
  });
});
