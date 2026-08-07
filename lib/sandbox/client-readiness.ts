import type { Sandbox } from "@vercel/sandbox";
import { checkSandboxHealth } from "@/lib/sandbox/health-status";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import type {
  PreviewReadinessOptions,
  PreviewReadyResult,
  SandboxStreamingCommand,
  PreviewSignalRaceWinner,
  SandboxRuntime,
} from "./client-types";
import { SandboxBootstrapError } from "./client-validation";

export const DEV_SERVER_SIGNAL_TIMEOUT_MS = 90_000;

export const NO_DEV_SCRIPT_MESSAGE =
  "No dev script found in package.json — sandbox ready for terminal and file access.";

const PREVIEW_READY_PATTERNS = [
  /\blocal:\s*https?:\/\//i,
  /\blocalhost:\d+/i,
  /\b127\.0\.0\.1:\d+/i,
  /\bready in\b/i,
  /\bcompiled successfully\b/i,
  /\blistening on\b/i,
  /\brunning on https?:\/\//i,
  /\bapplication startup complete\b/i,
  /\bserver started\b/i,
];

export function logSignalsPreviewReady(chunk: string) {
  return PREVIEW_READY_PATTERNS.some((pattern) => pattern.test(chunk));
}

/**
 * Extract the port the dev server actually bound to from a log chunk.
 * Covers the common framework outputs: Next.js ("Local: http://localhost:3003"),
 * Vite (same), Nuxt, Astro, Express/Nest (":3000" / "listening on 3000").
 *
 * Returns null when no port is found. Used to rebind the preview URL when
 * the server falls back to a different port (e.g. 3000 already in use →
 * Next picks 3001).
 */
export function extractBoundPortFromLog(chunk: string): number | null {
  const patterns = [
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/i,
    /\blistening on\s+(?:https?:\/\/[^\s:]+:)?(\d{2,5})\b/i,
    /\bserver started.*:(\d{2,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = chunk.match(pattern);
    const port = match?.[1] ? Number(match[1]) : Number.NaN;
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return null;
}

export function replacePortInSandboxDomain(
  sandbox: Sandbox,
  currentUrl: string,
  boundPort: number
): { url: string; changed: boolean } {
  try {
    const expected = new URL(currentUrl).port;
    if (expected && Number(expected) === boundPort) {
      return { url: currentUrl, changed: false };
    }
    const nextUrl = sandbox.domain(boundPort);
    if (!nextUrl || nextUrl === currentUrl) {
      return { url: currentUrl, changed: false };
    }
    return { url: nextUrl, changed: true };
  } catch {
    return { url: currentUrl, changed: false };
  }
}

export function previewAllowsRoot404(input?: {
  runtime?: SandboxRuntime | null;
  framework?: string;
}) {
  if (input?.runtime?.startsWith("python")) return true;
  return ["fastapi", "uvicorn", "flask", "django"].includes(
    input?.framework || ""
  );
}

export function buildPreviewReadinessOptions(input: {
  runtime?: SandboxRuntime | null;
  framework?: string;
}): PreviewReadinessOptions {
  return {
    treatRoot404AsReady: previewAllowsRoot404(input),
  };
}

function isUsablePreviewHealth(status: SandboxHealthStatus) {
  return status === "running" || status === "app_error";
}

async function classifyPreviewHealth(
  previewUrl: string,
  options?: PreviewReadinessOptions
) {
  const health = await checkSandboxHealth(previewUrl, undefined, options);
  return {
    ready: isUsablePreviewHealth(health.status),
    healthStatus: health.status,
    statusCode: health.statusCode ?? null,
    message: health.message,
  };
}

/** Retry health check a few times after the dev process exits — the sandbox proxy may need a moment. */
export async function retryPreviewHealth(
  previewUrl: string,
  options?: PreviewReadinessOptions,
  retries = 4,
  delayMs = 2000
) {
  for (let i = 0; i <= retries; i++) {
    const health = await classifyPreviewHealth(previewUrl, options);
    if (health.ready) return health;
    if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Extract the last N lines of dev-server output as a readable excerpt.
 * Used to embed the real failure cause into the bootstrap error message
 * so the UI error card can show it inline, instead of just "Preview did
 * not become ready on <url>".
 */
export function extractDevLogTail(
  log: string | null | undefined,
  maxLines = 20,
  maxChars = 2000
): string {
  if (!log) return "";
  const trimmed = log.trim();
  if (!trimmed) return "";
  const lines = trimmed.split("\n");
  const tail = lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  return tail.length > maxChars
    ? `...${tail.slice(tail.length - maxChars)}`
    : tail;
}

export function buildPreviewReadyResult(
  health: Awaited<ReturnType<typeof classifyPreviewHealth>>,
  devLog: string
): PreviewReadyResult {
  return {
    ready: true,
    healthStatus: health.healthStatus,
    statusCode: health.statusCode,
    previewError: health.healthStatus === "running" ? null : health.message,
    devLog,
  };
}

export async function readSandboxTextFile(sandbox: Sandbox, path: string) {
  const buffer = await sandbox.readFileToBuffer({ path });
  return buffer ? buffer.toString("utf-8") : "";
}

export async function failPreviewBootstrap(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  message: string
): Promise<never> {
  const devLog = await readSandboxTextFile(sandbox, devLogPath);
  const tail = extractDevLogTail(devLog);
  const withContext = tail
    ? `${message}\n\nLast dev-server output:\n${tail}`
    : message;
  throw new SandboxBootstrapError(withContext, {
    previewUrl,
    devLog,
  });
}

export async function resolvePreviewHealthResult(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  health: Awaited<ReturnType<typeof classifyPreviewHealth>>
) {
  return buildPreviewReadyResult(
    health,
    await readSandboxTextFile(sandbox, devLogPath)
  );
}

export async function resolveRetriedPreviewHealthResult(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  readiness?: PreviewReadinessOptions
) {
  const health = await retryPreviewHealth(previewUrl, readiness);
  if (!health) {
    return null;
  }

  return resolvePreviewHealthResult(sandbox, previewUrl, devLogPath, health);
}

export function createPreviewSignalTimeoutPromise() {
  return new Promise<{ kind: "timeout" }>((resolve) => {
    setTimeout(
      () => resolve({ kind: "timeout" }),
      DEV_SERVER_SIGNAL_TIMEOUT_MS
    );
  });
}

export function createPreviewSignalExitPromise(
  command: SandboxStreamingCommand
) {
  return command.wait().then((result) => ({ kind: "exit" as const, result }));
}

export function nextPreviewSignalWinner(
  logIterator: AsyncIterator<{ data: string }>,
  exitPromise: Promise<{ kind: "exit"; result: { exitCode: number | null } }>,
  timeoutPromise: Promise<{ kind: "timeout" }>
) {
  const logPromise = logIterator
    .next()
    .then((entry) => ({ kind: "log" as const, entry }));
  return Promise.race<PreviewSignalRaceWinner>([
    logPromise,
    exitPromise,
    timeoutPromise,
  ]);
}

export async function resolveClosedPreviewSignal(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  readiness: PreviewReadinessOptions | undefined
) {
  const result = await resolveRetriedPreviewHealthResult(
    sandbox,
    previewUrl,
    devLogPath,
    readiness
  );
  if (result) {
    return result;
  }

  return failPreviewBootstrap(
    sandbox,
    previewUrl,
    devLogPath,
    `Dev server exited before preview became ready on ${previewUrl}`
  );
}

export async function resolveTimedOutPreviewSignal(
  sandbox: Sandbox,
  previewUrl: string,
  devLogPath: string,
  readiness: PreviewReadinessOptions | undefined
) {
  const health = await classifyPreviewHealth(previewUrl, readiness);
  if (health.ready) {
    return resolvePreviewHealthResult(sandbox, previewUrl, devLogPath, health);
  }

  return failPreviewBootstrap(
    sandbox,
    previewUrl,
    devLogPath,
    `Preview did not become ready on ${previewUrl}`
  );
}

export async function waitForPreviewSignal(
  sandbox: Sandbox,
  command: SandboxStreamingCommand,
  previewUrl: string,
  devLogPath: string,
  options: {
    readiness?: PreviewReadinessOptions;
  } = {}
) {
  const logIterator = command.logs()[Symbol.asyncIterator]();
  const timeoutPromise = createPreviewSignalTimeoutPromise();
  const exitPromise = createPreviewSignalExitPromise(command);

  try {
    while (true) {
      const winner = await nextPreviewSignalWinner(
        logIterator,
        exitPromise,
        timeoutPromise
      );

      if (winner.kind === "log") {
        if (winner.entry.done) {
          return resolveClosedPreviewSignal(
            sandbox,
            previewUrl,
            devLogPath,
            options.readiness
          );
        }

        if (logSignalsPreviewReady(winner.entry.value.data)) {
          const result = await resolveRetriedPreviewHealthResult(
            sandbox,
            previewUrl,
            devLogPath,
            options.readiness
          );
          if (result) {
            return result;
          }
        }

        continue;
      }

      if (winner.kind === "exit") {
        return resolveClosedPreviewSignal(
          sandbox,
          previewUrl,
          devLogPath,
          options.readiness
        );
      }

      return resolveTimedOutPreviewSignal(
        sandbox,
        previewUrl,
        devLogPath,
        options.readiness
      );
    }
  } finally {
    await logIterator.return?.();
  }
}
