/* eslint-disable sonarjs/hashing, unicorn/number-literal-case, unicorn/numeric-separators-style, init-declarations, sonarjs/destructuring-assignment-syntax, id-length, unicorn/prefer-string-raw, prefer-template, sonarjs/too-many-break-or-continue-in-loop, unicorn/catch-error-name, no-continue, no-console, prettier/prettier */
// Mogplex terminal bridge runtime. Runs inside the Vercel sandbox, attaches a
// PTY-backed tmux client to a named session, and brokers it to a browser over
// a single WebSocket. The tmux session outlives socket disconnects while the
// sandbox remains running, so reconnects reattach to the same terminal state.
//
// Protocol:
//   Client → Server
//     - Binary frame: raw keystroke bytes, written directly to PTY stdin.
//     - Text frame  : JSON. Supported types: {type:"resize",cols,rows}, {type:"ping"}.
//   Server → Client
//     - Binary frame: raw PTY stdout/stderr bytes.
//     - Text frame  : JSON. Supported types: {type:"exit",code}, {type:"error",error}, {type:"pong"}.
//
// Auth: a `token` query param is compared (timing-safe) against the env-provided
// MOGPLEX_TERMINAL_BRIDGE_TOKEN. When no token is set, the bridge is open.

import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readdirSync, readlinkSync } from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WS_FIN_BIT = 0x80;
const WS_MASK_BIT = 0x80;
const WS_OPCODE_MASK = 0x0f;
const WS_LEN7_MASK = 0x7f;
const WS_EXTENDED_LEN_16 = 0x10000;

export const WS_OPCODE_CONTINUATION = 0x0;
export const WS_OPCODE_TEXT = 0x1;
export const WS_OPCODE_BINARY = 0x2;
export const WS_OPCODE_CLOSE = 0x8;
export const WS_OPCODE_PING = 0x9;
export const WS_OPCODE_PONG = 0xa;

const TTY_RESOLVE_ATTEMPTS = 20;
const TTY_RESOLVE_DELAY_MS = 50;
const MAX_PENDING_BYTES = 16 * 1024 * 1024; // 16 MiB guard against runaway buffering

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function buildWsAccept(key) {
  // SHA-1 is mandated by RFC 6455 §4.2.2 for the handshake accept value.
   
  const hash = createHash("sha1");
  hash.update(`${String(key).trim()}${WS_GUID}`);
  return hash.digest("base64");
}

export function encodeWsFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(String(payload), "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = WS_FIN_BIT | (opcode & WS_OPCODE_MASK);
    header[1] = len;
  } else if (len < WS_EXTENDED_LEN_16) {
    header = Buffer.alloc(4);
    header[0] = WS_FIN_BIT | (opcode & WS_OPCODE_MASK);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = WS_FIN_BIT | (opcode & WS_OPCODE_MASK);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

export function decodeWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const byte1 = buffer[0];
  const byte2 = buffer[1];
  const fin = (byte1 & WS_FIN_BIT) !== 0;
  const opcode = byte1 & WS_OPCODE_MASK;
  const masked = (byte2 & WS_MASK_BIT) !== 0;
  let len = byte2 & WS_LEN7_MASK;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < offset + 2) return null;
    len = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(MAX_PENDING_BYTES)) {
      throw new Error("ws frame exceeds max size");
    }
    len = Number(big);
    offset += 8;
  }
  let mask = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + len) return null;
  let payload = buffer.subarray(offset, offset + len);
  if (masked && mask) {
    const unmasked = Buffer.alloc(len);
    for (let i = 0; i < len; i += 1) {
      unmasked[i] = payload[i] ^ mask[i & 3];
    }
    payload = unmasked;
  }
  return {
    fin,
    opcode,
    payload,
    rest: buffer.subarray(offset + len),
  };
}

export function parseControlMessage(text) {
  let msg;
  try {
    msg = JSON.parse(String(text));
  } catch {
    return { ok: false, error: "invalid json" };
  }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
    return { ok: false, error: "missing type" };
  }
  if (msg.type === "resize") {
    const cols = Number(msg.cols);
    const rows = Number(msg.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
      return { ok: false, error: "invalid resize dimensions" };
    }
    return { ok: true, message: { type: "resize", cols: Math.floor(cols), rows: Math.floor(rows) } };
  }
  if (msg.type === "ping") {
    return { ok: true, message: { type: "ping" } };
  }
  return { ok: false, error: `unknown type: ${msg.type}` };
}

// Timing-safe token compare. Returns false when either side is empty so a
// misconfigured bridge doesn't accidentally accept all connections.
export function tokensMatch(actual, expected) {
  if (!actual || !expected) return false;
  const a = Buffer.from(String(actual));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildTmuxSessionName(value) {
  const rawValue =
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : "default";
  const digest = createHash("sha256").update(rawValue).digest("hex");
  return `mogplex-${digest.slice(0, 24)}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", String.raw`'\''`)}'`;
}

export function buildTmuxShellCommand({ cwd, sessionKey }) {
  const tmuxSessionName = buildTmuxSessionName(sessionKey);
  const startDirectory =
    typeof cwd === "string" && cwd.trim().length > 0 ? cwd.trim() : process.cwd();
  return [
    "export TERM=xterm-256color",
    `if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -s ${shellQuote(
      tmuxSessionName
    )} -c ${shellQuote(startDirectory)}; fi`,
    `cd ${shellQuote(startDirectory)} || exit 1`,
    `printf '%s\\n' ${shellQuote(
      "[mogplex] tmux unavailable; running plain shell without session persistence"
    )}`,
    'if [ -n "$SHELL" ]; then exec "$SHELL" -il; fi',
    "exec /bin/sh -il",
  ].join("; ");
}

// ---------------------------------------------------------------------------
// Runtime (not exported — main entrypoint at the bottom of the file)
// ---------------------------------------------------------------------------

function discoverTtyPath(pid) {
  try {
    const dir = `/proc/${pid}/fd`;
    for (const entry of readdirSync(dir)) {
      try {
        const target = readlinkSync(`${dir}/${entry}`);
        if (target.startsWith("/dev/pts/")) return target;
      } catch {
        // ignore unreadable fd entries
      }
    }
  } catch {
    // ignore /proc lookup failures
  }
  return null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTtyPath(pid) {
  for (let attempt = 0; attempt < TTY_RESOLVE_ATTEMPTS; attempt += 1) {
    const ttyPath = discoverTtyPath(pid);
    if (ttyPath) return ttyPath;
    await wait(TTY_RESOLVE_DELAY_MS);
  }
  return null;
}

async function resizePty(ttyPath, cols, rows) {
  if (!ttyPath) return;
  await new Promise((resolve) => {
    const child = spawn("stty", [
      "-F",
      ttyPath,
      "cols",
      String(cols),
      "rows",
      String(rows),
    ]);
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

function spawnInteractiveShell(cwd, sessionKey) {
  const shellCmd = buildTmuxShellCommand({ cwd, sessionKey });
  return spawn("script", ["-qf", "-c", shellCmd, "/dev/null"], {
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });
}

function startBridge({ port, token, logger = console }) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          pid: process.pid,
          uptimeSec: Math.floor(process.uptime()),
        })
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== "/session") {
      socket.destroy();
      return;
    }
    if (token && !tokensMatch(url.searchParams.get("token") || "", token)) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"
      );
      socket.destroy();
      return;
    }
    const wsKey = req.headers["sec-websocket-key"];
    if (!wsKey || typeof wsKey !== "string") {
      socket.destroy();
      return;
    }
    const accept = buildWsAccept(wsKey);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
      ].join("\r\n") + "\r\n\r\n"
    );

    handleSession({
      socket,
      head,
      cwd: url.searchParams.get("cwd") || process.cwd(),
      sessionKey: url.searchParams.get("session") || "default",
      logger,
    });
  });

  server.listen(port, () => {
    logger.info?.(`[mogplex-terminal-bridge] listening on ${port}`);
  });

  return server;
}

function handleSession({ socket, head, cwd, sessionKey, logger }) {
  const child = spawnInteractiveShell(cwd, sessionKey);
  let buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;
  let ttyPath = null;

  void resolveTtyPath(child.pid).then((p) => {
    ttyPath = p;
  });

  const sendText = (obj) => {
    if (closed) return;
    try {
      socket.write(encodeWsFrame(WS_OPCODE_TEXT, JSON.stringify(obj)));
    } catch {
      /* socket gone */
    }
  };

  const sendBinary = (data) => {
    if (closed) return;
    try {
      socket.write(encodeWsFrame(WS_OPCODE_BINARY, data));
    } catch {
      /* socket gone */
    }
  };

  const closeAll = (reason) => {
    if (closed) return;
    closed = true;
    try {
      socket.write(encodeWsFrame(WS_OPCODE_CLOSE, Buffer.alloc(0)));
    } catch {
      /* ignore */
    }
    try {
      socket.end();
    } catch {
      /* ignore */
    }
    if (!child.killed) {
      try {
        child.kill("SIGHUP");
      } catch {
        /* ignore */
      }
    }
    logger.info?.(`[mogplex-terminal-bridge] session closed: ${reason}`);
  };

  child.stdout?.on("data", (chunk) => sendBinary(chunk));
  child.stderr?.on("data", (chunk) => sendBinary(chunk));
  child.on("exit", (code) => {
    sendText({ type: "exit", code: code ?? 0 });
    closeAll(`shell exit code=${code}`);
  });
  child.on("error", (err) => {
    sendText({ type: "error", error: err.message });
    closeAll(`shell error: ${err.message}`);
  });

  socket.on("data", (chunk) => {
    if (buffer.length + chunk.length > MAX_PENDING_BYTES) {
      sendText({ type: "error", error: "input buffer overflow" });
      closeAll("buffer overflow");
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      let frame;
      try {
        frame = decodeWsFrame(buffer);
      } catch (err) {
        sendText({ type: "error", error: err.message });
        closeAll(`frame error: ${err.message}`);
        return;
      }
      if (!frame) return;
      buffer = frame.rest;

      if (frame.opcode === WS_OPCODE_CLOSE) {
        closeAll("client close");
        return;
      }
      if (frame.opcode === WS_OPCODE_PING) {
        socket.write(encodeWsFrame(WS_OPCODE_PONG, frame.payload));
        continue;
      }
      if (frame.opcode === WS_OPCODE_PONG) continue;
      if (frame.opcode === WS_OPCODE_BINARY) {
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write(frame.payload);
        }
        continue;
      }
      if (frame.opcode === WS_OPCODE_TEXT) {
        const parsed = parseControlMessage(frame.payload.toString("utf8"));
        if (!parsed.ok) {
          sendText({ type: "error", error: parsed.error });
          continue;
        }
        if (parsed.message.type === "resize") {
          void resizePty(ttyPath, parsed.message.cols, parsed.message.rows);
          continue;
        }
        if (parsed.message.type === "ping") {
          sendText({ type: "pong" });
          continue;
        }
      }
    }
  });

  socket.on("close", () => closeAll("socket closed"));
  socket.on("error", (err) => closeAll(`socket error: ${err.message}`));
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function main() {
  const port = Number(process.env.MOGPLEX_TERMINAL_BRIDGE_PORT || 4020);
  const token = process.env.MOGPLEX_TERMINAL_BRIDGE_TOKEN || "";
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(
      `[mogplex-terminal-bridge] invalid port: ${process.env.MOGPLEX_TERMINAL_BRIDGE_PORT}`
    );
    process.exit(1);
  }
  const server = startBridge({ port, token });
  server.once("listening", () => process.send?.({ type: "listening" }));
}

// Only run when invoked directly (not when imported by tests).
const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
