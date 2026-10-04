import { describe, expect, it } from "vitest";
import { createControlStartupTraceSampler } from "./control-startup-trace-sampler";

type SamplingContext = Parameters<
  ReturnType<typeof createControlStartupTraceSampler>
>[0];

function context(name: string, inheritedRate?: number): SamplingContext {
  return {
    name,
    inheritOrSampleWith: (fallback) => inheritedRate ?? fallback,
  };
}

describe("Control startup trace sampling", () => {
  it("retains the first Control GET even when its incoming parent was dropped", () => {
    const sample = createControlStartupTraceSampler(0.1);
    const request = context("GET /api/control/sessions", 0);

    expect(sample(request)).toBe(1);
    expect(sample(request)).toBe(0);
  });

  it("does not consume the first Control trace on another route or method", () => {
    const sample = createControlStartupTraceSampler(0.2);

    expect(sample(context("GET /api/models"))).toBe(0.2);
    expect(sample(context("POST /api/control/sessions"))).toBe(0.2);
    expect(sample(context("GET /api/control/sessions/other"))).toBe(0.2);
    expect(sample(context("GET /api/control/sessions"))).toBe(1);
    expect(sample(context("GET /api/control/sessions"))).toBe(0.2);
  });

  it("preserves inherited decisions for subsequent Control and unrelated traces", () => {
    const sample = createControlStartupTraceSampler(0.1);
    sample(context("GET /api/control/sessions"));

    expect(sample(context("GET /api/control/sessions", 1))).toBe(1);
    expect(sample(context("GET /api/control/sessions", 0))).toBe(0);
    expect(sample(context("GET /api/models", 1))).toBe(1);
    expect(sample(context("GET /api/models", 0))).toBe(0);
  });

  it("starts a new first-request decision for each server instance", () => {
    const first = createControlStartupTraceSampler(0.1);
    const second = createControlStartupTraceSampler(0.1);
    const request = context("GET /api/control/sessions");

    expect(first(request)).toBe(1);
    expect(first(request)).toBe(0.1);
    expect(second(request)).toBe(1);
  });

  it("retains the first trace at a configured rate of one despite a dropped parent", () => {
    const sample = createControlStartupTraceSampler(1);
    const request = context("GET /api/control/sessions", 0);

    expect(sample(request)).toBe(1);
    expect(sample(request)).toBe(0);
  });

  it.each([0, -1, 2, Number.NaN])(
    "leaves a disabled or invalid rate %s to the SDK",
    (rate) => {
      const sample = createControlStartupTraceSampler(rate);
      expect(sample(context("GET /api/control/sessions"))).toBe(rate);
    }
  );
});
