import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { forwardNativeWebhook } from "@/lib/trigger/webhook-forwarding";

let dispatchNativeSlackWebhook: typeof import("./native-webhook-dispatch").dispatchNativeSlackWebhook;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  ({ dispatchNativeSlackWebhook } = await import("./native-webhook-dispatch"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const command = {
  command: "/mogplex",
  text: "harness codex",
  team_id: "T1",
  channel_id: "C1",
  user_id: "U1",
  response_url: "https://hooks.slack.com/actions/synthetic-response",
  trigger_id: "invocation-1",
};

type Receipt = {
  id: string;
  scope_key: string;
  user_id: string;
  tool_name: string;
  input_hash: string;
  occurrence: number;
  status: string;
  output: unknown;
  error: string | null;
};

function transport(
  options: {
    completionFails?: boolean;
    missingInstallation?: boolean;
    unlinkedActor?: boolean;
  } = {}
) {
  const receipts = new Map<string, Receipt>();
  let writes = 0;
  let replies = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "hooks.slack.com") {
        replies++;
        return new Response(null, { status: 200 });
      }
      if (url.pathname.endsWith("/slack_installations")) {
        if (options.missingInstallation) return Response.json(null);
        return Response.json({
          id: "installation-1",
          team_id: "T1",
          installed_by_user_id: "owner-1",
          authed_user_slack_id: options.unlinkedActor
            ? "another-installer"
            : "U1",
          bot_user_id: "B1",
          scopes: [],
        });
      }
      if (url.pathname.endsWith("/slack_user_mappings"))
        return Response.json(null);
      if (url.pathname.endsWith("/slack_harness_preferences")) {
        if (init?.method === "POST") writes++;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/slack_tool_executions")) {
        if (init?.method === "POST") {
          const row = JSON.parse(String(init.body)) as Receipt;
          const key = JSON.stringify([
            row.user_id,
            row.scope_key,
            row.tool_name,
            row.input_hash,
            row.occurrence,
          ]);
          if (receipts.has(key))
            return Response.json(
              { code: "23505", message: "duplicate receipt" },
              { status: 409 }
            );
          const record = {
            ...row,
            id: `receipt-${receipts.size}`,
            output: null,
            error: null,
          };
          receipts.set(key, record);
          return Response.json(record);
        }
        const record = [...receipts.values()].find((row) =>
          init?.method === "PATCH"
            ? `eq.${row.id}` === url.searchParams.get("id")
            : `eq.${row.input_hash}` === url.searchParams.get("input_hash")
        );
        if (!record) throw new Error("receipt missing");
        if (init?.method === "PATCH") {
          const values = JSON.parse(String(init.body)) as Partial<Receipt>;
          if (options.completionFails && values.status === "completed") {
            return Response.json(
              { message: "completion unavailable" },
              { status: 400 }
            );
          }
          Object.assign(record, values);
          return Response.json({ id: record.id });
        }
        return Response.json(record);
      }
      throw new Error(`Unexpected network request ${url.pathname}`);
    })
  );
  return { receipts, writes: () => writes, replies: () => replies };
}

describe("native Slack delivery handling", () => {
  it.each([{ missingInstallation: true }, { unlinkedActor: true }])(
    "preserves authorization/linking responses without recording or executing a mutation: %j",
    async (options) => {
      const state = transport(options);
      await dispatchNativeSlackWebhook(command);
      expect(state.writes()).toBe(0);
      expect(state.receipts.size).toBe(0);
      expect(state.replies()).toBe(1);
    }
  );
  it("fails visibly without exposing a malformed hosted payload", async () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    await expect(
      dispatchNativeSlackWebhook({ ...command, user_id: 123 })
    ).rejects.toMatchObject({
      name: "AbortTaskRunError",
      message: "Slack delivery is not classifiable",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not execute the same command twice across separate native deliveries", async () => {
    const state = transport();
    await dispatchNativeSlackWebhook(command);
    await dispatchNativeSlackWebhook({ ...command });
    expect(state.writes()).toBe(1);
    expect(state.replies()).toBe(1);
    expect(state.receipts.size).toBe(1);
    expect(JSON.stringify([...state.receipts.values()])).not.toContain(
      command.response_url
    );
  });

  it("survives hosted acceptance followed by an edge timeout and freshly signed redelivery", async () => {
    const state = transport();
    let attempt = 0;
    const hosted: typeof fetch = async (_input, init) => {
      await dispatchNativeSlackWebhook(
        Object.fromEntries(new URLSearchParams(String(init?.body)))
      );
      if (attempt++ === 0)
        throw new Error("response lost after durable acceptance");
      return new Response(null, { status: 200 });
    };
    const body = new URLSearchParams(command).toString();
    const options = {
      env: {
        TRIGGER_SLACK_WEBHOOK_URL: "https://api.trigger.dev/webhooks/synthetic",
      },
      fetch: hosted,
    };
    expect(
      (
        await forwardNativeWebhook(
          "slack",
          body,
          new Headers({
            "x-slack-request-timestamp": "1793458500",
            "x-slack-signature": "signature-one",
          }),
          options
        )
      ).status
    ).toBe(503);
    expect(
      (
        await forwardNativeWebhook(
          "slack",
          body,
          new Headers({
            "x-slack-request-timestamp": "1793458501",
            "x-slack-signature": "signature-two",
          }),
          options
        )
      ).status
    ).toBe(200);
    expect(state.writes()).toBe(1);
    expect(state.replies()).toBe(1);
  });

  it("claims concurrent deliveries atomically while allowing a distinct invocation", async () => {
    const state = transport();
    const results = await Promise.allSettled([
      dispatchNativeSlackWebhook(command),
      dispatchNativeSlackWebhook(command),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(state.writes()).toBe(1);
    await dispatchNativeSlackWebhook({
      ...command,
      trigger_id: "invocation-2",
      response_url: `${command.response_url}-2`,
    });
    expect(state.writes()).toBe(2);
    expect(state.receipts.size).toBe(2);
  });

  it("deduplicates a button click using its signed action identity", async () => {
    const state = transport();
    const action = {
      type: "block_actions",
      team: { id: "T1" },
      user: { id: "U1" },
      channel: { id: "C1" },
      response_url: command.response_url,
      trigger_id: "click-1",
      actions: [
        {
          action_id: "mogplex_select_command",
          selected_option: { value: "harness" },
          action_ts: "1793458500.123",
        },
      ],
    };
    await dispatchNativeSlackWebhook({ payload: JSON.stringify(action) });
    await dispatchNativeSlackWebhook({
      payload: JSON.stringify({ ...action }),
    });
    expect(state.replies()).toBe(1);
    expect(state.receipts.size).toBe(1);
  });

  it("preserves global message identity when dispatch runs inside a native task", async () => {
    vi.stubEnv("TRIGGER_SECRET_KEY", "tr_dev_synthetic_slack_dispatch");
    const requests: Array<{
      options: {
        idempotencyKeyOptions?: { scope: string; key: string };
        concurrencyKey?: string;
      };
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toContain("/tasks/handle-slack-event/trigger");
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
          id: "run_synthetic",
          isCached: requests.length > 1,
        });
      })
    );
    const event = {
      type: "event_callback",
      team_id: "T1",
      event_id: "E1",
      event: {
        type: "message",
        channel: "C1",
        channel_type: "im",
        user: "U1",
        text: "hello",
        ts: "1793458500.001",
      },
    };
    await dispatchNativeSlackWebhook(event);
    await dispatchNativeSlackWebhook(event);
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(request.options.idempotencyKeyOptions).toEqual({
        scope: "global",
        key: "slack-event:E1",
      });
    expect(requests[0].options.concurrencyKey).toBe(
      requests[1].options.concurrencyKey
    );
  });

  it("keeps the receipt after a partial failure so a redelivery cannot repeat the write", async () => {
    const state = transport({ completionFails: true });
    await expect(dispatchNativeSlackWebhook(command)).rejects.toThrow();
    await expect(dispatchNativeSlackWebhook(command)).rejects.toMatchObject({
      name: "AbortTaskRunError",
    });
    expect(state.writes()).toBe(1);
    expect([...state.receipts.values()][0].status).toBe("failed");
  });
});
