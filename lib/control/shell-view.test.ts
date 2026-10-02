import { expect, it } from "vitest";
import { resolveShellView } from "./shell-view";
import { resolveSessionListState } from "./session-list-state";

it("keeps history pending and failed states distinct from an empty history", () => {
  expect(
    resolveSessionListState({ loaded: false, error: null, count: 0 })
  ).toBe("loading");
  expect(
    resolveSessionListState({ loaded: false, error: "Unavailable", count: 0 })
  ).toBe("error");
  expect(resolveSessionListState({ loaded: true, error: null, count: 0 })).toBe(
    "empty"
  );
  expect(resolveSessionListState({ loaded: true, error: null, count: 2 })).toBe(
    "ready"
  );
});
it("waits for history and selection while allowing an explicit New", () => {
  const state = {
    newMission: false,
    hasMission: false,
    sessionId: null,
    sessionsLoaded: false,
  };
  expect(resolveShellView(state)).toBe("loading");
  expect(resolveShellView({ ...state, newMission: true })).toBe("new");
  expect(
    resolveShellView({ ...state, sessionsLoaded: true, restoring: true })
  ).toBe("loading");
  expect(resolveShellView({ ...state, sessionsLoaded: true })).toBe("new");
  expect(
    resolveShellView({ ...state, sessionsLoaded: true, sessionId: "saved" })
  ).toBe("mission");
  expect(
    resolveShellView({ ...state, sessionsLoaded: true, hasMission: true })
  ).toBe("mission");
});
