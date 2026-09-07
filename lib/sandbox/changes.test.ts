import { describe, expect, it } from "vitest";
import {
  buildChangesStatusScript,
  buildCommitScript,
  buildFileDiffScript,
  buildRevertScript,
  isSafeRepoPath,
  parseChangesOutput,
  parseCommitOutput,
} from "./changes";

const STATUS_OUTPUT = [
  "MOGPLEX_BRANCH=mogplex/agent-abc123",
  "MOGPLEX_AHEAD_BEHIND=2\t1",
  "MOGPLEX_STATUS_BEGIN",
  Buffer.from(
    [
      " M src/app.ts",
      "A  src/new.ts",
      " D docs/old.md",
      "R  lib/b.ts\0lib/a.ts",
      "?? scratch/notes.txt",
      "?? weird name.txt",
      "",
    ].join("\0")
  ).toString("base64"),
  "MOGPLEX_NUMSTAT_BEGIN",
  Buffer.from(
    [
      "3\t1\tsrc/app.ts",
      "10\t0\tsrc/new.ts",
      "0\t4\tdocs/old.md",
      "1\t1\t\0lib/a.ts\0lib/b.ts",
      "-\t-\tassets/logo.png",
      "",
    ].join("\0")
  ).toString("base64"),
  "MOGPLEX_UNTRACKED_BEGIN",
  Buffer.from(
    ["7\tscratch/notes.txt", "2\tweird name.txt", ""].join("\0")
  ).toString("base64"),
].join("\n");

describe("parseChangesOutput", () => {
  it("maps porcelain status, numstat, and untracked counts onto files", () => {
    const changes = parseChangesOutput(STATUS_OUTPUT, "main");
    expect(changes.branch).toBe("mogplex/agent-abc123");
    expect(changes.baseBranch).toBe("main");
    expect(changes.ahead).toBe(2);
    expect(changes.behind).toBe(1);
    expect(changes.files).toEqual([
      { path: "src/app.ts", status: "modified", additions: 3, deletions: 1 },
      { path: "src/new.ts", status: "added", additions: 10, deletions: 0 },
      { path: "docs/old.md", status: "deleted", additions: 0, deletions: 4 },
      {
        path: "lib/b.ts",
        status: "renamed",
        previousPath: "lib/a.ts",
        additions: 1,
        deletions: 1,
      },
      {
        path: "scratch/notes.txt",
        status: "untracked",
        additions: 7,
        deletions: 0,
      },
      {
        path: "weird name.txt",
        status: "untracked",
        additions: 2,
        deletions: 0,
      },
    ]);
  });

  it("returns a clean tree when nothing changed", () => {
    const changes = parseChangesOutput(
      "MOGPLEX_BRANCH=main\nMOGPLEX_STATUS_BEGIN\nMOGPLEX_NUMSTAT_BEGIN\nMOGPLEX_UNTRACKED_BEGIN\n",
      null
    );
    expect(changes).toEqual({
      branch: "main",
      baseBranch: null,
      ahead: 0,
      behind: 0,
      files: [],
    });
  });
});

describe("scripts", () => {
  it("excludes the runtime directory from status and diffs", () => {
    const script = buildChangesStatusScript("main");
    expect(script).toContain("git status --porcelain=v1");
    expect(script).toContain(":(exclude).mogplex");
    expect(script).toContain("origin/");
  });

  it("rejects unsafe paths before they reach a shell", () => {
    expect(isSafeRepoPath("src/app.ts")).toBe(true);
    expect(isSafeRepoPath("/etc/passwd")).toBe(false);
    expect(isSafeRepoPath("../secret")).toBe(false);
    expect(isSafeRepoPath("src/../../x")).toBe(false);
    expect(isSafeRepoPath("")).toBe(false);
    expect(isSafeRepoPath("a\0b")).toBe(false);
    expect(() => buildFileDiffScript("../x")).toThrow("Invalid path");
    expect(() => buildRevertScript(["ok.ts", "/abs"])).toThrow("Invalid path");
  });

  it("quotes paths in the diff and revert scripts", () => {
    expect(buildFileDiffScript("weird name.txt")).toContain("'weird name.txt'");
    const revert = buildRevertScript(["a.ts", "it's.md"]);
    expect(revert).toContain("'a.ts'");
    expect(revert).toContain(`'it'\\''s.md'`);
    expect(revert).toContain("git checkout HEAD --");
  });

  it("never pushes to the base branch and derives the PR title from the message", () => {
    const script = buildCommitScript({
      message: "Fix header\n\nDetails here",
      baseBranch: "main",
      push: true,
      openPullRequest: true,
    });
    expect(script).toContain("git add -A -- . ':(exclude).mogplex'");
    expect(script).toContain("Refusing to push to the base branch");
    expect(script).toContain("git push -u origin");
    expect(script).toContain("--title 'Fix header'");
    expect(
      buildCommitScript({ message: "x", baseBranch: "main" })
    ).not.toContain("git push");
  });
});

describe("parseCommitOutput", () => {
  it("reads the markers the commit script prints", () => {
    expect(
      parseCommitOutput(
        "MOGPLEX_COMMITTED=true\nMOGPLEX_SHA=abc123\nMOGPLEX_PUSHED=true\nMOGPLEX_PULL_REQUEST_URL=https://github.com/o/r/pull/9\n"
      )
    ).toEqual({
      committed: true,
      sha: "abc123",
      pushed: true,
      pullRequestUrl: "https://github.com/o/r/pull/9",
    });
    expect(
      parseCommitOutput("MOGPLEX_COMMITTED=false\nMOGPLEX_SHA=def\n")
    ).toEqual({
      committed: false,
      sha: "def",
      pushed: false,
      pullRequestUrl: null,
    });
  });
});
