import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appendAiCallEvent,
  safeAppendAiCallEvent,
  sanitizeAiCallEventInput,
} from "./interactive-runs";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
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
