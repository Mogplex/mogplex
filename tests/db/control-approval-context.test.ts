import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { controlTranscriptDatabase } from "../support/control-transcript-database";
import { restoreControlApprovalContext } from "@/app/api/control/chat/_lib/approval-context";

const decisions: UIMessage[] = [
  {
    id: "saved-approval",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "open_pr",
        toolCallId: "open-pr",
        input: {},
        state: "approval-responded",
        approval: { id: "approve-pr", approved: true },
      },
    ],
  },
];

it("restores the owned turn context after reload without trusting composer defaults", async () => {
  const f = await controlTranscriptDatabase();
  try {
    await f.db.exec(
      "create table ai_calls(id uuid primary key, user_id uuid, metadata jsonb)"
    );
    await f.db.exec(
      await readFile(
        new URL(
          "../../neon/migrations/20261011134900_control_durable_turns.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const callId = randomUUID();
    const teamId = randomUUID();
    const saved = {
      conversationId: f.sessionId,
      missionId: f.sessionId,
      repoId: randomUUID(),
      sandboxId: randomUUID(),
      mode: "run",
      permissions: "Approve Edits",
      model: "saved-model",
      scope: "repository",
      target: "saved-target",
      messages: [],
    };
    await f.db.query(
      "insert into ai_calls(id,user_id,metadata) values($1,$2,$3)",
      [
        callId,
        f.owner,
        JSON.stringify({ sandbox_id: "workspace-selected-by-tool" }),
      ]
    );
    await f.db.query(
      "insert into control_turns(ai_call_id,user_id,session_id,team_id,request_context) values($1,$2,$3,$4,$5)",
      [callId, f.owner, f.sessionId, teamId, JSON.stringify(saved)]
    );
    const submitted = {
      conversationId: f.sessionId,
      messages: decisions,
      mode: "plan" as const,
      permissions: "Skip Permissions" as const,
      sandboxId: "wrong-workspace",
    };
    expect(
      await restoreControlApprovalContext(
        f.owner,
        submitted,
        decisions,
        teamId,
        f.client
      )
    ).toEqual({
      ...saved,
      sandboxId: "workspace-selected-by-tool",
      messages: decisions,
    });
    await expect(
      restoreControlApprovalContext(
        randomUUID(),
        submitted,
        decisions,
        teamId,
        f.client
      )
    ).rejects.toThrow("unavailable");
    await expect(
      restoreControlApprovalContext(
        f.owner,
        submitted,
        decisions,
        null,
        f.client
      )
    ).rejects.toThrow("unavailable");
    await expect(
      restoreControlApprovalContext(
        f.owner,
        { ...submitted, conversationId: null },
        decisions,
        teamId,
        f.client
      )
    ).rejects.toThrow("saved Control conversation");
    const followup: UIMessage[] = [
      {
        id: "next",
        role: "user",
        parts: [{ type: "text", text: "New instruction" }],
      },
    ];
    expect(
      await restoreControlApprovalContext(
        f.owner,
        submitted,
        followup,
        teamId,
        f.client
      )
    ).toBe(submitted);
  } finally {
    await f.db.close();
  }
});
