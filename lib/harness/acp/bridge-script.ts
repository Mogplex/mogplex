/**
 * The ACP client that runs inside the sandbox. Mogplex writes it next to the
 * checkout and launches it as the harness command: it starts the agent's ACP
 * server over stdio, opens or resumes a session, sends one prompt, answers the
 * agent's permission requests by the run's policy, and prints every protocol
 * event to stdout as one JSON line tagged `mogplex_acp` for
 * `lib/harness/acp/renderer.ts`.
 *
 * It is plain Node (no dependencies) because the sandbox has only the agent
 * package installed. The source avoids template literals so it can live in
 * this string.
 */
export const ACP_BRIDGE_SCRIPT = String.raw`// Mogplex ACP bridge. Generated from lib/harness/acp/bridge-script.ts.
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const PROTOCOL_VERSION = 1;
const TEXT_FLUSH_MS = 150;
const runPath = process.argv[2];
const run = JSON.parse(readFileSync(runPath, "utf8"));
try { rmSync(runPath, { force: true }); } catch {}

function write(event) {
  process.stdout.write(JSON.stringify(Object.assign({ mogplex_acp: 1 }, event)) + "\n");
}
// First output of the process, so readers can tell this format apart before
// anything else (including the agent's stderr) arrives.
write({ type: "start" });

// Agents stream text a few characters at a time. Merge consecutive chunks of
// one message so the log carries sentences, not tokens.
let pendingText = null;
let flushTimer = null;
function flushText() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!pendingText) return;
  write({ type: "update", update: pendingText });
  pendingText = null;
}
function emit(event) {
  flushText();
  write(event);
}
function emitUpdate(update) {
  const kind = update && update.sessionUpdate;
  const isText = (kind === "agent_message_chunk" || kind === "agent_thought_chunk") &&
    update.content && update.content.type === "text";
  if (!isText) { emit({ type: "update", update }); return; }
  if (pendingText && pendingText.sessionUpdate === kind && pendingText.messageId === update.messageId) {
    pendingText.content.text += update.content.text;
  } else {
    flushText();
    pendingText = { sessionUpdate: kind, messageId: update.messageId, content: { type: "text", text: update.content.text } };
  }
  if (!flushTimer) flushTimer = setTimeout(flushText, TEXT_FLUSH_MS);
}

function readMcpServers(path) {
  if (!path) return [];
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // The run asked for these servers; say so instead of silently starting
    // the agent without its connections.
    process.stderr.write("[acp-bridge] could not read MCP config " + path + ": " + errorText(error) + "\n");
    return [];
  }
  const pairs = (record) => Object.entries(record || {}).map(([name, value]) => ({ name, value: String(value) }));
  return Object.entries(config.mcpServers || {}).map(([name, server]) =>
    server.type === "http" || server.type === "sse"
      ? { type: server.type, name, url: server.url, headers: pairs(server.headers) }
      : { name, command: server.command, args: server.args || [], env: pairs(server.env) }
  );
}

// The agent authenticates through the bridge (see authenticate), so it and
// the commands it runs never need the model key in their environment.
const agentEnv = Object.assign({}, process.env);
if (run.auth && run.auth.apiKeyEnv) delete agentEnv[run.auth.apiKeyEnv];
const agent = spawn(run.agent.command, run.agent.args || [], {
  cwd: run.cwd,
  env: agentEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
agent.stderr.pipe(process.stderr);
agent.stdin.on("error", () => {});

let nextId = 1;
const pending = new Map();
const mcpToolCalls = new Set();
let sessionId = null;
let replaying = false;
let finished = false;

function send(message) {
  agent.stdin.write(JSON.stringify(Object.assign({ jsonrpc: "2.0" }, message)) + "\n");
}
function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
function errorText(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}

// MCP tools come from connections the user set to run without asking, so
// they are approved. Everything else follows the run mode: "allow", or
// "decline". Declining prefers an option that lets the turn go on; when the
// agent offers only one that stops the turn, the bridge picks it and then
// tells the agent to continue without the action (see runTurns).
const CONTINUING_REJECTIONS = ["decline", "reject_permissions"];
let declinedByStopping = false;
function choosePermission(params) {
  const options = params.options || [];
  const toolCall = params.toolCall || {};
  const isMcp = Boolean(params._meta && params._meta.is_mcp_tool_approval) ||
    mcpToolCalls.has(toolCall.toolCallId);
  const policy = isMcp ? run.permissions.mcp : run.permissions.other;
  const byKind = (kind) => options.find((option) => option.kind === kind);
  if (policy === "allow") return { policy, option: byKind("allow_once") || byKind("allow_always") || null };
  const continuing = options.find((option) => CONTINUING_REJECTIONS.includes(option.optionId));
  const option = continuing || byKind("reject_once") || byKind("reject_always") || null;
  if (!continuing) declinedByStopping = true;
  return { policy, option };
}

function handleAgentRequest(message) {
  if (message.method !== "session/request_permission") {
    send({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
    return;
  }
  const params = message.params || {};
  const decision = choosePermission(params);
  emit({
    type: "permission",
    toolCall: params.toolCall || null,
    policy: decision.policy,
    outcome: decision.option ? decision.option.kind : "cancelled",
    optionName: decision.option ? decision.option.name : null,
  });
  send({
    id: message.id,
    result: { outcome: decision.option ? { outcome: "selected", optionId: decision.option.optionId } : { outcome: "cancelled" } },
  });
}

function handleLine(line) {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch {
    process.stderr.write("[acp-bridge] non-JSON agent output: " + line + "\n");
    return;
  }
  if (message.id !== undefined && message.method === undefined) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(message.error);
    else entry.resolve(message.result || {});
    return;
  }
  if (message.id !== undefined) { handleAgentRequest(message); return; }
  if (message.method !== "session/update" || replaying) return;
  const update = message.params && message.params.update;
  if (!update) return;
  if (update.toolCallId && update._meta && update._meta.is_mcp_tool_call) mcpToolCalls.add(update.toolCallId);
  emitUpdate(update);
}

let buffer = "";
agent.stdout.setEncoding("utf8");
agent.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) handleLine(line);
});

// Let the agent shut down (and finish writing its session) before exiting,
// so the next turn in this sandbox resumes from complete state.
const SHUTDOWN_GRACE_MS = 5000;
let agentExited = false;
function exitAfterAgent(code) {
  agent.stdin.end();
  if (agentExited) process.exit(code);
  agent.once("exit", () => process.exit(code));
  agent.kill("SIGTERM");
  setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS).unref();
}
function fail(message, code) {
  if (finished) return;
  finished = true;
  emit({ type: "error", message });
  exitAfterAgent(code || 1);
}
agent.on("exit", (code, signal) => {
  agentExited = true;
  if (!finished) fail("The agent exited before the turn finished (" + (signal || code) + ")");
});
agent.on("error", (error) => fail("The agent failed to start: " + error.message));
let interrupted = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    interrupted = true;
    if (sessionId) send({ method: "session/cancel", params: { sessionId } });
    setTimeout(() => fail("Cancelled", 130), 3000).unref();
  });
}

async function resumeSession(init, base) {
  const caps = init.agentCapabilities || {};
  const sessionCaps = caps.sessionCapabilities || {};
  const resumeId = run.resumeSessionId;
  if (sessionCaps.resume) {
    const result = await request("session/resume", Object.assign({}, base, { sessionId: resumeId }));
    return Object.assign({ sessionId: resumeId }, result);
  }
  if (!caps.loadSession) throw new Error("The agent cannot resume sessions");
  replaying = true;
  try {
    const result = await request("session/load", Object.assign({}, base, { sessionId: resumeId }));
    return Object.assign({ sessionId: resumeId }, result);
  } finally {
    replaying = false;
  }
}

async function openSession(init) {
  const base = { cwd: run.cwd, mcpServers: readMcpServers(run.mcpConfigPath) };
  if (run.resumeSessionId) {
    try {
      return await resumeSession(init, base);
    } catch (error) {
      emit({ type: "resume_failed", sessionId: run.resumeSessionId, message: errorText(error) });
    }
  }
  return await request("session/new", base);
}

async function applyMode(session) {
  if (!run.modeId) return;
  const hasModeOption = (session.configOptions || []).some((option) => option.id === "mode");
  try {
    if (hasModeOption) {
      await request("session/set_config_option", { sessionId, configId: "mode", value: run.modeId });
    } else if (session.modes) {
      await request("session/set_mode", { sessionId, modeId: run.modeId });
    }
  } catch (error) {
    process.stderr.write("[acp-bridge] could not set mode " + run.modeId + ": " + errorText(error) + "\n");
  }
}

// A model gateway is configured in the agent's memory for this process only:
// the key is read from the environment and never written to disk.
async function authenticate() {
  const auth = run.auth;
  if (!auth || auth.type !== "gateway") return;
  const key = process.env[auth.apiKeyEnv];
  if (!key) throw new Error(auth.apiKeyEnv + " is not set");
  await request("authenticate", {
    methodId: "gateway",
    _meta: { gateway: { baseUrl: auth.baseUrl, providerName: auth.providerName, headers: { Authorization: "Bearer " + key } } },
  });
}

const CONTINUE_PROMPT = "The action you just asked permission for was declined. This run cannot grant " +
  "access beyond its sandbox and nobody is available to approve it, so do not ask again. " +
  "Continue the task without it, and say in your final answer what you could not do.";

// A turn the bridge stopped only to decline a request resumes with the
// decline as the next message, the way a person answering "No, and tell
// Codex what to do differently" would. A stop the run asked for never does.
async function runTurns() {
  let text = run.prompt;
  for (;;) {
    declinedByStopping = false;
    const result = await request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
    if (result.stopReason !== "cancelled" || !declinedByStopping || interrupted) return result;
    emit({ type: "continued", reason: "declined" });
    text = CONTINUE_PROMPT;
  }
}

async function main() {
  const init = await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
      auth: { _meta: { gateway: true } },
    },
    clientInfo: { name: "mogplex", version: "1" },
  });
  emit({ type: "initialize", agentInfo: init.agentInfo || null });
  await authenticate();
  const session = await openSession(init);
  sessionId = session.sessionId;
  emit({ type: "session", sessionId });
  await applyMode(session);
  const result = await runTurns();
  finished = true;
  emit({ type: "done", stopReason: result.stopReason || null, usage: result.usage || null });
  const succeeded = ["end_turn", "max_tokens", "max_turn_requests"].includes(result.stopReason);
  exitAfterAgent(succeeded ? 0 : result.stopReason === "cancelled" ? 130 : 1);
}

main().catch((error) => fail(errorText(error)));
`;
