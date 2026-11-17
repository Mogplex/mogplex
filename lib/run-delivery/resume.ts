import { updateAiCall } from "@/lib/interactive-runs";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs-types";
import { createRunDeliveryStore } from "./store";
import { loadRunDeliveryGithub } from "./github";
import { deliveryNeedsRepair } from "./types";

const defaults = {
  store: createRunDeliveryStore(),
  loadGithub: loadRunDeliveryGithub,
  cancelCall: (id: string) => updateAiCall(id, { status: "cancelled" }),
};
export function createDeliveryResume(deps = defaults) {
  const { store } = deps;
  return {
    authorize: store.authorize,
    claim: store.claimRepair,
    claimCheckpoint: store.claimCheckpoint,
    cancelCall: deps.cancelCall,
    async prepare(
      run: ExternalAgentRunRow,
      expected: { headSha: string; revision: string }
    ) {
      if (
        run.status !== "success" ||
        run.metadata.delivery_follow_through !== true ||
        run.metadata.delivery_last_repair_revision === expected.revision
      )
        return false;
      const owned = await store.load(run.user_id, run.id);
      if (!owned) return false;
      const current = await deps.loadGithub({
        userId: run.user_id,
        repoFullName: owned.repo_full_name,
        workingBranch: run.working_branch,
        baseBranch: run.base_branch,
      });
      if (!(await store.save(run, current))) return false;
      return (
        current.pullRequest?.headSha === expected.headSha &&
        current.repairRevision === expected.revision &&
        deliveryNeedsRepair(current)
      );
    },
  };
}
export const deliveryResume = createDeliveryResume();
