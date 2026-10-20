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
        // The canonical lifecycle restores this record's own provider identity
        // and filesystem. Keep the authenticated team header for its role check.
        if (legacy) return { kind: "restart", record: legacy };
      }
      return deps.resolveNameCollision(input);
    },
  };
}
