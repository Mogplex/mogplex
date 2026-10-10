import { expect, it } from "vitest";
import type { UIMessage } from "ai";
import { redactSecretsInValue } from "../ai-telemetry";
import {
  latestModelContext,
  modelMessageMetadata,
  presentModelContext,
} from "./context-usage";

const usage = {
  model: "provider/model",
  inputTokens: 25000,
  outputTokens: 600,
};
it("shows the measured latest-step usage, rounded up to avoid a false zero", () => {
  expect(presentModelContext(usage, usage.model, 128000)).toEqual({
    label: "Context: 20% used",
    title:
      "Last model step: 25,600 of 128,000 tokens. Context can change as the run continues.",
  });
  expect(
    presentModelContext(
      { ...usage, inputTokens: 1, outputTokens: 0 },
      usage.model,
      128000
    ).label
  ).toBe("Context: 1% used");
  expect(presentModelContext(usage, usage.model, 1000).label).toBe(
    "Context: 100% used"
  );
});

it("preserves numeric context usage through conversation secret redaction", () => {
  const message: UIMessage = {
    id: "answer",
    role: "assistant",
    parts: [],
    metadata: modelMessageMetadata("call", usage.model, {
      type: "finish-step",
      usage,
    }),
  };
  const saved = redactSecretsInValue([message]) as UIMessage[];
  expect(latestModelContext(saved)).toEqual(usage);
  expect(
    presentModelContext(latestModelContext(saved), usage.model, 128000).label
  ).toBe("Context: 20% used");
});

it("recognizes Anthropic response model spelling without accepting a different fallback", () => {
  for (const model of ["claude-sonnet-5-5", "anthropic/claude-sonnet-5-5"]) {
    expect(
      presentModelContext(
        { ...usage, model },
        "anthropic/claude-sonnet-5.5",
        128000
      ).label
    ).toBe("Context: 20% used");
  }
  for (const model of [
    "claude-sonnet-5",
    "claude-opus-5-5",
    "other/claude-sonnet-5-5",
    "claude-sonnet-5-5-20261010",
  ]) {
    expect(
      presentModelContext(
        { ...usage, model },
        "anthropic/claude-sonnet-5.5",
        128000
      ).label
    ).toBe("Context: unknown");
  }
  expect(
    presentModelContext(
      { ...usage, model: "claude-sonnet-5-5" },
      undefined,
      128000
    ).label
  ).toBe("Context: unknown");
});
it("does not reuse stale measurements after switching models or invent an unknown model limit", () => {
  for (const [measurement, model, limit] of [
    [null, usage.model, 128000],
    [usage, "other/model", 128000],
    [usage, usage.model, undefined],
    [usage, usage.model, 0],
    [usage, usage.model, -1],
    [usage, usage.model, Infinity],
    [{ ...usage, inputTokens: NaN }, usage.model, 128000],
  ] as const) {
    expect(presentModelContext(measurement, model, limit).label).toBe(
      "Context: unknown"
    );
  }
});
