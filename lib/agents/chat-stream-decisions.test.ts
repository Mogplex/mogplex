import { describe, expect, it } from "vitest";
import type { DecisionStep } from "@/lib/decisions/turn";
import { withChatStreamDecisions } from "./chat-stream-decisions";
import type { ChatModelStreamHooks } from "./run-chat";

const scope = { surface: "chat", userId: "user-1" };

type EndEvent = Parameters<NonNullable<ChatModelStreamHooks["onEnd"]>>[0];
type StepEvent = Parameters<NonNullable<ChatModelStreamHooks["onStepEnd"]>>[0];

const toolStep = { toolCalls: [{ toolName: "bash", toolCallId: "a" }] };

function endEvent(finishReason: string): EndEvent {
  return { finishReason, steps: [toolStep] } as unknown as EndEvent;
}

function fakeObserver() {
  const log: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed: { steps: number[]; ended: DecisionStep[][] } = {
    steps: [],
    ended: [],
  };
  const create = () => ({
    onStep: (steps: readonly DecisionStep[]) => {
      observed.steps.push(steps.length);
    },
    onEnd: async (steps: readonly DecisionStep[]) => {
      observed.ended.push([...steps]);
      await gate;
      log.push("check settled");
    },
  });
  return { create, log, release, observed };
}

describe("withChatStreamDecisions", () => {
  it("should not finish the turn until the end-of-turn check has settled", async () => {
    const { create, log, release } = fakeObserver();
    const hooks = withChatStreamDecisions(
      {
        onEnd: async () => {
          log.push("caller onEnd");
        },
      },
      scope,
      create
    );

    const finished = Promise.resolve(hooks.onEnd?.(endEvent("stop"))).then(() =>
      log.push("turn finished")
    );
    await Promise.resolve();
    release();
    await finished;

    expect(log).toEqual(["caller onEnd", "check settled", "turn finished"]);
  });

  it("should skip the check when the turn ended in a provider error", async () => {
    const { create, observed } = fakeObserver();
    const hooks = withChatStreamDecisions(undefined, scope, create);

    await hooks.onEnd?.(endEvent("error"));

    expect(observed.ended).toHaveLength(0);
  });

  it("should feed every step to the observer and still call the caller's hook", async () => {
    const { create, observed } = fakeObserver();
    const seen: unknown[] = [];
    const hooks = withChatStreamDecisions(
      {
        onStepEnd: async (event) => {
          seen.push(event);
        },
      },
      scope,
      create
    );

    await hooks.onStepEnd?.(toolStep as unknown as StepEvent);
    await hooks.onStepEnd?.(toolStep as unknown as StepEvent);

    expect(observed.steps).toEqual([1, 2]);
    expect(seen).toHaveLength(2);
  });

  it("should still run the check when the caller's onEnd throws", async () => {
    const { create, observed, release } = fakeObserver();
    release();
    const hooks = withChatStreamDecisions(
      {
        onEnd: async () => {
          throw new Error("finalize failed");
        },
      },
      scope,
      create
    );

    await expect(hooks.onEnd?.(endEvent("stop"))).rejects.toThrow(
      "finalize failed"
    );
    expect(observed.ended).toHaveLength(1);
  });
});
