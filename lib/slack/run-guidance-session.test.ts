import { expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { createRunGuidanceSession } from "./run-guidance-session";
import type { RunGuidance } from "./run-guidance-store";
import { buildRunRow } from "../../tests/unit/helpers/mogplex-api-runs-fixtures";
import { buildNativeRunMessages } from "@/lib/mogplex-api/native-run-context";
import { guidanceReceiptText } from "./run-guidance-presentation";

const run = buildRunRow({ harness: "mogplex" });
const row = (id: string, body: string): RunGuidance => ({
  id,
  body,
  run_id: run.id,
  user_id: run.user_id,
  ai_call_id: run.ai_call_id,
  status: "received",
  delivered_step: null,
  attachments: null,
  created_at: new Date(0).toISOString(),
});
const initial: ModelMessage[] = [
  { role: "user", content: "Fix the mobile header." },
];
const assistant: ModelMessage = {
  role: "assistant",
  content: "I inspected the layout.",
};

it("supplies guidance at the next step and retains it at the same transcript position without duplicates", async () => {
  let rows: RunGuidance[] = [];
  const receipts: string[] = [];
  const session = createRunGuidanceSession(run, {
    load: async () => rows,
    deliver: async (input) => {
      receipts.push(...input.ids);
      rows = rows.map((row) => ({
        ...row,
        status: "delivered",
        delivered_step: input.step,
      }));
      return input.ids.length;
    },
    queue: async () => {},
  });
  expect(await session.prepare(initial, 0)).toBe(initial);
  rows = [row("g1", "Keep desktop unchanged.")];
  expect(receipts).toEqual([]);
  const first = await session.prepare([...initial, assistant], 1);
  expect(first).toHaveLength(3);
  expect(JSON.stringify(first[2])).toContain("Keep desktop unchanged.");
  expect(receipts).toEqual([]);
  await session.stepFinished();
  expect(receipts).toEqual(["g1"]);
  const second = await session.prepare(
    [
      ...initial,
      assistant,
      { role: "assistant", content: "Checking desktop." },
    ],
    2
  );
  expect(second).toHaveLength(4);
  expect(second[2]).toEqual(first[2]);
  expect(second[3]).toEqual({
    role: "assistant",
    content: "Checking desktop.",
  });
  await session.stepFinished();
  expect(receipts).toEqual(["g1"]);
});

it("retains previously delivered guidance when a worker reconstructs its context", async () => {
  const session = createRunGuidanceSession(run, {
    load: async () => [
      { ...row("g1", "No merge."), status: "delivered", delivered_step: 1 },
    ],
    deliver: async () => {
      throw new Error("Already acknowledged");
    },
    queue: async () => {},
  });
  expect(JSON.stringify(await session.prepare(initial, 0))).toContain(
    "No merge."
  );
  await session.stepFinished();
});

it("does not claim delivery when the model step or receipt write fails", async () => {
  let markCalls = 0;
  const session = createRunGuidanceSession(run, {
    load: async () => [row("g1", "No merge.")],
    deliver: async () => {
      markCalls++;
      throw new Error("Database unavailable");
    },
    queue: async () => {},
  });
  await session.prepare(initial, 0);
  expect(markCalls).toBe(0);
  await expect(session.stepFinished()).rejects.toThrow("Database unavailable");
  expect(markCalls).toBe(1);
  expect(
    guidanceReceiptText([{ ...row("g1", "No merge."), status: "not_applied" }])
  ).toContain("Delivery not confirmed");
});

it("preserves image guidance through the actual attachment and model-message conversion", async () => {
  const guidance = {
    ...row("g1", "Use this layout."),
    attachments: {
      teamId: "T1",
      files: [
        {
          id: "F1",
          mimetype: "image/png",
          urlPrivateDownload:
            "https://files.slack.com/files-pri/T1-F1/image.png",
        },
      ],
    },
  };
  const session = createRunGuidanceSession(run, {
    load: async () => [guidance],
    buildMessages: (input) =>
      buildNativeRunMessages(input, {
        getToken: async () => "test-bot",
        fetch: async (input, options) => {
          expect(String(input)).toContain("files.slack.com/files-pri/");
          expect(options?.redirect).toBe("error");
          return new Response(new Uint8Array([137, 80, 78, 71]), {
            headers: { "content-type": "image/png" },
          });
        },
      }),
    queue: async () => {},
  });
  const prepared = await session.prepare(initial, 0);
  expect(JSON.stringify(prepared)).toContain("Use this layout.");
  expect(prepared[1]).toMatchObject({
    role: "user",
    content: [
      { type: "text" },
      {
        type: "file",
        mediaType: "image/png",
        data: "data:image/png;base64,iVBORw==",
      },
    ],
  });
  expect(JSON.stringify(prepared)).not.toContain("test-bot");
});
