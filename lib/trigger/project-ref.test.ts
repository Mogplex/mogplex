import { describe, expect, it } from "vitest";
import {
  HOSTED_TRIGGER_PROJECT_REF,
  assertTriggerProjectRefConfigured,
  resolveTriggerProjectRef,
} from "./project-ref";

describe("resolveTriggerProjectRef", () => {
  it("should use TRIGGER_PROJECT_REF when it is set", () => {
    expect(
      resolveTriggerProjectRef({ TRIGGER_PROJECT_REF: " proj_mine " })
    ).toEqual({
      ref: "proj_mine",
      source: "env",
    });
  });

  it("should report the hosted default when TRIGGER_PROJECT_REF is blank", () => {
    expect(resolveTriggerProjectRef({ TRIGGER_PROJECT_REF: "  " })).toEqual({
      ref: HOSTED_TRIGGER_PROJECT_REF,
      source: "hosted-default",
    });
  });
});

describe("assertTriggerProjectRefConfigured", () => {
  it("should throw with setup guidance when the ref is unset", () => {
    expect(() => assertTriggerProjectRefConfigured({}, ["deploy"])).toThrow(
      /TRIGGER_PROJECT_REF is not set/
    );
  });

  it("should accept a configured ref", () => {
    expect(() =>
      assertTriggerProjectRefConfigured({ TRIGGER_PROJECT_REF: "proj_mine" }, [
        "deploy",
      ])
    ).not.toThrow();
  });

  it("should accept an explicit --project-ref or -p argument", () => {
    expect(() =>
      assertTriggerProjectRefConfigured({}, [
        "deploy",
        "--project-ref",
        "proj_mine",
      ])
    ).not.toThrow();
    expect(() =>
      assertTriggerProjectRefConfigured({}, [
        "deploy",
        "--project-ref=proj_mine",
      ])
    ).not.toThrow();
    expect(() =>
      assertTriggerProjectRefConfigured({}, ["dev", "-p", "proj_mine"])
    ).not.toThrow();
  });
});
