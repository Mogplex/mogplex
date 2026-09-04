import { shellQuote } from "./client-shell";

export type BaselineGitBranchOpts = {
  baseBranch: string;
  workingBranch: string;
  createBranch: boolean;
};

/**
 * Explicit refspec so the fetch always materializes `refs/remotes/origin/<b>`.
 *
 * A baseline snapshot is built from a shallow provider clone that carries no
 * `remote.origin.fetch` refspec, so a bare `git fetch origin <b>` only writes
 * FETCH_HEAD and the checkout that follows fails with
 * "'origin/<b>' is not a commit". Naming the destination ref sidesteps the
 * missing refspec entirely.
 */
function trackingRefspec(branch: string): string {
  return shellQuote(`+refs/heads/${branch}:refs/remotes/origin/${branch}`);
}

export function resolveBaselineFetchRefs(
  opts: BaselineGitBranchOpts
): string[] {
  return opts.createBranch || opts.workingBranch === opts.baseBranch
    ? [opts.baseBranch]
    : [opts.baseBranch, opts.workingBranch];
}

export function buildBaselineFetchCommand(opts: BaselineGitBranchOpts): string {
  return `git fetch --depth=1 origin ${resolveBaselineFetchRefs(opts)
    .map(trackingRefspec)
    .join(" ")}`;
}

export function buildBaselineCheckoutCommand(
  opts: BaselineGitBranchOpts
): string {
  const workingBranch = shellQuote(opts.workingBranch);
  if (opts.createBranch) {
    return `git checkout -b ${workingBranch} origin/${shellQuote(
      opts.baseBranch
    )} && git push -u origin ${workingBranch}`;
  }
  return `git checkout -B ${workingBranch} origin/${workingBranch}`;
}
