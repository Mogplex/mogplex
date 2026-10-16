// Vercel Sandbox implementation of `SandboxProvider`. It delegates to the
// existing lifecycle helpers, so behavior is unchanged. This directory is
// the only place new code may import `@vercel/sandbox` (see the
// no-restricted-imports block in eslint.config.mjs).
import type { Sandbox } from "@vercel/sandbox";
import {
  createSandboxForRepo,
  createSandboxFromSnapshot,
  getSandbox,
  listVercelSandboxes,
} from "@/lib/sandbox/client-lifecycle";
import { isNotFoundError } from "@/lib/sandbox/sdk-adapter";
import type {
  SandboxCapabilities,
  SandboxHandle,
  SandboxProvider,
} from "@/lib/sandbox/provider/types";

export const VERCEL_SANDBOX_CAPABILITIES: SandboxCapabilities = {
  snapshots: true,
  previewUrls: true,
  extendTimeout: true,
  detachedCommands: true,
  persistentSandboxes: true,
  nestedSandbox: true,
};

/**
 * A Vercel sandbox is a `SandboxHandle` as is. Routing every result through
 * this function makes the compiler check that, so an SDK upgrade that
 * breaks the shared shape fails typecheck here instead of at a caller.
 */
export function toSandboxHandle(sandbox: Sandbox): SandboxHandle {
  return sandbox;
}

/** The lifecycle helpers the adapter delegates to; injectable for tests. */
export type VercelSandboxDeps = {
  createSandboxForRepo: typeof createSandboxForRepo;
  createSandboxFromSnapshot: typeof createSandboxFromSnapshot;
  getSandbox: typeof getSandbox;
  listVercelSandboxes: typeof listVercelSandboxes;
  isNotFoundError: typeof isNotFoundError;
};

/** Build the Vercel provider over `deps` (the real helpers by default). */
export function createVercelSandboxProvider(
  deps: VercelSandboxDeps
): SandboxProvider {
  return {
    id: "vercel",
    capabilities: VERCEL_SANDBOX_CAPABILITIES,

    async createFromGit(opts) {
      return toSandboxHandle(await deps.createSandboxForRepo(opts));
    },

    async createFromSnapshot(opts) {
      return toSandboxHandle(await deps.createSandboxFromSnapshot(opts));
    },

    async get(name, credentials, opts = {}) {
      return toSandboxHandle(
        await deps.getSandbox(name, credentials, {
          resume: opts.resume ?? false,
        })
      );
    },

    async getIfExists(name, credentials) {
      try {
        return toSandboxHandle(
          await deps.getSandbox(name, credentials, { resume: false })
        );
      } catch (error) {
        if (deps.isNotFoundError(error)) return null;
        throw error;
      }
    },

    async list(credentials, opts = {}) {
      const sandboxes = await deps.listVercelSandboxes(credentials, opts);
      return sandboxes.map((sandbox) => ({
        name: sandbox.name,
        status: sandbox.status,
        persistent: sandbox.persistent,
        createdAt: sandbox.createdAt,
        ...(sandbox.tags ? { tags: sandbox.tags } : {}),
      }));
    },
  };
}

export const vercelSandboxProvider = createVercelSandboxProvider({
  createSandboxForRepo,
  createSandboxFromSnapshot,
  getSandbox,
  listVercelSandboxes,
  isNotFoundError,
});
