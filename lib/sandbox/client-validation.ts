import type { RepoEnvVars } from "@/lib/repo-settings";
import { SandboxCreateRequestValidationError } from "@/lib/sandbox/create-request-validation";

// Workspace files remain recoverable until the user deletes the workspace.
// Vercel uses zero for snapshots that do not expire.
export const DEFAULT_PERSISTENT_SNAPSHOT_EXPIRATION_MS = 0;

// Observed Vercel Sandbox create failures reject env payloads above 4096 bytes
// (`bad_request: env payload too large ... max 4096`). We measure the raw env
// object JSON as a cheap preflight estimate; Vercel remains the source of truth.
export const MAX_SANDBOX_ENV_PAYLOAD_BYTES = 4096;

// Keep this list scoped to ports we've seen Vercel reject at create time.
// 8080 is a known reserved system port in production failures; do not add
// ports like 8000 until the matching runtime defaults move with it.
const RESERVED_SANDBOX_CREATE_PORTS = new Set([8080]);
const SANDBOX_ENV_SUMMARY_LIMIT = 3;

export function measureSandboxEnvPayloadBytes(envVars: RepoEnvVars): number {
  return Buffer.byteLength(JSON.stringify(envVars), "utf8");
}

function summarizeLargestSandboxEnvVars(envVars: RepoEnvVars): string {
  return Object.entries(envVars)
    .map(([key, value]) => ({
      key,
      bytes: Buffer.byteLength(JSON.stringify({ [key]: value }), "utf8"),
    }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, SANDBOX_ENV_SUMMARY_LIMIT)
    .map(({ key, bytes }) => `${key} (${bytes} bytes)`)
    .join(", ");
}

export function validateSandboxCreateRequest(input: {
  envVars: RepoEnvVars;
  ports: Iterable<number>;
}): void {
  const reservedPort = Array.from(input.ports).find((port) =>
    RESERVED_SANDBOX_CREATE_PORTS.has(port)
  );
  if (typeof reservedPort === "number") {
    throw new SandboxCreateRequestValidationError(
      "reserved_port",
      `Sandbox requested reserved port ${reservedPort}. Change the repo sandbox dev port or dev command to a supported port such as 3000 or 5173.`
    );
  }

  const payloadBytes = measureSandboxEnvPayloadBytes(input.envVars);
  if (payloadBytes <= MAX_SANDBOX_ENV_PAYLOAD_BYTES) {
    return;
  }

  const largestEntries = summarizeLargestSandboxEnvVars(input.envVars);
  const largestEntriesSuffix = largestEntries
    ? ` Largest entries: ${largestEntries}.`
    : "";
  throw new SandboxCreateRequestValidationError(
    "env_payload_too_large",
    `Sandbox env payload is too large for Vercel Sandbox (${payloadBytes} bytes; max ${MAX_SANDBOX_ENV_PAYLOAD_BYTES}). Remove or shorten sandbox env vars before launching.${largestEntriesSuffix}`
  );
}

export function resolvePersistentSandboxOptions(opts: {
  persistent?: boolean;
  snapshotExpirationMs?: number;
}): { persistent: boolean; snapshotExpiration: number } {
  if (opts.persistent === false || (opts.snapshotExpirationMs ?? 0) !== 0) {
    throw new Error("Workspace files must persist without automatic expiry");
  }
  return {
    persistent: true,
    snapshotExpiration: DEFAULT_PERSISTENT_SNAPSHOT_EXPIRATION_MS,
  };
}

export class SandboxBootstrapError extends Error {
  installLog?: string;
  devLog?: string;
  previewUrl?: string;

  constructor(
    message: string,
    details?: { installLog?: string; devLog?: string; previewUrl?: string }
  ) {
    super(message);
    this.name = "SandboxBootstrapError";
    this.installLog = details?.installLog;
    this.devLog = details?.devLog;
    this.previewUrl = details?.previewUrl;
  }
}

/** Default timeout for bootstrap steps (install, dev server launch). */
export const BOOTSTRAP_STEP_TIMEOUT_MS = 180_000; // 3 minutes

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms
    );
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}
