import { describe, expect, it } from "vitest";
import {
  createTurnDecisionObserver,
  type TurnObserverDeps,
} from "./turn-observer";
import type { DecisionStep } from "./turn";

const scope = {
  surface: "control",
  userId: "user-1",
  aiCallId: "call-1",
  conversationId: "conv-1",
  repoId: "repo-1",
};

const toolStep = (id: string): DecisionStep => ({
  toolCalls: [
    { toolName: "run_command", toolCallId: id, input: { command: id } },
  ],
});

function makeDeps(overrides: Partial<TurnObserverDeps> = {}) {
  const notices: Array<Parameters<TurnObserverDeps["appendNotice"]>[0]> = [];
  const loopChecks: number[] = [];
  const deps: TurnObserverDeps = {
    verifyClaims: async () => null,
    checkLoop: async ({ steps }) => {
      loopChecks.push(steps.length);
      return false;
    },
    appendNotice: async (input) => {
      notices.push(input);
    },
    ...overrides,
  };
  return { deps, notices, loopChecks };
}

describe("createTurnDecisionObserver", () => {
  it("should start loop checks at six tool calls and only when new calls arrive", () => {
    const { deps, loopChecks } = makeDeps();
    const observer = createTurnDecisionObserver(scope, deps);
    const steps: DecisionStep[] = [];

    for (let index = 0; index < 7; index += 1) {
      steps.push(toolStep(`c${index}`));
      observer.onStep(steps);
    }
    steps.push({ text: "thinking" });
    observer.onStep(steps);

    expect(loopChecks).toEqual([6, 7]);
  });

  it("should write a run notice when the final claims are unsupported", async () => {
    const { deps, notices } = makeDeps({
      verifyClaims: async () => ({ unsupported: ["tests passing"] }),
    });

    await createTurnDecisionObserver(scope, deps).onEnd([toolStep("a")]);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      aiCallId: "call-1",
      userId: "user-1",
      conversationId: "conv-1",
      repoId: "repo-1",
      payload: { check: "claim_verification", unsupported: ["tests passing"] },
    });
    expect(notices[0]?.message).toContain("tests passing");
  });

  it("should write nothing when the claims hold or no run owns the turn", async () => {
    const supported = makeDeps();
    await createTurnDecisionObserver(scope, supported.deps).onEnd([
      toolStep("a"),
    ]);

    const ownerless = makeDeps({
      verifyClaims: async () => ({ unsupported: ["tests passing"] }),
    });
    await createTurnDecisionObserver(
      { ...scope, aiCallId: null },
      ownerless.deps
    ).onEnd([toolStep("a")]);

    expect(supported.notices).toHaveLength(0);
    expect(ownerless.notices).toHaveLength(0);
  });

  it("should never reject when a check throws", async () => {
    const { deps } = makeDeps({
      verifyClaims: async () => {
        throw new Error("down");
      },
      checkLoop: async () => {
        throw new Error("down");
      },
    });
    const observer = createTurnDecisionObserver(scope, deps);

    observer.onStep(
      Array.from({ length: 6 }, (_, index) => toolStep(`c${index}`))
    );
    await expect(observer.onEnd([toolStep("a")])).resolves.toBeUndefined();
  });
});
