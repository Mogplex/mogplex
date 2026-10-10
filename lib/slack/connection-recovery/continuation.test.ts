import { expect, it } from "vitest";
import { validateConnectionContinuation } from "./continuation";
import { buildConnectionResumePayload } from "./presentation";
import { recoveryRequest } from "./test-fixtures";

it("rechecks a queued continuation's current account, workspace, thread, and role", async () => {
  const saved = recoveryRequest();
  saved.repo_id = "00000000-0000-4000-8000-000000000004";
  const payload = buildConnectionResumePayload({
    id: saved.id,
    payload: saved.payload,
    resumeText: saved.resume_text,
    target: saved.target,
    repoId: saved.repo_id,
  });
  const input = {
    payload,
    userId: saved.user_id,
    installationId: saved.slack_installation_id,
  };
  const deps = { loadRequest: async () => saved, canRecover: async () => true };
  expect(await validateConnectionContinuation(input, deps)).toBe(true);
  expect(payload.text).toContain("Repository: acme/widgets");
  expect(
    await validateConnectionContinuation(
      {
        ...input,
        payload: { ...payload, connectionRecoveryRepository: "acme/other" },
      },
      deps
    )
  ).toBe(false);
  for (const field of [
    "teamId",
    "channelId",
    "threadTs",
    "slackUserId",
    "eventId",
    "connectionRecoveryRepoId",
  ] as const) {
    expect(
      await validateConnectionContinuation(
        { ...input, payload: { ...payload, [field]: "changed" } },
        deps
      )
    ).toBe(false);
  }
  expect(
    await validateConnectionContinuation(
      { ...input, userId: "new-account" },
      deps
    )
  ).toBe(false);
  expect(
    await validateConnectionContinuation(
      { ...input, installationId: "new-installation" },
      deps
    )
  ).toBe(false);
  expect(
    await validateConnectionContinuation(input, {
      ...deps,
      canRecover: async () => false,
    })
  ).toBe(false);
  expect(
    await validateConnectionContinuation(input, {
      ...deps,
      loadRequest: async () => null,
    })
  ).toBe(false);
  expect(
    await validateConnectionContinuation(
      { ...input, payload: saved.payload },
      deps
    )
  ).toBe(false);
});
