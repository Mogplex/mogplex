import assert from "node:assert/strict";
import test from "node:test";
import { normalizeControlChatMessages } from "../../app/api/control/chat/_lib/messages";
import { buildOrchestratorSystemPrompt } from "../../lib/agents/orchestrator/system-prompt";

test("control chat normalization preserves AI SDK file parts", () => {
  const [message] = normalizeControlChatMessages([
    {
      role: "user",
      parts: [
        { type: "text", text: "Review this plan" },
        {
          type: "file",
          filename: "plan.txt",
          mediaType: "text/plain",
          url: "data:text/plain;base64,cGxhbg==",
        },
      ],
    },
  ]);

  assert.equal(message?.role, "user");
  assert.deepEqual(message?.parts, [
    { type: "text", text: "Review this plan" },
    {
      type: "file",
      filename: "plan.txt",
      mediaType: "text/plain",
      url: "data:text/plain;base64,cGxhbg==",
    },
  ]);
});

test("control chat normalization accepts legacy string content", () => {
  const [message] = normalizeControlChatMessages([
    { role: "user", content: "Create a release plan" },
  ]);

  assert.deepEqual(message?.parts, [
    { type: "text", text: "Create a release plan" },
  ]);
});

test("control chat normalization rejects malformed message shapes", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        null as unknown as Parameters<
          typeof normalizeControlChatMessages
        >[0][0],
      ]),
    /Invalid control chat message/
  );

  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          content: { type: "file" } as unknown as [],
        },
      ]),
    /Invalid control chat message/
  );
});

test("control chat normalization rejects invalid file parts", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              filename: "empty.txt",
              mediaType: "text/plain",
              url: "",
            },
          ],
        },
      ]),
    /Invalid control chat file attachment/
  );

  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              filename: "large.txt",
              mediaType: "text/plain",
              url: `data:text/plain;base64,${"a".repeat(5_600_001)}`,
            },
          ],
        },
      ]),
    /exceeds the size limit/
  );
});

test("control chat normalization rejects remote file URLs", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: [
            {
              type: "file",
              filename: "remote.txt",
              mediaType: "text/plain",
              url: "https://example.com/remote.txt",
            },
          ],
        },
      ]),
    /must be uploaded as data URLs/
  );
});

test("control chat normalization caps file parts per request", () => {
  assert.throws(
    () =>
      normalizeControlChatMessages([
        {
          role: "user",
          parts: Array.from({ length: 6 }, (_, index) => ({
            type: "file" as const,
            filename: `attachment-${index}.txt`,
            mediaType: "text/plain",
            url: "data:text/plain;base64,cGxhbg==",
          })),
        },
      ]),
    /supports up to 5 file attachments/
  );
});

test("control chat normalization allows capped file parts across message history", () => {
  const messages = normalizeControlChatMessages([
    {
      role: "user",
      parts: Array.from({ length: 3 }, (_, index) => ({
        type: "file" as const,
        filename: `prior-${index}.txt`,
        mediaType: "text/plain",
        url: "data:text/plain;base64,cGxhbg==",
      })),
    },
    {
      role: "user",
      parts: Array.from({ length: 3 }, (_, index) => ({
        type: "file" as const,
        filename: `current-${index}.txt`,
        mediaType: "text/plain",
        url: "data:text/plain;base64,cGxhbg==",
      })),
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.parts.length, 3);
  assert.equal(messages[1]?.parts.length, 3);
});

test("plan mode adds explicit non-mutation intent to the orchestrator prompt", () => {
  const prompt = buildOrchestratorSystemPrompt({
    repoFullName: "acme/demo",
    missionId: "mission-1",
    missionTitle: "Fix onboarding",
    controlMode: "plan",
    controlScope: "PLAN ONLY",
    controlTarget: "mission",
    controlPermissions: "Ask First",
  });

  assert.match(prompt, /<control-intent>/);
  assert.match(prompt, /Mode: plan/);
  assert.match(prompt, /Scope: PLAN ONLY/);
  assert.match(prompt, /Target: mission/);
  assert.match(prompt, /Permissions: Ask First/);
  assert.match(prompt, /planning only/);
  assert.match(prompt, /do not spawn workers or mutate repository files/);
});
