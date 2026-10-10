import { describe, expect, it } from "vitest";
import type { FlowRunDetail } from "@/lib/types";
import { getRunInvocation } from "./run-presentation-invocation";

type InvocationRun = Parameters<typeof getRunInvocation>[0];

function run(overrides: Partial<InvocationRun> = {}): InvocationRun {
  return {
    metadata: {
      flow_version_number: 4,
      working_branch: "mogplex/automation-0123456789abcdef",
      input: { slug: "acme" },
      trigger: {
        credential: "integration",
        key_id: "k",
        label: "Webrenew agent",
      },
    },
    repo: { id: "repo-1", full_name: "webrenew/previews" },
    ai_calls: [
      { id: "call-1", metadata: { sandbox_record_id: "sbx-1" } },
      { id: "call-2", metadata: {} },
    ] as unknown as FlowRunDetail["ai_calls"],
    ...overrides,
  };
}

describe("getRunInvocation", () => {
  it("should present the version, trigger, branch and input of an API run", () => {
    const invocation = getRunInvocation(run(), "acme");
    expect(invocation).toMatchObject({
      versionNumber: 4,
      triggeredBy: "Integration · Webrenew agent",
      workingBranch: "mogplex/automation-0123456789abcdef",
      workspaceHref: "/acme/observability?call_id=call-2",
      sandboxHref: "/acme/observability?repo_id=repo-1&sandbox_record_id=sbx-1",
    });
    expect(JSON.parse(invocation.input ?? "null")).toEqual({ slug: "acme" });
  });

  it("should prefer the sandbox recorded on the run itself", () => {
    const invocation = getRunInvocation(
      run({ metadata: { sandbox_record_id: "sbx-run" } }),
      "acme"
    );
    expect(invocation.sandboxHref).toContain("sandbox_record_id=sbx-run");
  });

  it.each([
    [{ credential: "integration" }, "Integration key"],
    [{ credential: "interactive", label: "Mogplex app" }, "Mogplex app"],
    [{ credential: "interactive" }, "Mogplex login"],
    [null, null],
  ])("should describe trigger %j as %s", (trigger, expected) => {
    expect(
      getRunInvocation(run({ metadata: { trigger } }), "acme").triggeredBy
    ).toBe(expected);
  });

  it("should leave links and input empty when the run has none", () => {
    expect(
      getRunInvocation(run({ metadata: null, ai_calls: [] }), undefined)
    ).toEqual({
      versionNumber: null,
      triggeredBy: null,
      input: null,
      workingBranch: null,
      workspaceHref: null,
      sandboxHref: null,
    });
  });
});
