import { assertValidOrchestrationSlug } from "./slugs";

export function buildSpecBranch(runSlug: string): string {
  assertValidOrchestrationSlug(runSlug, "Run slug");
  return `mogplex/spec/${runSlug}`;
}

export function buildTaskBranch(runSlug: string, taskSlug: string): string {
  assertValidOrchestrationSlug(runSlug, "Run slug");
  assertValidOrchestrationSlug(taskSlug, "Task slug");
  return `mogplex/task/${runSlug}/${taskSlug}`;
}

export function buildIntegrationBranch(runSlug: string): string {
  assertValidOrchestrationSlug(runSlug, "Run slug");
  return `mogplex/integrate/${runSlug}`;
}
