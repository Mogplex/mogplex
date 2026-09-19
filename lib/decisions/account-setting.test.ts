import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDecisionChecksGate,
  DECISION_CHECKS_CACHE_TTL_MS,
  DECISION_CHECKS_LOOKUP_TIMEOUT_MS,
  decisionChecksOwner,
  type DecisionChecksOwner,
} from "./account-setting";

function makeLoader(answers: Record<string, boolean | Error>) {
  const loads: DecisionChecksOwner[] = [];
  const load = async (owner: DecisionChecksOwner) => {
    loads.push(owner);
    const answer = answers[`${owner.table}:${owner.id}`];
    if (answer instanceof Error) throw answer;
    return answer ?? true;
  };
  return { load, loads, answers };
}

const teamScope = { surface: "control", userId: "user-1", teamId: "team-1" };
const personalScope = { surface: "chat", userId: "user-1" };

describe("decisionChecksOwner", () => {
  it("should follow the team when the work belongs to a team", () => {
    expect(decisionChecksOwner(teamScope)).toEqual({
      table: "teams",
      id: "team-1",
    });
  });

  it("should follow the person when the work is outside a team", () => {
    expect(decisionChecksOwner({ userId: "user-1", teamId: null })).toEqual({
      table: "profiles",
      id: "user-1",
    });
  });

  it("should have no owner when neither a team nor a person is known", () => {
    expect(decisionChecksOwner({})).toBeNull();
  });
});

describe("createDecisionChecksGate", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should use the team's choice even when the member's own setting is on", async () => {
    const { load, loads } = makeLoader({
      "teams:team-1": false,
      "profiles:user-1": true,
    });
    const gate = createDecisionChecksGate(load);

    expect(await gate(teamScope)).toBe(false);
    expect(await gate(personalScope)).toBe(true);
    expect(loads).toEqual([
      { table: "teams", id: "team-1" },
      { table: "profiles", id: "user-1" },
    ]);
  });

  it("should allow ownerless work without reading anything", async () => {
    const { load, loads } = makeLoader({});
    const gate = createDecisionChecksGate(load);

    expect(await gate({ surface: "agent_tool" })).toBe(true);
    expect(loads).toHaveLength(0);
  });

  it("should reuse a loaded choice until the cache window ends, then read again", async () => {
    let clock = 1_000;
    const loader = makeLoader({ "teams:team-1": true });
    const gate = createDecisionChecksGate(loader.load, () => clock);

    expect(await gate(teamScope)).toBe(true);
    loader.answers["teams:team-1"] = false;
    clock += DECISION_CHECKS_CACHE_TTL_MS - 1;
    expect(await gate(teamScope)).toBe(true);
    clock += 1;
    expect(await gate(teamScope)).toBe(false);
    expect(loader.loads).toHaveLength(2);
  });

  it("should apply a change at once after forget", async () => {
    const loader = makeLoader({ "teams:team-1": true });
    const gate = createDecisionChecksGate(loader.load, () => 1_000);

    expect(await gate(teamScope)).toBe(true);
    loader.answers["teams:team-1"] = false;
    gate.forget({ table: "teams", id: "team-1" });

    expect(await gate(teamScope)).toBe(false);
  });

  it("should read as off when the lookup fails, and retry on the next call", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = makeLoader({ "teams:team-1": new Error("db down") });
    const gate = createDecisionChecksGate(loader.load, () => 1_000);

    expect(await gate(teamScope)).toBe(false);
    loader.answers["teams:team-1"] = true;
    expect(await gate(teamScope)).toBe(true);
    expect(loader.loads).toHaveLength(2);
  });

  it("should share one read between checks that start together", async () => {
    let release: (value: boolean) => void = () => {};
    let loads = 0;
    const gate = createDecisionChecksGate(
      () =>
        new Promise<boolean>((resolve) => {
          loads += 1;
          release = resolve;
        })
    );

    const both = Promise.all([gate(teamScope), gate(teamScope)]);
    release(false);

    expect(await both).toEqual([false, false]);
    expect(loads).toBe(1);
  });

  it("should read as off when the lookup outlasts its time limit", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = createDecisionChecksGate(() => new Promise<boolean>(() => {}));

    const pending = gate(teamScope);
    await vi.advanceTimersByTimeAsync(DECISION_CHECKS_LOOKUP_TIMEOUT_MS);

    expect(await pending).toBe(false);
  });
});
