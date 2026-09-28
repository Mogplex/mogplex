import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acpPermissionPolicy } from "./agent";
import { ACP_BRIDGE_SCRIPT } from "./bridge-script";
import type { AcpRunConfig } from "./launch";

// A scripted ACP agent: answers the bridge's requests, streams one turn, and
// asks for two permissions. It logs what it received for the assertions.
const FAKE_AGENT = String.raw`
const fs = require("node:fs");
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + "\n");
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
let nextId = 1000;
const waiting = new Map();
let promptId = null;
const ask = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  waiting.set(id, resolve);
  send({ id, method, params });
});
const update = (sessionId, body) => send({ method: "session/update", params: { sessionId, update: body } });

let prompts = 0;
async function prompt(id, params) {
  promptId = id;
  prompts += 1;
  const sid = params.sessionId;
  if (process.env.FAKE_HANG) return;
  if (process.env.FAKE_CANCEL_ONLY) {
    // Codex offers no "continue without it" for an escalation: only cancel.
    if (prompts > 1) { send({ id, result: { stopReason: "end_turn" } }); return; }
    const response = await ask("session/request_permission", {
      sessionId: sid,
      toolCall: { toolCallId: "t-escalate", kind: "execute", status: "pending" },
      options: [
        { optionId: "allow_once", name: "Yes", kind: "allow_once" },
        { optionId: "cancel", name: "No, and tell Codex what to do differently", kind: "reject_once" },
      ],
    });
    log({ decision: "escalation", response });
    send({ id, result: { stopReason: response.outcome.optionId === "cancel" ? "cancelled" : "end_turn" } });
    return;
  }
  update(sid, { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Hel" } });
  update(sid, { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "lo" } });
  update(sid, { sessionUpdate: "tool_call", toolCallId: "t-mcp", kind: "execute", status: "in_progress", _meta: { is_mcp_tool_call: true }, rawInput: { server: "docs", tool: "search" } });
  log({ decision: "mcp", response: await ask("session/request_permission", {
    sessionId: sid,
    toolCall: { toolCallId: "t-mcp", kind: "execute", status: "pending" },
    _meta: { is_mcp_tool_approval: true },
    options: [
      { optionId: "allow_once", name: "Allow", kind: "allow_once" },
      { optionId: "cancel", name: "Cancel", kind: "reject_once" },
    ],
  }) });
  log({ decision: "command", response: await ask("session/request_permission", {
    sessionId: sid,
    toolCall: { toolCallId: "t-cmd", kind: "execute", status: "pending" },
    options: [
      { optionId: "allow_once", name: "Yes", kind: "allow_once" },
      { optionId: "allow_for_session", name: "Always", kind: "allow_always" },
      { optionId: "decline", name: "No, continue without running it", kind: "reject_once" },
      { optionId: "cancel", name: "No, and stop", kind: "reject_once" },
    ],
  }) });
  send({ id, result: { stopReason: "end_turn" } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === undefined) { waiting.get(message.id)?.(message.result); continue; }
    log({ method: message.method, params: message.params });
    if (message.method === "authenticate") {
      log({ agentEnvHasKey: Boolean(process.env.CODEX_API_KEY) });
      send({ id: message.id, result: {} });
    } else if (message.method === "initialize") {
      send({ id: message.id, result: { protocolVersion: 1, agentInfo: { name: "fake-agent", version: "1" }, agentCapabilities: { sessionCapabilities: { resume: {} } } } });
    } else if (message.method === "session/resume") {
      if (process.env.FAKE_RESUME_FAIL) send({ id: message.id, error: { code: -32002, message: "no rollout found for thread id " + message.params.sessionId } });
      else send({ id: message.id, result: { configOptions: [{ id: "mode" }] } });
    } else if (message.method === "session/new") {
      send({ id: message.id, result: { sessionId: "fresh-session", configOptions: [{ id: "mode" }] } });
    } else if (message.method === "session/set_config_option") {
      send({ id: message.id, result: {} });
    } else if (message.method === "session/prompt") {
      prompt(message.id, message.params);
    } else if (message.method === "session/cancel") {
      send({ id: promptId, result: { stopReason: "cancelled" } });
    }
  }
});
`;

type BridgeRun = {
  events: Array<Record<string, unknown>>;
  agentLog: Array<Record<string, unknown>>;
  exitCode: number | null;
  runPath: string;
  stderr: string;
};

let workDir: string | null = null;

afterEach(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
  workDir = null;
});

async function runBridge(
  overrides: Partial<AcpRunConfig>,
  options: {
    env?: Record<string, string>;
    interruptAfterSession?: boolean;
  } = {}
): Promise<BridgeRun> {
  workDir = await mkdtemp(path.join(tmpdir(), "acp-bridge-"));
  const bridgePath = path.join(workDir, "bridge.mjs");
  const agentPath = path.join(workDir, "agent.cjs");
  const runPath = path.join(workDir, "run.json");
  const mcpPath = path.join(workDir, "mcp.json");
  const logPath = path.join(workDir, "agent.log");
  await writeFile(bridgePath, ACP_BRIDGE_SCRIPT);
  await writeFile(agentPath, FAKE_AGENT);
  await writeFile(logPath, "");
  await writeFile(
    mcpPath,
    JSON.stringify({
      mcpServers: {
        docs: {
          type: "http",
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer connection-token" },
        },
        trigger: {
          command: "npx",
          args: ["-y", "trigger-mcp"],
          env: { TRIGGER_TOKEN: "stdio-token" },
        },
      },
    })
  );
  const config: AcpRunConfig = {
    agent: { command: process.execPath, args: [agentPath] },
    cwd: workDir,
    prompt: "Fix the bug",
    modeId: "workspace-write",
    resumeSessionId: null,
    mcpConfigPath: mcpPath,
    permissions: acpPermissionPolicy("AUTO"),
    auth: {
      type: "gateway",
      baseUrl: "https://gateway.example.test/codex/v1",
      providerName: "Test Gateway",
      apiKeyEnv: "CODEX_API_KEY",
    },
    ...overrides,
  };
  await writeFile(runPath, JSON.stringify(config));

  const child = spawn(process.execPath, [bridgePath, runPath], {
    env: {
      ...process.env,
      FAKE_LOG: logPath,
      CODEX_API_KEY: "model-key-fixture",
      ...options.env,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    if (options.interruptAfterSession && stdout.includes('"type":"session"')) {
      options.interruptAfterSession = false;
      // Let the prompt request reach the agent before interrupting.
      setTimeout(() => child.kill("SIGTERM"), 200);
    }
  });
  const exitCode = await new Promise<number | null>((resolve) =>
    child.on("exit", (code) => resolve(code))
  );
  const parseLines = (text: string) =>
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return {
    events: parseLines(stdout),
    agentLog: parseLines(await readFile(logPath, "utf8")),
    exitCode,
    runPath,
    stderr,
  };
}

const requestParams = (run: BridgeRun, method: string) =>
  run.agentLog.find((entry) => entry.method === method)?.params as
    | Record<string, unknown>
    | undefined;

describe("ACP bridge script", () => {
  it("should open a session with the run's MCP servers, set its mode, and send the prompt", async () => {
    const run = await runBridge({});

    expect(run.exitCode).toBe(0);
    expect(requestParams(run, "session/new")).toEqual({
      cwd: expect.any(String),
      mcpServers: [
        {
          type: "http",
          name: "docs",
          url: "https://mcp.example.test/mcp",
          headers: [
            { name: "Authorization", value: "Bearer connection-token" },
          ],
        },
        {
          name: "trigger",
          command: "npx",
          args: ["-y", "trigger-mcp"],
          env: [{ name: "TRIGGER_TOKEN", value: "stdio-token" }],
        },
      ],
    });
    expect(requestParams(run, "session/set_config_option")).toEqual({
      sessionId: "fresh-session",
      configId: "mode",
      value: "workspace-write",
    });
    expect(requestParams(run, "session/prompt")).toEqual({
      sessionId: "fresh-session",
      prompt: [{ type: "text", text: "Fix the bug" }],
    });
    // The prompt travels in a file the bridge removes once read.
    expect(existsSync(run.runPath)).toBe(false);
  });

  it("should sign the agent in to the model gateway without handing it the key", async () => {
    const run = await runBridge({});

    expect(requestParams(run, "authenticate")).toEqual({
      methodId: "gateway",
      _meta: {
        gateway: {
          baseUrl: "https://gateway.example.test/codex/v1",
          providerName: "Test Gateway",
          headers: { Authorization: "Bearer model-key-fixture" },
        },
      },
    });
    expect(run.agentLog).toContainEqual({ agentEnvHasKey: false });
    const methods = run.agentLog.map((entry) => entry.method).filter(Boolean);
    expect(methods.indexOf("authenticate")).toBeLessThan(
      methods.indexOf("session/new")
    );
  });

  it("should fail the run when the model key is missing", async () => {
    const run = await runBridge({}, { env: { CODEX_API_KEY: "" } });

    expect(run.exitCode).toBe(1);
    expect(run.events.at(-1)).toMatchObject({
      type: "error",
      message: "CODEX_API_KEY is not set",
    });
  });

  it("should approve MCP tools and decline other requests without ending the turn in AUTO", async () => {
    const run = await runBridge({});

    const decisions = run.agentLog.filter((entry) => entry.decision);
    expect(decisions).toEqual([
      {
        decision: "mcp",
        response: { outcome: { outcome: "selected", optionId: "allow_once" } },
      },
      {
        decision: "command",
        response: { outcome: { outcome: "selected", optionId: "decline" } },
      },
    ]);
    expect(run.events.filter((event) => event.type === "permission")).toEqual([
      expect.objectContaining({ policy: "allow", outcome: "allow_once" }),
      expect.objectContaining({
        policy: "decline",
        outcome: "reject_once",
        optionName: "No, continue without running it",
      }),
    ]);
  });

  it("should continue the task when declining meant stopping the turn", async () => {
    const run = await runBridge({}, { env: { FAKE_CANCEL_ONLY: "1" } });

    expect(
      run.agentLog.find((entry) => entry.decision === "escalation")?.response
    ).toEqual({
      outcome: { outcome: "selected", optionId: "cancel" },
    });
    const prompts = run.agentLog.filter(
      (entry) => entry.method === "session/prompt"
    );
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1].params)).toContain("was declined");
    expect(run.events).toContainEqual({
      mogplex_acp: 1,
      type: "continued",
      reason: "declined",
    });
    expect(run.events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "end_turn",
    });
    expect(run.exitCode).toBe(0);
  });

  it("should allow every request in YOLO", async () => {
    const run = await runBridge({ permissions: acpPermissionPolicy("YOLO") });

    const command = run.agentLog.find((entry) => entry.decision === "command");
    expect(command?.response).toEqual({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  it("should print tagged events with streamed text merged per message", async () => {
    const run = await runBridge({});

    expect(run.events[0]).toEqual({ mogplex_acp: 1, type: "start" });
    expect(run.events.map((event) => event.type)).toEqual([
      "start",
      "initialize",
      "session",
      "update",
      "update",
      "permission",
      "permission",
      "done",
    ]);
    expect(run.events[3]).toMatchObject({
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "m1",
        content: { type: "text", text: "Hello" },
      },
    });
    expect(run.events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "end_turn",
    });
  });

  it("should resume the requested session", async () => {
    const run = await runBridge({ resumeSessionId: "earlier-session" });

    expect(requestParams(run, "session/resume")).toMatchObject({
      sessionId: "earlier-session",
    });
    expect(requestParams(run, "session/new")).toBeUndefined();
    expect(run.events).toContainEqual({
      mogplex_acp: 1,
      type: "session",
      sessionId: "earlier-session",
    });
  });

  it("should start a fresh session when the agent cannot resume the old one", async () => {
    const run = await runBridge(
      { resumeSessionId: "missing-session" },
      { env: { FAKE_RESUME_FAIL: "1" } }
    );

    expect(run.exitCode).toBe(0);
    expect(run.events).toContainEqual(
      expect.objectContaining({
        type: "resume_failed",
        sessionId: "missing-session",
        message: expect.stringContaining("no rollout found"),
      })
    );
    expect(run.events).toContainEqual({
      mogplex_acp: 1,
      type: "session",
      sessionId: "fresh-session",
    });
  });

  it("should warn and start without MCP servers when the MCP config cannot be read", async () => {
    const run = await runBridge({ mcpConfigPath: "/nonexistent/mcp.json" });

    expect(run.exitCode).toBe(0);
    expect(requestParams(run, "session/new")).toMatchObject({ mcpServers: [] });
    expect(run.stderr).toContain(
      "[acp-bridge] could not read MCP config /nonexistent/mcp.json"
    );
  });

  it("should cancel the ACP turn when the harness command is stopped", async () => {
    const run = await runBridge(
      {},
      { env: { FAKE_HANG: "1" }, interruptAfterSession: true }
    );

    expect(run.agentLog.map((entry) => entry.method)).toContain(
      "session/cancel"
    );
    expect(run.exitCode).toBe(130);
    expect(run.events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "cancelled",
    });
  });
});
