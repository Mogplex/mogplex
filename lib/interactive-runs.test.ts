import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appendAiCallEvent,
  safeAppendAiCallEvent,
  sanitizeAiCallEventInput,
  updateAiCallIfActive,
} from "./interactive-runs";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
});

describe("active call updates", () => {
  afterEach(() => {
    Reflect.deleteProperty(supabaseAdmin, "from");
  });

  it.each(["active", "cancel_requested", "cancelled"])(
    "only advances a run while its control state is active (%s)",
    async (controlState) => {
      let row: Record<string, unknown> = {
        id: "call-1",
        status: "pending",
        control_state: controlState,
        model: "harness:mogplex",
      };
      let update: Record<string, unknown> = {};
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        update(value: Record<string, unknown>) {
          update = value;
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push((record) => record[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          filters.push((record) => values.includes(record[key]));
          return query;
        },
        select() {
          return query;
        },
        async maybeSingle() {
          if (!filters.every((filter) => filter(row)))
            return { data: null, error: null };
          row = { ...row, ...update };
          return { data: row, error: null };
        },
      };
      Object.defineProperty(supabaseAdmin, "from", {
        configurable: true,
        value: () => query,
      });
      const result = await updateAiCallIfActive("call-1", {
        status: "streaming",
        model: "test/native",
      });
      if (controlState === "active") {
        expect(result).toMatchObject({
          status: "streaming",
          model: "test/native",
        });
      } else {
        expect(result).toBeNull();
        expect(row.status).toBe("pending");
        expect(row.model).toBe("harness:mogplex");
      }
    }
  );
});

describe("sanitizeAiCallEventInput", () => {
  const input = {
    aiCallId: "call-1",
    userId: "user-1",
    eventType: "log" as const,
    message: "Bearer secret-message",
    payload: { token: "secret-payload" },
  };

  it("redacts values before persistence or diagnostics", () => {
    expect(sanitizeAiCallEventInput(input)).toMatchObject({
      message: "Bearer [redacted]",
      payload: { token: "[redacted]" },
    });
  });
});

describe("appendAiCallEvent", () => {
  const input = {
    aiCallId: "call-1",
    userId: "user-1",
    eventType: "log" as const,
    message: "Bearer secret-message",
    payload: { token: "secret-payload" },
  };
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));

  afterEach(() => {
    Reflect.deleteProperty(supabaseAdmin, "from");
  });

  function stubAdminFrom() {
    Object.defineProperty(supabaseAdmin, "from", {
      configurable: true,
      value: vi.fn(() => ({ insert })),
    });
  }

  it("redacts messages before saving the event", async () => {
    single.mockResolvedValue({ data: { id: "event-1" }, error: null });
    stubAdminFrom();

    await appendAiCallEvent(input);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Bearer [redacted]",
        payload: { token: "[redacted]" },
      })
    );
  });

  it("redacts values in failure diagnostics", async () => {
    single.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    stubAdminFrom();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(safeAppendAiCallEvent(input)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "[interactive-runs] failed to append ai_call_event",
      expect.objectContaining({
        input: expect.objectContaining({
          message: "Bearer [redacted]",
          payload: { token: "[redacted]" },
        }),
      })
    );
  });
});
