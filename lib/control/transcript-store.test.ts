import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { saveControlTranscript } from "./transcript-store";

it("handles database conflicts, missing sessions and network failures without exposing diagnostics", async () => {
  const input = { userId: "owner", sessionId: "session", messages: [] };
  for (const [body, status, error] of [
    [{ status: "conflict" }, 200, "saved conversation changed"],
    [{ status: "not_found" }, 200, "no longer available"],
    [null, 200, "no longer available"],
    [{ status: "ok" }, 200, "no longer available"],
    [{ message: "private database diagnostic" }, 500, "Could not save"],
  ] as const) {
    const client = createClient("https://db.example.test", "fixture", {
      auth: { persistSession: false },
      global: { fetch: async () => Response.json(body, { status }) },
    });
    await expect(saveControlTranscript(input, client)).rejects.toThrow(error);
  }
});

it("redacts persisted payloads and returns the database-authoritative session", async () => {
  const client = createClient("https://db.example.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          status: "ok",
          session: { id: body.p_session_id, messages: body.p_messages },
        });
      },
    },
  });
  const session = await saveControlTranscript(
    {
      userId: "owner",
      sessionId: "session",
      messages: [
        {
          id: "m",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "Authorization: Bearer private-fixture-value",
            },
          ],
        },
      ],
    },
    client
  );
  expect(session.id).toBe("session");
  expect(session.messages[0].id).toBe("m");
  expect(JSON.stringify(session.messages)).not.toContain(
    "private-fixture-value"
  );
});
