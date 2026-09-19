import { describe, expect, it } from "vitest";
import {
  classify,
  CLASSIFY_TURNED_OFF_MESSAGE,
  type ClassifyDeps,
  type ClassifyRequest,
} from "./classify";
import type { DecisionChecksGate } from "./account-setting";

const request: ClassifyRequest = {
  question: "Is the state a bug report?",
  output: { kind: "boolean" },
  state: "The login page crashes on submit.",
  scope: { surface: "automation", userId: "user-1", teamId: "team-1" },
};

/** An evaluator that would answer, so any call to it is a leak. */
function makeDeps(isEnabled: DecisionChecksGate) {
  const log = { asked: 0, recorded: 0 };
  const deps: ClassifyDeps = {
    evaluate: async () => {
      log.asked += 1;
      return {
        ok: true,
        answers: { answer: { type: "boolean", probability: 0.9 } },
        confidence: { answer: 0.9 },
        usage: { latencyMs: 1, inputTokens: 1, costUsd: 0, model: "test" },
      };
    },
    record: async () => {
      log.recorded += 1;
    },
    env: {},
    isEnabled,
  };
  return { deps, log };
}

describe("classify and the account's run checks setting", () => {
  it("should fail the node and send nothing when the account turned the checks off", async () => {
    const gateScopes: unknown[] = [];
    const { deps, log } = makeDeps(async (scope) => {
      gateScopes.push(scope);
      return false;
    });

    const outcome = await classify(request, deps);

    expect(outcome).toEqual({
      ok: false,
      message: CLASSIFY_TURNED_OFF_MESSAGE,
    });
    expect(gateScopes).toEqual([request.scope]);
    expect(log).toEqual({ asked: 0, recorded: 0 });
  });

  it("should fail the node and send nothing when the account setting check rejects", async () => {
    const { deps, log } = makeDeps(async () => {
      throw new Error("gate exploded");
    });

    const outcome = await classify(request, deps);

    expect(outcome).toEqual({ ok: false, message: "Classification failed." });
    expect(log).toEqual({ asked: 0, recorded: 0 });
  });

  it("should answer when the account has the checks on", async () => {
    const { deps, log } = makeDeps(async () => true);

    const outcome = await classify(request, deps);

    expect(outcome).toMatchObject({ ok: true, result: { answer: true } });
    expect(log).toEqual({ asked: 1, recorded: 1 });
  });

  it("should tell the reader who can turn the checks back on without naming a provider", () => {
    expect(CLASSIFY_TURNED_OFF_MESSAGE).toMatch(/owner or admin/);
    expect(CLASSIFY_TURNED_OFF_MESSAGE).toMatch(/Settings/);
    expect(CLASSIFY_TURNED_OFF_MESSAGE).not.toMatch(/jev|typesafe|gateway/i);
  });
});
