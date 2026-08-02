import { createHash } from "node:crypto";
import { resolveSandboxPath } from "@/lib/repo-settings";
import type { Sandbox } from "@vercel/sandbox";

export type LockfileKind = "pnpm" | "npm" | "yarn" | "bun";

export type LockfileDescriptor = {
  packageManager: LockfileKind;
  filename: string;
};

/** Priority order mirrors detectNodePackageManager. */
export const LOCKFILE_DESCRIPTORS: readonly LockfileDescriptor[] = [
  { packageManager: "pnpm", filename: "pnpm-lock.yaml" },
  { packageManager: "yarn", filename: "yarn.lock" },
  { packageManager: "bun", filename: "bun.lockb" },
  { packageManager: "npm", filename: "package-lock.json" },
] as const;

export type LockfileHashResult = {
  hash: string;
  lockfilePath: string;
  packageManager: LockfileKind;
};

export function hashLockfileBytes(bytes: Uint8Array | Buffer): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Hash the lockfile that lives inside a running sandbox. Probes the
 * rootDirectory first, then the repo root (matches detectNodePackageManager).
 * Returns null when no lockfile is found at either location.
 */
export async function computeLockfileHashFromSandbox(
  sandbox: Sandbox,
  rootDir?: string | null
): Promise<LockfileHashResult | null> {
  const locations: Array<{ relative: string; resolved: string }> = [];
  for (const { filename } of LOCKFILE_DESCRIPTORS) {
    locations.push({
      relative: filename,
      resolved: resolveSandboxPath(rootDir, filename),
    });
  }
  if (rootDir) {
    for (const { filename } of LOCKFILE_DESCRIPTORS) {
      locations.push({ relative: filename, resolved: filename });
    }
  }

  for (const loc of locations) {
    const descriptor = LOCKFILE_DESCRIPTORS.find(
      (d) => d.filename === loc.relative
    );
    if (!descriptor) continue;
    try {
      const buffer = await sandbox.readFileToBuffer({ path: loc.resolved });
      if (!buffer) continue;
      return {
        hash: hashLockfileBytes(buffer),
        lockfilePath: loc.resolved,
        packageManager: descriptor.packageManager,
      };
    } catch {
      // File missing or read failed — try next candidate.
      continue;
    }
  }

  return null;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

type CacheEntry = {
  value: LockfileHashResult | null;
  expiresAt: number;
};

const hashCache = new Map<string, CacheEntry>();

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of hashCache) {
    if (entry.expiresAt <= now) {
      hashCache.delete(key);
    }
  }
  if (hashCache.size > MAX_CACHE_ENTRIES) {
    const excess = hashCache.size - MAX_CACHE_ENTRIES;
    let dropped = 0;
    for (const key of hashCache.keys()) {
      if (dropped >= excess) break;
      hashCache.delete(key);
      dropped += 1;
    }
  }
}

export function __resetLockfileHashCacheForTests() {
  hashCache.clear();
}

type FetchLockfileHashOpts = {
  repoFullName: string;
  ref: string;
  token: string;
  rootDir?: string | null;
  ttlMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

function normalizeJoin(...segments: Array<string | null | undefined>) {
  return segments
    .filter((s): s is string => Boolean(s && s.length > 0))
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function buildCacheKey(
  repoFullName: string,
  ref: string,
  lockfilePath: string
) {
  return `${repoFullName}@${ref}:${lockfilePath}`;
}

async function fetchGithubLockfile(
  repoFullName: string,
  ref: string,
  path: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<Buffer | null> {
  const apiUrl = `https://api.github.com/repos/${repoFullName}/contents/${encodeURI(
    path
  )}?ref=${encodeURIComponent(ref)}`;
  const response = await fetchImpl(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "mogplex-lockfile-hash",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `GitHub lockfile fetch failed: ${response.status} ${response.statusText}`
    );
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function buildLockfileCandidates(baseRoot: string) {
  return LOCKFILE_DESCRIPTORS.flatMap((descriptor) => {
    const paths = baseRoot
      ? [normalizeJoin(baseRoot, descriptor.filename), descriptor.filename]
      : [descriptor.filename];
    return paths.map((lockfilePath) => ({ descriptor, lockfilePath }));
  });
}

function readFreshCache(key: string, now: () => number) {
  const cached = hashCache.get(key);
  return cached && cached.expiresAt > now() ? cached : null;
}

function writeSummaryCache(
  key: string,
  value: LockfileHashResult | null,
  now: () => number,
  ttlMs: number
) {
  hashCache.set(key, { value, expiresAt: now() + ttlMs });
}

async function resolveLockfileCandidate(
  candidate: { descriptor: LockfileDescriptor; lockfilePath: string },
  opts: FetchLockfileHashOpts,
  config: { ttlMs: number; now: () => number; fetchImpl: typeof fetch }
): Promise<LockfileHashResult | null> {
  const cacheKey = buildCacheKey(
    opts.repoFullName,
    opts.ref,
    candidate.lockfilePath
  );
  const cached = readFreshCache(cacheKey, config.now);
  if (cached) return cached.value;

  const buffer = await fetchGithubLockfile(
    opts.repoFullName,
    opts.ref,
    candidate.lockfilePath,
    opts.token,
    config.fetchImpl
  );
  if (!buffer) {
    hashCache.set(cacheKey, {
      value: null,
      expiresAt: config.now() + config.ttlMs,
    });
    evictExpired();
    return null;
  }
  const result: LockfileHashResult = {
    hash: hashLockfileBytes(buffer),
    lockfilePath: candidate.lockfilePath,
    packageManager: candidate.descriptor.packageManager,
  };
  hashCache.set(cacheKey, {
    value: result,
    expiresAt: config.now() + config.ttlMs,
  });
  evictExpired();
  return result;
}

/**
 * Fetch and hash the lockfile at `repoFullName@ref` via the GitHub contents
 * API. Probes lockfiles in priority order; returns null when no lockfile
 * exists at any candidate path. Caches results in an in-memory LRU with a
 * 5-minute TTL to absorb repeated launch-modal clicks.
 */
export async function fetchLockfileHashFromGithub(
  opts: FetchLockfileHashOpts
): Promise<LockfileHashResult | null> {
  const config = {
    ttlMs: opts.ttlMs ?? DEFAULT_CACHE_TTL_MS,
    now: opts.now ?? Date.now,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
  const baseRoot = opts.rootDir ? opts.rootDir.replace(/^\/+|\/+$/g, "") : "";
  const summaryKey = buildCacheKey(
    opts.repoFullName,
    opts.ref,
    `__summary:${baseRoot || "/"}`
  );

  const cachedSummary = readFreshCache(summaryKey, config.now);
  if (cachedSummary) return cachedSummary.value;

  for (const candidate of buildLockfileCandidates(baseRoot)) {
    const result = await resolveLockfileCandidate(candidate, opts, config);
    if (result) {
      writeSummaryCache(summaryKey, result, config.now, config.ttlMs);
      return result;
    }
  }

  writeSummaryCache(summaryKey, null, config.now, config.ttlMs);
  return null;
}
