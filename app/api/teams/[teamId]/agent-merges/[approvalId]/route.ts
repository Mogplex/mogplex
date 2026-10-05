import { createMergeSettingsHandlers } from "@/lib/github-merge-policy-handlers";

const handlers = createMergeSettingsHandlers();

export async function POST(
  request: Request,
  context: {
    params: Promise<{ teamId: string; approvalId: string }>;
  }
) {
  const { teamId, approvalId } = await context.params;
  return handlers.resolve(request, teamId, approvalId);
}
