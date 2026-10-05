import { createMergeSettingsHandlers } from "@/lib/github-merge-policy-handlers";

const handlers = createMergeSettingsHandlers();
type Context = { params: Promise<{ teamId: string }> };

export async function GET(_request: Request, context: Context) {
  return handlers.get((await context.params).teamId);
}

export async function PATCH(request: Request, context: Context) {
  return handlers.patch(request, (await context.params).teamId);
}
