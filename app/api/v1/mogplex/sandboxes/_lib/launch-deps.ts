import {
  getActiveSandboxForRepo,
  type SandboxPostDeps,
} from "@/app/api/sandbox/_lib/deps";
import {
  loadMatchingSandboxRecord,
  resolveNameCollision,
} from "@/lib/sandbox/launch";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";

type LaunchDeps = {
  getActiveSandboxForRepo: typeof getActiveSandboxForRepo;
  loadMatchingSandboxRecord: typeof loadMatchingSandboxRecord;
  resolveNameCollision: typeof resolveNameCollision;
};

async function refuseWorkspaceReplacement(): Promise<never> {
  throw new Error(
    "Saved workspace is unavailable; refusing to replace its checkout"
  );
}

/** Preserve work created before v1 launches carried their repository's team. */
export function createMogplexApiSandboxPostDeps(
  overrides: Partial<LaunchDeps> = {}
): Pick<SandboxPostDeps, "getActiveSandboxForRepo" | "resolveNameCollision"> {
  const deps: LaunchDeps = {
    getActiveSandboxForRepo,
    loadMatchingSandboxRecord,
    resolveNameCollision,
    ...overrides,
  };
  return {
    async getActiveSandboxForRepo(
      repoId,
      userId,
      workingBranch,
      rootDirectory,
      productTeamId
    ) {
      const scoped = await deps.getActiveSandboxForRepo(
        repoId,
        userId,
        workingBranch,
        rootDirectory,
        productTeamId
      );
      if (scoped || !productTeamId) return scoped;
      if (!workingBranch || rootDirectory === undefined) return null;
      const savedTeamWorkspace = await deps.loadMatchingSandboxRecord({
        repoId,
        userId,
        workingBranch,
        rootDirectory,
        productTeamId,
        name: buildSandboxName({
          repoId,
          userId,
          workingBranch,
          rootDirectory,
          productTeamId,
        }),
      });
      if (savedTeamWorkspace) return null;
      // Keep older records personal-scoped; changing ownership could expose WIP.
      return deps.getActiveSandboxForRepo(
        repoId,
        userId,
        workingBranch,
        rootDirectory,
        null
      );
    },
    async resolveNameCollision(input) {
      if (
        input.productTeamId &&
        !(await deps.loadMatchingSandboxRecord(input))
      ) {
        const legacy = await deps.loadMatchingSandboxRecord({
          ...input,
          productTeamId: null,
          name: buildSandboxName({ ...input, productTeamId: null }),
        });
        if (legacy) {
          // Let the canonical resolver probe persistence and provider state.
          // A legacy workspace may resume/restart, but must never be discarded.
          const resolved = await deps.resolveNameCollision(
            { ...input, name: legacy.sandbox_id, productTeamId: null },
            {
              stopMatchingRecord: refuseWorkspaceReplacement,
              deleteSandbox: refuseWorkspaceReplacement,
              deleteSandboxByName: refuseWorkspaceReplacement,
            }
          );
          if (resolved.kind === "create" || resolved.kind === "replace") {
            return refuseWorkspaceReplacement();
          }
          return resolved;
        }
      }
      return deps.resolveNameCollision(input);
    },
  };
}
