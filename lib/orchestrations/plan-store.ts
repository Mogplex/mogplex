import { supabaseAdmin } from "@/lib/supabase/admin";
import { OrchestrationStoreError } from "./store";
import { isOrchestrationTaskStatus, type OrchestrationHarness } from "./status";
import type { OrchestrationTaskDTO } from "./types";

export type CreateOrchestrationPlanInput = {
  runId: string;
  userId: string;
  objective: string;
  context?: string | null;
  constraints?: string[];
  tasks: Array<{
    orderIndex: number;
    slug: string;
    title: string;
    filePath: string;
    branchName: string;
    harness: OrchestrationHarness;
    ownedPaths: string[];
    blockedPaths: string[];
    dependsOn: string[];
    acceptanceCriteria: string[];
    validationCommands: string[];
    prompt: string;
  }>;
};

function parseTask(row: Record<string, unknown>): OrchestrationTaskDTO {
  if (!isOrchestrationTaskStatus(row.status)) {
    throw new OrchestrationStoreError(
      "create plan",
      `unknown task status ${String(row.status)}`
    );
  }
  return row as unknown as OrchestrationTaskDTO;
}

export async function createOrchestrationPlan(
  input: CreateOrchestrationPlanInput
): Promise<OrchestrationTaskDTO[]> {
  const { data, error } = await supabaseAdmin.rpc("create_orchestration_plan", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_objective: input.objective,
    p_context: input.context ?? "",
    p_constraints: input.constraints ?? [],
    p_tasks: input.tasks,
  });
  if (error || !Array.isArray(data)) {
    throw new OrchestrationStoreError(
      "create plan",
      error?.message ?? "no tasks returned"
    );
  }
  return (data as Record<string, unknown>[]).map(parseTask);
}
