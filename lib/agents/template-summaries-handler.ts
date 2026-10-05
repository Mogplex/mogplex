import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { PRECONFIGURED_AGENTS } from "./templates";
import type { AgentCategory } from "./templates/types";

export type AgentTemplateSummary = {
  name: string;
  description: string;
  category: AgentCategory;
  model: string;
};

const DEFAULT_DEPS = { requireUserId };

/** Display metadata only. Full prompts remain in the server catalog. */
export function createAgentTemplateSummariesGetHandler(
  deps: { requireUserId: typeof requireUserId } = DEFAULT_DEPS
) {
  return async function GET() {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;
    return NextResponse.json(
      PRECONFIGURED_AGENTS.map(({ name, description, category, model }) => ({
        name,
        description,
        category,
        model,
      }))
    );
  };
}
