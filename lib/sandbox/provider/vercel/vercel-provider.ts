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

export const vercelSandboxProvider: SandboxProvider = {
  id: "vercel",
  capabilities: VERCEL_SANDBOX_CAPABILITIES,

  async createFromGit(opts) {
    return toSandboxHandle(await createSandboxForRepo(opts));
  },

  async createFromSnapshot(opts) {
    return toSandboxHandle(await createSandboxFromSnapshot(opts));
  },

  async get(name, credentials, opts = {}) {
    return toSandboxHandle(
      await getSandbox(name, credentials, { resume: opts.resume ?? false })
    );
  },

  async getIfExists(name, credentials) {
    try {
      return toSandboxHandle(
        await getSandbox(name, credentials, { resume: false })
      );
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  },

  async list(credentials, opts = {}) {
    const sandboxes = await listVercelSandboxes(credentials, opts);
    return sandboxes.map((sandbox) => ({
      name: sandbox.name,
      status: sandbox.status,
      persistent: sandbox.persistent,
      createdAt: sandbox.createdAt,
      ...(sandbox.tags ? { tags: sandbox.tags } : {}),
    }));
  },
};
