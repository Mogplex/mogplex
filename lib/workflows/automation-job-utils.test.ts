import { expect, it } from "vitest";
import { normalizeAutomationAssignmentType } from "./automation-job-utils";
import { isAiCallType } from "@/lib/ai-call-types";

it.each([
  ["schedule", "cron"],
  ["pr_opened", "pr_review"],
  ["issue_opened", "issue_triage"],
  ["push", "push_review"],
  ["dependabot_alert", "dependabot_alert"],
])(
  "maps Flow source %s to the supported execution and usage type %s",
  (source, type) => {
    expect(normalizeAutomationAssignmentType(source)).toBe(type);
    expect(isAiCallType(normalizeAutomationAssignmentType(source))).toBe(true);
  }
);
