import type { SandboxLaunchRequestInput } from "@/lib/sandbox/launch-config";
import type { SandboxStateScope, SandboxStore } from "./sandbox-store-types";

function normalizeSandboxStateKeySegment(
  value: string | null | undefined,
  fallback: string
) {
  return typeof value === "string" && value.trim()
    ? `v-${encodeURIComponent(value.trim())}`
    : fallback;
}

/**
 * Key format: `${repoId}:${workingBranch}:${rootDirectory}`.
 * Sentinels: `u` = omitted/unspecified, `n` = explicit repo root,
 * `v-{encoded}` = literal value. Legacy two-segment keys are parsed
 * by parseSandboxStateKey for backward compatibility.
 */
export function buildSandboxStateKey(
  repoId: string,
  workingBranch?: string | null,
  rootDirectory?: string | null
) {
  const normalizedWorkingBranch = normalizeSandboxStateKeySegment(
    workingBranch,
    "u"
  );
  const normalizedRootDirectory =
    rootDirectory === null
      ? "n"
      : normalizeSandboxStateKeySegment(rootDirectory, "u");
  return `${repoId}:${normalizedWorkingBranch}:${normalizedRootDirectory}`;
}

export function buildLaunchKey(
  repoId: string,
  launchRequest?: SandboxLaunchRequestInput
) {
  return buildSandboxStateKey(
    repoId,
    launchRequest?.workingBranch,
    launchRequest?.rootDirectory
  );
}

function parseSandboxStateValueSegment(
  segment: string | undefined,
  options?: { nullValue?: boolean }
) {
  // Bare "default" is only a legacy unencoded sentinel. New literal values are
  // prefixed with "v-" so branches or roots named "default" round-trip.
  if (!segment || segment === "u" || segment === "default") return undefined;
  // "n" is the canonical repo-root encoding; "root" is a legacy alias from
  // early rootDirectory keys before value prefixes were introduced.
  if (options?.nullValue && (segment === "n" || segment === "root")) {
    return null;
  }
  // Malformed literal or legacy segments are ignored instead of breaking state lookup.
  try {
    if (segment.startsWith("v-")) {
      return decodeURIComponent(segment.slice(2));
    }
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function parseSandboxStateKey(repoId: string, stateKey: string) {
  const prefix = `${repoId}:`;
  if (!stateKey.startsWith(prefix)) {
    return {
      workingBranch: undefined,
      rootDirectory: undefined,
    };
  }

  const [workingBranchSegment, rootDirectorySegment] = stateKey
    .slice(prefix.length)
    .split(":");
  return {
    workingBranch: parseSandboxStateValueSegment(workingBranchSegment) as
      | string
      | undefined,
    rootDirectory: parseSandboxStateValueSegment(rootDirectorySegment, {
      nullValue: true,
    }) as string | null | undefined,
  };
}

export function isBranchOnlyScope(scope?: SandboxStateScope) {
  return Boolean(scope?.workingBranch && scope.rootDirectory === undefined);
}

export function hasConcreteSandboxStateScope(scope?: SandboxStateScope) {
  return Boolean(
    scope?.sandboxId ||
    scope?.workingBranch ||
    scope?.rootDirectory !== undefined
  );
}

function findBranchScopedStateKeys(
  candidateKeys: Iterable<string>,
  repoId: string,
  workingBranch: string
) {
  const matches: string[] = [];
  for (const stateKey of candidateKeys) {
    const parsed = parseSandboxStateKey(repoId, stateKey);
    if (parsed.workingBranch === workingBranch) {
      matches.push(stateKey);
    }
  }
  return matches;
}

export function resolveSandboxStateKeys(
  state: Pick<SandboxStore, "sandboxesById">,
  repoId: string,
  scope: SandboxStateScope | undefined,
  candidateKeys: Iterable<string>
) {
  if (isBranchOnlyScope(scope)) {
    const matches = findBranchScopedStateKeys(
      candidateKeys,
      repoId,
      scope?.workingBranch ?? ""
    );
    if (matches.length > 0) return matches;
  }

  return [resolveSandboxStateKey(state, repoId, scope)];
}

export function resolveSandboxStateKey(
  state: Pick<SandboxStore, "sandboxesById">,
  repoId: string,
  scope?: SandboxStateScope
) {
  if (scope?.workingBranch || scope?.rootDirectory !== undefined) {
    return buildSandboxStateKey(
      repoId,
      scope?.workingBranch,
      scope?.rootDirectory
    );
  }

  if (scope?.sandboxId) {
    const sandbox = state.sandboxesById[scope.sandboxId];
    if (sandbox?.repo_id === repoId) {
      return buildSandboxStateKey(
        repoId,
        sandbox.working_branch,
        sandbox.root_directory
      );
    }
  }

  return buildSandboxStateKey(repoId);
}

export function resolveFallbackSandboxStateKey(repoId: string) {
  return buildSandboxStateKey(repoId);
}
