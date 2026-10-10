import { expect, it } from "vitest";
import { workspaceRepoState } from "./repos-visibility";

it("requires current repository visibility before mounting a saved workspace", () => {
  const visible = [{ id: "repo", is_hidden: false }];
  const removed = [{ id: "repo", is_hidden: true }];
  expect(workspaceRepoState("repo", visible, false, null)).toBe("available");
  expect(workspaceRepoState("repo", removed, false, null)).toBe("removed");
  expect(workspaceRepoState("repo", [], false, null)).toBe("unavailable");
  expect(workspaceRepoState("other", visible, false, null)).toBe("unavailable");
  expect(workspaceRepoState("repo", visible, true, null)).toBe("loading");
  expect(workspaceRepoState("repo", visible, false, new Error("offline"))).toBe(
    "error"
  );
  expect(workspaceRepoState("repo", visible, true, new Error("offline"))).toBe(
    "error"
  );
  expect(workspaceRepoState(null, [], true, new Error("offline"))).toBe(
    "available"
  );
});
