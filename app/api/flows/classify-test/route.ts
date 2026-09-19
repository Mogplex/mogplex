import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { classify } from "@/lib/decisions/classify";
import { classifyOutputSchema } from "@/lib/flows/classify-schema";
import { validateClassifyOutput } from "@/lib/flows/operators/classify";
import {
  resolveActiveTeamCapabilities,
  TEAM_RESOURCE_WRITE_CAPABILITY,
} from "@/lib/team-capabilities";
import { resolveProductResourceScope } from "@/lib/team-resource-scope";

// Lets an author try a Classify node's question on sample state before the
// flow runs. Wording decides accuracy, so this is part of authoring the node.

const bodySchema = z.object({
  question: z.string().trim().min(1),
  output: classifyOutputSchema,
  state: z.string().trim().min(1),
  minConfidence: z.number().gt(0).lt(1).nullish(),
});

type ClassifyTestRouteDeps = {
  requireUserId: typeof requireUserId;
  resolveActiveTeamCapabilities: typeof resolveActiveTeamCapabilities;
  classify: typeof classify;
};

export function createClassifyTestPostHandler(
  overrides: Partial<ClassifyTestRouteDeps> = {}
) {
  const deps: ClassifyTestRouteDeps = {
    requireUserId,
    resolveActiveTeamCapabilities,
    classify,
    ...overrides,
  };

  return async function POST(request: Request) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const scopeResolution = await resolveProductResourceScope({
      request,
      userId,
      requiredCapability: TEAM_RESOURCE_WRITE_CAPABILITY,
      resolveActiveTeamCapabilities: deps.resolveActiveTeamCapabilities,
    });
    if (!scopeResolution.ok) {
      return NextResponse.json(
        { error: scopeResolution.error },
        { status: scopeResolution.status }
      );
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return NextResponse.json(
        { error: `${path}${issue?.message ?? "Invalid request"}` },
        { status: 400 }
      );
    }
    const outputErrors = validateClassifyOutput("The node", parsed.data.output);
    if (outputErrors.length > 0) {
      return NextResponse.json({ error: outputErrors[0] }, { status: 400 });
    }

    const outcome = await deps.classify({
      question: parsed.data.question,
      output: parsed.data.output,
      state: parsed.data.state,
      minConfidence: parsed.data.minConfidence ?? null,
      scope: {
        surface: "automation_test",
        userId,
        teamId: scopeResolution.scope.productTeamId,
      },
      metadata: { test: true },
    });
    return outcome.ok
      ? NextResponse.json({ result: outcome.result })
      : NextResponse.json({ error: outcome.message }, { status: 503 });
  };
}

export const POST = createClassifyTestPostHandler();
