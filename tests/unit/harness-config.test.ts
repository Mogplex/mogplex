import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHarnessExecutionMode } from "../../lib/harness/claude-permissions";
import { HARNESSES } from "../../lib/harness/config";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

test("Claude Code buildCommand resumes an explicit session", () => {
  const command = HARNESSES["claude-code"].buildCommand("add tests", {
    resumeSessionId: "claude-session-123",
    mode: "AUTO",
  });

  assert.deepEqual(command, {
    cmd: "claude",
    args: [
      "--resume",
      "claude-session-123",
      "-p",
      "add tests",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Bash,Edit,Glob,Grep,LS,MultiEdit,Read,TodoWrite,Write",
      "--disallowedTools",
      "Task,WebFetch,WebSearch,NotebookEdit,Read(./.env),Read(./.env.*),Read(./**/.env),Read(./**/.env.*),Read(./secrets/**),Read(./supabase/.temp/**),Bash(curl *),Bash(wget *),Bash(nc *),Bash(netcat *),Bash(ssh *),Bash(scp *),Bash(rsync *),Bash(ftp *),Bash(telnet *),Bash(git push --force *),Bash(git push --force),Bash(git push --force-with-lease *),Bash(git push --force-with-lease),Bash(git push --force-with-lease=*),Bash(git push --force-if-includes *),Bash(git push -f *),Bash(git push -f),Bash(git push --mirror *),Bash(git push --delete *),Bash(git push -d *),Bash(git push * :*),Bash(git push * +*),Bash(git reset --hard *),Bash(git clean *),Bash(rm -rf *),Bash(shred *),Bash(dd *),Bash(sudo *)",
    ],
  });
});

test("Claude Code SAFE mode uses plan permissions with shared deny rules", () => {
  const command = HARNESSES["claude-code"].buildCommand("inspect the repo", {
    mode: "SAFE",
  });

  assert.deepEqual(command, {
    cmd: "claude",
    args: [
      "-p",
      "inspect the repo",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "plan",
      "--disallowedTools",
      "Task,WebFetch,WebSearch,NotebookEdit,Read(./.env),Read(./.env.*),Read(./**/.env),Read(./**/.env.*),Read(./secrets/**),Read(./supabase/.temp/**),Bash(curl *),Bash(wget *),Bash(nc *),Bash(netcat *),Bash(ssh *),Bash(scp *),Bash(rsync *),Bash(ftp *),Bash(telnet *),Bash(git push --force *),Bash(git push --force),Bash(git push --force-with-lease *),Bash(git push --force-with-lease),Bash(git push --force-with-lease=*),Bash(git push --force-if-includes *),Bash(git push -f *),Bash(git push -f),Bash(git push --mirror *),Bash(git push --delete *),Bash(git push -d *),Bash(git push * :*),Bash(git push * +*),Bash(git reset --hard *),Bash(git clean *),Bash(rm -rf *),Bash(shred *),Bash(dd *),Bash(sudo *)",
    ],
  });
});

test("Claude Code YOLO mode bypasses prompts but keeps deny rules", () => {
  const command = HARNESSES["claude-code"].buildCommand("fix the tests", {
    mode: "YOLO",
  });

  assert.deepEqual(command, {
    cmd: "claude",
    args: [
      "-p",
      "fix the tests",
      "--verbose",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--disallowedTools",
      "Task,WebFetch,WebSearch,NotebookEdit,Read(./.env),Read(./.env.*),Read(./**/.env),Read(./**/.env.*),Read(./secrets/**),Read(./supabase/.temp/**),Bash(curl *),Bash(wget *),Bash(nc *),Bash(netcat *),Bash(ssh *),Bash(scp *),Bash(rsync *),Bash(ftp *),Bash(telnet *),Bash(git push --force *),Bash(git push --force),Bash(git push --force-with-lease *),Bash(git push --force-with-lease),Bash(git push --force-with-lease=*),Bash(git push --force-if-includes *),Bash(git push -f *),Bash(git push -f),Bash(git push --mirror *),Bash(git push --delete *),Bash(git push -d *),Bash(git push * :*),Bash(git push * +*),Bash(git reset --hard *),Bash(git clean *),Bash(rm -rf *),Bash(shred *),Bash(dd *),Bash(sudo *)",
    ],
  });
});

test("Harness execution mode normalization is case-insensitive and defaults to AUTO", () => {
  assert.equal(normalizeHarnessExecutionMode(" safe "), "SAFE");
  assert.equal(normalizeHarnessExecutionMode("yolo"), "YOLO");
  assert.equal(normalizeHarnessExecutionMode("auto"), "AUTO");
  assert.equal(normalizeHarnessExecutionMode("unknown"), "AUTO");
  assert.equal(normalizeHarnessExecutionMode(null), "AUTO");
});

test("Codex buildCommand uses exec mode and resume subcommand", () => {
  const initial = HARNESSES.codex.buildCommand("fix the bug");
  const resumed = HARNESSES.codex.buildCommand("ship the follow-up", {
    resumeSessionId: "123e4567-e89b-12d3-a456-426614174000",
  });

  assert.deepEqual(initial, {
    cmd: "codex",
    args: ["exec", "--json", "fix the bug"],
  });
  assert.deepEqual(resumed, {
    cmd: "codex",
    args: [
      "exec",
      "resume",
      "--json",
      "123e4567-e89b-12d3-a456-426614174000",
      "ship the follow-up",
    ],
  });
});

test("Claude Code buildCommand injects --mcp-config and --strict-mcp-config when path is provided", () => {
  const command = HARNESSES["claude-code"].buildCommand("do it", {
    mode: "AUTO",
    mcpConfigPath: ".mcp.json",
  });

  assert.ok(command.args.includes("--mcp-config"));
  const flagIdx = command.args.indexOf("--mcp-config");
  assert.equal(command.args[flagIdx + 1], ".mcp.json");
  assert.ok(command.args.includes("--strict-mcp-config"));
});

test("Claude Code buildCommand omits MCP flags when no path is provided", () => {
  const command = HARNESSES["claude-code"].buildCommand("do it", {
    mode: "AUTO",
  });

  assert.ok(!command.args.includes("--mcp-config"));
  assert.ok(!command.args.includes("--strict-mcp-config"));
});

test("Codex buildCommand ignores mcpConfigPath (handled separately)", () => {
  const command = HARNESSES.codex.buildCommand("do it", {
    mcpConfigPath: ".mcp.json",
  });

  assert.deepEqual(command, {
    cmd: "codex",
    args: ["exec", "--json", "do it"],
  });
});

test("Harness packages stay pinned to explicit semver versions", () => {
  assert.match(HARNESSES["claude-code"].version, SEMVER_PATTERN);
  assert.match(HARNESSES.codex.version, SEMVER_PATTERN);
  assert.notEqual(HARNESSES["claude-code"].version, "latest");
  assert.notEqual(HARNESSES.codex.version, "latest");
});
