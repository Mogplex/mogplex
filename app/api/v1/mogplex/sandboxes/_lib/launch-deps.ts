import {
  getActiveSandboxForRepo,
  type SandboxPostDeps,
} from "@/app/api/sandbox/_lib/deps";
import {
  loadMatchingSandboxRecordRow,
  resolveNameCollision,
} from "@/lib/sandbox/launch";
import { buildSandboxName } from "@/lib/sandbox/sandbox-name";
import { resolveSandboxRecordCredentials } from "@/lib/sandbox/get-user-credentials";
import { SavedWorkspaceUnavailableError } from "./workspace-conflict";

type LaunchDeps = {
  getActiveSandboxForRepo: typeof getActiveSandboxForRepo;
  loadMatchingSandboxRecord: typeof loadMatchingSandboxRecordRow;
  resolveNameCollision: typeof resolveNameCollision;
};

async function refuseWorkspaceReplacement(): Promise<never> {
  throw new SavedWorkspaceUnavailableError();
}

/** Preserve work created before v1 launches carried their repository's team. */
export function createMogplexApiSandboxPostDeps(
  overrides: Partial<LaunchDeps> = {}
): Pick<SandboxPostDeps, "getActiveSandboxForRepo" | "resolveNameCollision"> {
  const deps: LaunchDeps = {
    getActiveSandboxForRepo,
    loadMatchingSandboxRecord: loadMatchingSandboxRecordRow,
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
      // The active lookup includes creating/installing team records. Only
      // saved paused/stopped records need the separate canonical-name lookup.
      // Collection launches pass the resolved repo default (string or null).
      // Undefined means no root filter, so never guess across saved roots here.
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
          // Creation can target a different project from the saved workspace.
          // Use authenticated service credentials and the record's billing target.
          if (!input.serviceCredentials) return refuseWorkspaceReplacement();
          const credentials = resolveSandboxRecordCredentials(
            input.serviceCredentials,
            legacy
          );
          if (!credentials.ok) return refuseWorkspaceReplacement();
          // Let the canonical resolver probe persistence and provider state.
          // A legacy workspace may resume/restart, but must never be discarded.
          const resolved = await deps.resolveNameCollision(
            {
              ...input,
              name: legacy.sandbox_id,
              productTeamId: null,
              credentials: {
                vercelToken: credentials.vercelToken,
                vercelTeamId: credentials.vercelTeamId,
                vercelProjectId: credentials.vercelProjectId,
              },
            },
            {
              stopMatchingRecord: refuseWorkspaceReplacement,
              deleteSandbox: refuseWorkspaceReplacement,
              deleteSandboxByName: refuseWorkspaceReplacement,
              insertAdoptedRecord: refuseWorkspaceReplacement,
            }
          );
          if (
            resolved.kind === "create" ||
            resolved.kind === "replace" ||
            resolved.kind === "adopt"
          ) {
            return refuseWorkspaceReplacement();
          }
          return resolved;
        }
      }
      return deps.resolveNameCollision(input);
    },
  };
}
