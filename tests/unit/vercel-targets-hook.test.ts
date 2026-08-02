import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveFailureTargetsValidation,
  type VercelTargetsValidationState,
} from "../../hooks/use-vercel-targets";
import type { VercelLinkedProjectValidation } from "../../lib/vercel/validation";

test("resolveFailureTargetsValidation preserves server validation on failed target loads", () => {
  const serverValidation: VercelLinkedProjectValidation = {
    state: "auth_invalid",
    source: "repo",
    message:
      "Reconnect Personal Vercel to restore access to the linked billing project.",
    action: "reconnect_personal_vercel",
  };
  const validationState: VercelTargetsValidationState = {
    billingMode: "user_vercel_project",
    source: "repo",
    projectId: "prj_123",
    teamId: "team_123",
  };

  assert.equal(
    resolveFailureTargetsValidation(
      {
        error: "VERCEL_TARGETS_FORBIDDEN",
        linkedProjectValidation: serverValidation,
      },
      validationState
    ),
    serverValidation
  );
});

test("resolveFailureTargetsValidation derives a fallback when the server does not provide validation", () => {
  const validationState: VercelTargetsValidationState = {
    billingMode: "user_vercel_project",
    source: "workspace",
    projectId: "prj_workspace",
    teamId: "team_123",
  };

  assert.deepEqual(
    resolveFailureTargetsValidation(
      {
        error: "VERCEL_AUTH_INVALID",
      },
      validationState
    ),
    {
      state: "auth_invalid",
      source: "workspace",
      message:
        "Reconnect Personal Vercel to restore access to the linked billing project.",
      action: "reconnect_personal_vercel",
    }
  );
});
