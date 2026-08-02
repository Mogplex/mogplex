import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import {
  generateFlowWebhookSecret,
  storeFlowWebhookSecret,
} from "@/lib/flows/webhook-secret";

type WebhookSecretRouteDeps = {
  requireUserId: typeof requireUserId;
  loadOwnedFlow: typeof import("@/lib/flows/api").loadOwnedFlow;
  generateSecret: typeof generateFlowWebhookSecret;
  storeSecret: typeof storeFlowWebhookSecret;
  reportError: (error: unknown) => void;
};

export function createFlowWebhookSecretPostHandler(
  overrides: Partial<WebhookSecretRouteDeps> = {}
) {
  const deps: WebhookSecretRouteDeps = {
    requireUserId,
    loadOwnedFlow: async (userId, flowId) => {
      const { loadOwnedFlow } = await import("@/lib/flows/api");
      return loadOwnedFlow(userId, flowId);
    },
    generateSecret: generateFlowWebhookSecret,
    storeSecret: storeFlowWebhookSecret,
    reportError: (error) => {
      console.error("[flow-webhook-secret] Failed to store secret", error);
    },
    ...overrides,
  };

  return async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const userId = await deps.requireUserId();
    if (userId instanceof Response) return userId;

    const { id } = await params;
    const flow = await deps.loadOwnedFlow(userId, id);
    if (!flow) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    const secret = deps.generateSecret();
    try {
      await deps.storeSecret({ flowId: id, userId, secret });
      return NextResponse.json({ secret });
    } catch (error) {
      deps.reportError(error);
      return NextResponse.json(
        { error: "Failed to generate webhook secret" },
        { status: 500 }
      );
    }
  };
}

export const POST = createFlowWebhookSecretPostHandler();
