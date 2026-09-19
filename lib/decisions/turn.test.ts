import { describe, expect, it } from "vitest";
import {
  buildClaimNotice,
  buildToolLog,
  checkForLoop,
  verifyTurnClaims,
  type DecisionStep,
} from "./turn";
import type { DecisionAnswers } from "./types";

const scope = { surface: "control", userId: "user-1" };

function step(
  tool: string,
  input: unknown,
  output: unknown,
  id: string,
  text = ""
): DecisionStep {
  return {
    text,
    toolCalls: [{ toolName: tool, toolCallId: id, input }],
    toolResults: [{ toolName: tool, toolCallId: id, output }],
  };
}

const bool = (values: Record<string, number>): DecisionAnswers =>
  Object.fromEntries(
    Object.entries(values).map(([key, probability]) => [
      key,
      { type: "boolean", probability },
    ])
  );

describe("buildToolLog", () => {
  it("should pair calls with results and mark non-zero exits and thrown errors as errors", () => {
    const steps: DecisionStep[] = [
      step(
        "run_command",
        { command: "pnpm test" },
        { exitCode: 1, stdout: "FAIL" },
        "a"
      ),
      step("edit_file", { path: "a.ts" }, { ok: true }, "b"),
      {
        toolCalls: [{ toolName: "open_pr", toolCallId: "c", input: {} }],
        content: [{ type: "tool-error", toolCallId: "c", error: "403" }],
      },
      { toolCalls: [{ toolName: "read_file", toolCallId: "d", input: {} }] },
    ];

    expect(
      buildToolLog(steps).map((entry) => [entry.tool, entry.state])
    ).toEqual([
      ["run_command", "error"],
      ["edit_file", "success"],
      ["open_pr", "error"],
      ["read_file", "unknown"],
    ]);
  });

  it("should treat policy denials and error payloads as failures", () => {
    const log = buildToolLog([
      step("git_push", {}, { status: "policy_denied" }, "a"),
      step("run_command", {}, { error: "sandbox gone" }, "b"),
    ]);
    expect(log.map((entry) => entry.state)).toEqual(["error", "error"]);
  });
});

describe("verifyTurnClaims", () => {
  const steps = [
    step("run_command", { command: "pnpm test" }, { exitCode: 1 }, "a"),
    step(
      "edit_file",
      { path: "a.ts" },
      { ok: true },
      "b",
      "All tests pass and I opened a PR."
    ),
  ];

  it("should name the claims the tool log does not support", async () => {
    const result = await verifyTurnClaims(
      { steps, scope },
      async (id, state) => {
        expect(id).toBe("claim_verification");
        expect(state).toMatchObject({
          final_message: "All tests pass and I opened a PR.",
        });
        return {
          act: true,
          status: "ok",
          verdict: "unsupported_claim",
          answers: bool({
            claimsTestsPass: 0.98,
            testsPassed: 0.02,
            claimsPrOpened: 0.97,
            prOpened: 0.03,
            claimsPushed: 0.01,
            pushed: 0.01,
          }),
        };
      }
    );

    expect(result).toEqual({
      unsupported: ["tests passing", "a pull request being opened"],
    });
  });

  it("should return null when the decision does not act", async () => {
    const result = await verifyTurnClaims({ steps, scope }, async () => ({
      act: false,
      status: "ok",
      verdict: "claims_supported",
      answers: null,
    }));
    expect(result).toBeNull();
  });

  it("should not evaluate a turn with no tool calls or no closing text", async () => {
    let calls = 0;
    const decideFn = async () => {
      calls += 1;
      return { act: true, status: "ok" as const, verdict: null, answers: null };
    };

    await verifyTurnClaims({ steps: [{ text: "Hello." }], scope }, decideFn);
    await verifyTurnClaims(
      { steps: [step("read_file", {}, {}, "a")], scope },
      decideFn
    );

    expect(calls).toBe(0);
  });
});

describe("buildClaimNotice", () => {
  it("should describe the unsupported claims without naming any provider", () => {
    const notice = buildClaimNotice(["tests passing"]);
    expect(notice).toContain("tests passing");
    expect(notice).not.toMatch(/jev|typesafe|gateway|model/i);
  });
});

describe("checkForLoop", () => {
  const repeated = Array.from({ length: 6 }, (_, index) =>
    step("run_command", { command: "pnpm build" }, { exitCode: 1 }, `c${index}`)
  );

  it("should send the last six calls with the repeat heuristic as baseline", async () => {
    const stuck = await checkForLoop(
      { steps: repeated, scope },
      async (id, state, _s, options) => {
        expect(id).toBe("loop_check");
        expect(state).toHaveLength(6);
        expect(options?.baseline).toEqual({ maxRepeat: 6, errors: 6 });
        return { act: true, status: "ok", verdict: "stuck", answers: null };
      }
    );
    expect(stuck).toBe(true);
  });

  it("should not evaluate before six tool calls exist", async () => {
    let calls = 0;
    const stuck = await checkForLoop(
      { steps: repeated.slice(0, 5), scope },
      async () => {
        calls += 1;
        return { act: true, status: "ok", verdict: "stuck", answers: null };
      }
    );
    expect(stuck).toBe(false);
    expect(calls).toBe(0);
  });
});
