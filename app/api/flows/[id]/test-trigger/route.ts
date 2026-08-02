import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { getStartConfig } from "@/lib/flows/graph";
import { dispatchFlowTrigger } from "@/lib/flows/trigger-dispatch";

type TestTriggerRouteDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedFlow: typeof import("@/lib/flows/api").loadOwnedFlow;
  dispatch: typeof dispatchFlowTrigger;
  randomId: () => string;
};

export function createFlowTestTriggerPostHandler(
  overrides: Partial<TestTriggerRouteDeps> = {}
) {
  const deps: TestTriggerRouteDeps = {
    requireUserId,
    loadOwnedFlow: async (userId, flowId) => {
      const { loadOwnedFlow } = await import("@/lib/flows/api");
      return loadOwnedFlow(userId, flowId);
    },
    dispatch: dispatchFlowTrigger,
    randomId: () => crypto.randomUUID(),
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const flow = await deps.loadOwnedFlow(userId, id);
    const graph = flow?.published_version?.graph;
    if (flow?.status !== "active" || !graph) {
      return NextResponse.json(
        { error: "Publish and activate this workflow before testing it." },
        { status: 400 }
      );
    }

    const start = getStartConfig(graph);
    if (!start) {
      return NextResponse.json(
        { error: "Workflow trigger is missing." },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      payload?: unknown;
    };
    const payload =
      body.payload &&
      typeof body.payload === "object" &&
      !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {
            test: true,
            sent_at: new Date().toISOString(),
            message: "Test event from the Workflows editor",
          };

    const result = await deps.dispatch({
      flowId: id,
      event: start.event,
      expectedUserId: userId,
      idempotencyKey: `flow-test:${id}:${deps.randomId()}`,
      payload,
      startSource: "api",
    });
    if (!result.matched) {
      return NextResponse.json(
        { error: "The published trigger no longer matches this workflow." },
        { status: 409 }
      );
    }
    return NextResponse.json(result, {
      status: result.outcome === "queued" ? 202 : 200,
    });
  };
}

export const POST = createFlowTestTriggerPostHandler();
