import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { loadTerminalBridgeSource } from "@/lib/sandbox/terminal-bridge-source";
import { TERMINAL_PTY_PORT } from "@/lib/sandbox/terminal-pty-config";
import { TERMINAL_BRIDGE_BOOTSTRAP } from "@/lib/sandbox/terminal-bridge-bootstrap";

export const TERMINAL_BRIDGE_SCRIPT_PATH =
  "/vercel/sandbox/.mogplex/terminal-bridge.mjs";
export const TERMINAL_BRIDGE_LOG_PATH = "/tmp/mogplex-terminal-bridge.log";

const BRIDGE_ENV_NAME_PATTERN = /^[A-Za-z_]\w*$/;
const RESERVED_BRIDGE_ENV_NAMES = new Set([
  "HOME",
  "NODE_OPTIONS",
  "PATH",
  "PWD",
  "SHELL",
  "SHLVL",
  "TERM",
  "TMUX",
]);

export type TerminalBridgeInstallation = {
  token: string;
  port: number;
  installedAt: number;
  sandboxRuntimeId: string;
  configSignature: string;
};

// Structural subset of the Sandbox SDK surface we actually use. Lets tests
// supply a focused mock without having to satisfy every overload on the real
// class.
type SandboxRunResult = {
  stdout: () => Promise<string>;
  stderr?: () => Promise<string>;
  exitCode?: number;
};

export type SandboxLike = {
  // Renamed from `sandboxId` in v2 of @vercel/sandbox — SDK identity
  // is now a name. Kept structural so tests can provide a lightweight
  // mock without implementing the full SDK surface.
  name: string;
  writeFiles: (
    files: Array<{ path: string; content: Buffer }>
  ) => Promise<void>;
  runCommand: (input: {
    cmd: string;
    args: string[];
  }) => Promise<SandboxRunResult>;
};

function shellQuote(value: string) {
  // The bridge token is base64url (A-Z a-z 0-9 - _) so single-quote escaping
  // is enough. Still route through the standard `'\''` pattern in case the
  // helper is ever passed arbitrary input.
  return `'${value.replace(/'/g, String.raw`'\''`)}'`;
}

function sanitizeBridgeEnv(
  env: Record<string, string> | undefined
): Record<string, string> {
  if (!env) return {};

  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (
      !BRIDGE_ENV_NAME_PATTERN.test(name) ||
      RESERVED_BRIDGE_ENV_NAMES.has(name)
    ) {
      continue;
    }
    sanitized[name] = value;
  }
  return sanitized;
}

function buildBridgeEnvPrefix(env: Record<string, string>) {
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
}

function buildTerminalBridgeConfigSignature(input: {
  port: number;
  source: string;
  env: Record<string, string>;
}) {
  const hash = createHash("sha256");
  hash.update(String(input.port));
  hash.update("\0");
  hash.update(input.source);
  hash.update("\0");
  for (const [name, value] of Object.entries(input.env).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    hash.update(name);
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function generateBridgeToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function healthProbe(
  sandbox: SandboxLike,
  port: number
): Promise<{ ok: true } | { ok: false; lastError: string }> {
  try {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-lc",
        `curl -sS --max-time 1 http://127.0.0.1:${port}/health || true`,
      ],
    });
    const stdout = await result.stdout();
    if (stdout.includes('"ok":true')) {
      return { ok: true };
    }
    return { ok: false, lastError: stdout.trim() || "empty response" };
  } catch (error) {
    return {
      ok: false,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

// Writes the runtime .mjs into the sandbox, kills any prior bridge, starts a
// new one with a fresh token, and waits for /health to return ok. Idempotent
// per sandbox: calling install again replaces the running bridge.
export async function installTerminalBridgeOnce(
  sandbox: SandboxLike,
  options: {
    port?: number;
    source?: string;
    env?: Record<string, string>;
  } = {}
): Promise<TerminalBridgeInstallation> {
  const port = options.port ?? TERMINAL_PTY_PORT;
  const source = options.source ?? loadTerminalBridgeSource();
  const token = generateBridgeToken();
  const env = sanitizeBridgeEnv(options.env);
  const configSignature = buildTerminalBridgeConfigSignature({
    port,
    source,
    env,
  });

  await sandbox.writeFiles([
    { path: TERMINAL_BRIDGE_SCRIPT_PATH, content: Buffer.from(source) },
  ]);

  const bridgeEnv = buildBridgeEnvPrefix({
    ...env,
    MOGPLEX_TERMINAL_BRIDGE_PORT: String(port),
    MOGPLEX_TERMINAL_BRIDGE_TOKEN: token,
  });
  const startScript = [
    `mkdir -p $(dirname ${TERMINAL_BRIDGE_LOG_PATH})`,
    // Match only the bridge process, never the shell whose arguments contain
    // this cleanup command. Linux pkill otherwise kills its own launcher.
    `(pkill -f '^([^ ]*/)?node /vercel/sandbox/\\.mogplex/terminal-bridge\\.mjs$' 2>/dev/null || true)`,
    `${bridgeEnv} node -e ${shellQuote(TERMINAL_BRIDGE_BOOTSTRAP)} ${shellQuote(TERMINAL_BRIDGE_SCRIPT_PATH)} ${shellQuote(TERMINAL_BRIDGE_LOG_PATH)}`,
  ].join(" && ");

  const started = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", startScript],
  });
  if (
    started.exitCode !== 0 ||
    !(await started.stdout()).includes("MOGPLEX_TERMINAL_BRIDGE_READY")
  ) {
    throw new Error("terminal bridge startup failed before readiness");
  }

  const health = await healthProbe(sandbox, port);
  if (!health.ok) {
    throw new Error(
      `terminal bridge failed to become ready: ${health.lastError}`
    );
  }

  return {
    token,
    port,
    installedAt: Date.now(),
    sandboxRuntimeId: sandbox.name,
    configSignature,
  };
}

// Process-local cache. A Next.js server restart drops the cache, which is
// desired: on next /connect we re-install (killing the stale bridge) and mint
// a fresh token. The cache key is the Vercel sandbox runtime id so sandbox
// recreate forces a reinstall automatically.
const installationCache = new Map<string, TerminalBridgeInstallation>();
const inFlight = new Map<string, Promise<TerminalBridgeInstallation>>();

export async function ensureTerminalBridgeInstalled(
  sandbox: SandboxLike,
  options: { port?: number; source?: string; env?: Record<string, string> } = {}
): Promise<TerminalBridgeInstallation> {
  const key = sandbox.name;
  const port = options.port ?? TERMINAL_PTY_PORT;
  const source = options.source ?? loadTerminalBridgeSource();
  const env = sanitizeBridgeEnv(options.env);
  const requestedSignature = buildTerminalBridgeConfigSignature({
    port,
    source,
    env,
  });

  const cached = installationCache.get(key);
  if (cached?.configSignature === requestedSignature) return cached;

  const pending = inFlight.get(key);
  if (pending) {
    const result = await pending;
    if (result.configSignature === requestedSignature) {
      return result;
    }
  }

  const install = installTerminalBridgeOnce(sandbox, { port, source, env })
    .then((result) => {
      installationCache.set(key, result);
      inFlight.delete(key);
      return result;
    })
    .catch((error) => {
      inFlight.delete(key);
      throw error;
    });
  inFlight.set(key, install);
  return install;
}

export function clearTerminalBridgeCache(sandboxRuntimeId: string) {
  installationCache.delete(sandboxRuntimeId);
}

// Exposed for tests. Also used when a bridge becomes unhealthy so the next
// /connect forces a fresh install.
export function __resetTerminalBridgeCacheForTesting() {
  installationCache.clear();
  inFlight.clear();
}

// Re-exported for callers that need constant-time comparison against the
// cached token (we don't currently verify on the Next.js side since the
// bridge handles auth itself, but the primitive is handy in tests).
export function bridgeTokensMatch(a: string, b: string) {
  if (a?.length !== b?.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
