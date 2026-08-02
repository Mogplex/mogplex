import assert from "node:assert/strict";
import test from "node:test";

async function loadValidationHelpers() {
  return import("../../lib/vercel/validation");
}

test("deriveVercelLinkedProjectValidation returns missing_project when user billing has no linked project", async () => {
  const { deriveVercelLinkedProjectValidation } = await loadValidationHelpers();

  assert.deepEqual(
    deriveVercelLinkedProjectValidation({
      billingMode: "user_vercel_project",
      source: "workspace",
      projectId: null,
      personalState: "linked",
      access: null,
    }),
    {
      state: "missing_project",
      source: "workspace",
      message:
        "Select or create a workspace-linked Vercel project to keep user-billed sandbox launch working.",
      action: "select_project",
    }
  );
});

test("deriveVercelLinkedProjectValidation distinguishes link vs reconnect states", async () => {
  const { deriveVercelLinkedProjectValidation } = await loadValidationHelpers();

  assert.deepEqual(
    deriveVercelLinkedProjectValidation({
      billingMode: "user_vercel_project",
      source: "repo",
      projectId: "prj_repo",
      personalState: "not_linked",
      access: null,
    }),
    {
      state: "auth_invalid",
      source: "repo",
      message:
        "Link Personal Vercel to keep using your own Vercel project for sandbox billing.",
      action: "link_personal_vercel",
    }
  );

  assert.deepEqual(
    deriveVercelLinkedProjectValidation({
      billingMode: "user_vercel_project",
      source: "repo",
      projectId: "prj_repo",
      personalState: "linked",
      access: { ok: false, code: "AUTH_INVALID" },
    }),
    {
      state: "auth_invalid",
      source: "repo",
      message:
        "Reconnect Personal Vercel to restore access to the linked billing project.",
      action: "reconnect_personal_vercel",
    }
  );
});

test("deriveVercelLinkedProjectValidation reports source-specific inaccessible states", async () => {
  const { deriveVercelLinkedProjectValidation } = await loadValidationHelpers();

  assert.deepEqual(
    deriveVercelLinkedProjectValidation({
      billingMode: "user_vercel_project",
      source: "workspace",
      projectId: "prj_workspace",
      personalState: "linked",
      access: { ok: false, code: "PROJECT_NOT_FOUND" },
    }),
    {
      state: "inaccessible",
      source: "workspace",
      message:
        "The workspace-linked Vercel project is missing or inaccessible. Review the workspace billing project or choose a repo-linked project here instead.",
      action: "review_workspace_settings",
    }
  );

  assert.deepEqual(
    deriveVercelLinkedProjectValidation({
      billingMode: "user_vercel_project",
      source: "repo",
      projectId: "prj_repo",
      personalState: "linked",
      access: { ok: true },
    }),
    {
      state: "valid",
      source: "repo",
      message:
        "repo-linked Vercel project is reachable and ready for user-billed sandbox launch.",
      action: null,
    }
  );
});

test("deriveVercelLinkedProjectValidation reports account-default source on access failures", async () => {
  const { deriveVercelLinkedProjectValidation } = await loadValidationHelpers();

  const validation = deriveVercelLinkedProjectValidation({
    billingMode: "user_vercel_project",
    source: "account",
    projectId: "prj_account",
    personalState: "linked",
    access: { ok: false, code: "PROJECT_NOT_FOUND" },
  });

  assert.equal(validation?.state, "inaccessible");
  assert.equal(validation?.source, "account");
});

test("deriveVercelLinkedProjectValidation ignores transient access failures", async () => {
  const { deriveVercelLinkedProjectValidation } = await loadValidationHelpers();

  assert.equal(
    deriveVercelLinkedProjectValidation({
      billingMode: "user_vercel_project",
      source: "repo",
      projectId: "prj_repo",
      personalState: "linked",
      access: { ok: false, code: "RATE_LIMITED" },
    }),
    null
  );
});

test("derivePersistedVercelLinkedProjectValidation maps stored auth and accessibility states", async () => {
  const { derivePersistedVercelLinkedProjectValidation } =
    await loadValidationHelpers();

  assert.deepEqual(
    derivePersistedVercelLinkedProjectValidation({
      status: "auth_invalid",
      source: "workspace",
      message: null,
      errorCode: "PERSONAL_VERCEL_NOT_LINKED",
    }),
    {
      state: "auth_invalid",
      source: "workspace",
      message:
        "Link Personal Vercel to keep using your own Vercel project for sandbox billing.",
      action: "link_personal_vercel",
    }
  );

  assert.deepEqual(
    derivePersistedVercelLinkedProjectValidation({
      status: "inaccessible",
      source: "repo",
      message: null,
      errorCode: "PROJECT_NOT_FOUND",
    }),
    {
      state: "inaccessible",
      source: "repo",
      message:
        "The repo-linked Vercel project is missing or inaccessible. Select or create a different project to restore user-billed sandbox launch.",
      action: "select_project",
    }
  );
});
