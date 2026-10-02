import assert from "node:assert/strict";
import test from "node:test";
import { supabaseAdmin } from "../../lib/supabase/admin";
import { runAuthorizedControlChat } from "../../app/api/control/chat/_lib/authorized-request";

test("concurrent authorized Control requests return 409 to the second conversation turn", async () => {
  const admins = [
    ...new Set([
      supabaseAdmin,
      (await import("@/lib/supabase/admin")).supabaseAdmin,
    ]),
  ];
  const originals = admins.map((admin) => ({
    admin,
    descriptors: Object.fromEntries(
      ["from", "rpc", "then"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(admin, key),
      ])
    ),
  }));
  // Async imports probe then on the lazy client; this is part of the DB boundary fixture.
  for (const admin of admins)
    Object.defineProperty(admin, "then", {
      configurable: true,
      value: undefined,
    });
  let firstRow: Record<string, unknown> | null = null;
  let admitFirst: (row: Record<string, unknown>) => void = () => {};
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let claims = 0;
  let releases = 0;
  let admitted = 0;
  const rpc = async (name: string) => {
    if (name === "claim_chat_limit_admission")
      return {
        data: [{ allowed: true, claim_id: `claim-${++claims}` }],
        error: null,
      };
    throw new Error(`Unexpected fixture RPC ${name}`);
  };
  const from = (table: string) => {
    if (table === "limit_events") {
      const query = {
        delete() {
          releases++;
          return query;
        },
        eq() {
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return query;
    }
    if (table !== "control_sessions" && table !== "ai_calls")
      throw new Error("Fixture startup unavailable");
    let payload: Record<string, unknown> | null = null;
    let update: Record<string, unknown> | null = null;
    const query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      in() {
        return query;
      },
      insert(value: Record<string, unknown>) {
        payload = value;
        return query;
      },
      update(value: Record<string, unknown>) {
        update = value;
        return query;
      },
      then(resolve: (value: unknown) => unknown) {
        if (update) firstRow = { ...firstRow, ...update };
        return Promise.resolve(resolve({ data: firstRow, error: null }));
      },
      async maybeSingle() {
        if (update) firstRow = { ...firstRow, ...update };
        if (table === "control_sessions")
          return {
            data: {
              id: "conversation",
              user_id: "owner",
              title: "Concurrent turn",
              repo_id: null,
              model_id: "fixture-model",
            },
            error: null,
          };
        return { data: firstRow, error: null };
      },
      async single() {
        if (update) {
          firstRow = { ...firstRow, ...update };
          return { data: firstRow, error: null };
        }
        if (
          firstRow &&
          ["pending", "streaming"].includes(String(firstRow.status))
        )
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "control_conversation_active_turn"',
            },
          };
        const continuing = firstRow !== null;
        firstRow = { id: `call-${++admitted}`, ...payload };
        if (continuing) return { data: firstRow, error: null };
        markStarted();
        return new Promise<{ data: Record<string, unknown>; error: null }>(
          (resolve) => {
            admitFirst = (row) => resolve({ data: row, error: null });
          }
        );
      },
    };
    return query;
  };
  for (const admin of admins) {
    Object.defineProperty(admin, "rpc", { configurable: true, value: rpc });
    Object.defineProperty(admin, "from", { configurable: true, value: from });
  }
  const request = () =>
    runAuthorizedControlChat(
      new Request("http://localhost/api/control/chat", {
        method: "POST",
        body: JSON.stringify({
          conversationId: "conversation",
          model: "fixture-model",
          enableTools: false,
          messages: [
            {
              id: "u",
              role: "user",
              parts: [{ type: "text", text: "Check this mission" }],
            },
          ],
        }),
      }),
      "owner",
      { onCompletion: () => undefined }
    );
  const first = request();
  try {
    await Promise.race([
      started,
      first.then(async (response) => {
        throw new Error(
          `First request stopped before admission: ${JSON.stringify(await response.json())}`
        );
      }),
    ]);
    const second = await request();
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), {
      error: "A turn is already running on this conversation.",
    });
    assert.equal(
      releases,
      1,
      "the rejected request releases its quota admission"
    );
    admitFirst(firstRow!);
    assert.equal((await first).status, 500);
    assert.equal(
      (firstRow as Record<string, unknown> | null)?.status,
      "failed"
    );
    const next = await request();
    assert.equal(
      next.status,
      500,
      "a finalized turn admits the next request, which reaches fixture provider setup"
    );
    assert.equal(admitted, 2);
    assert.equal((firstRow as Record<string, unknown> | null)?.id, "call-2");
  } finally {
    try {
      admitFirst(firstRow!);
      assert.equal(
        (await first).status,
        500,
        "the fixture fails provider setup after the claim, without starting a paid run"
      );
    } finally {
      for (const { admin, descriptors } of originals) {
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (descriptor) Object.defineProperty(admin, key, descriptor);
          else Reflect.deleteProperty(admin, key);
        }
      }
    }
  }
});
