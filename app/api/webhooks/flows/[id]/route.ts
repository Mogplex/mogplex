import { NextResponse } from "next/server";
import { dispatchFlowTrigger } from "@/lib/flows/trigger-dispatch";
import {
  FLOW_WEBHOOK_DELIVERY_HEADER,
  FLOW_WEBHOOK_SIGNATURE_HEADER,
  getFlowWebhookSecret,
  verifyFlowWebhookSignature,
} from "@/lib/flows/webhook-secret";

export const FLOW_WEBHOOK_MAX_BODY_BYTES = 1_000_000;

type FlowWebhookRouteDeps = {
  getSecret: typeof getFlowWebhookSecret;
  verifySignature: typeof verifyFlowWebhookSignature;
  dispatch: typeof dispatchFlowTrigger;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function readLimitedBody(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return null;
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createFlowWebhookPostHandler(
  overrides: Partial<FlowWebhookRouteDeps> = {}
) {
  const deps: FlowWebhookRouteDeps = {
    getSecret: getFlowWebhookSecret,
    verifySignature: verifyFlowWebhookSignature,
    dispatch: dispatchFlowTrigger,
    ...overrides,
  };

  return async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const deliveryId = request.headers
      .get(FLOW_WEBHOOK_DELIVERY_HEADER)
      ?.trim();
    if (!deliveryId || deliveryId.length > 200) {
      return error(`Missing or invalid ${FLOW_WEBHOOK_DELIVERY_HEADER}`, 400);
    }

    const rawBody = await readLimitedBody(request, FLOW_WEBHOOK_MAX_BODY_BYTES);
    if (rawBody === null) {
      return error("Payload too large", 413);
    }

    const secret = await deps.getSecret(id);
    if (!secret) {
      return error("Webhook is not configured", 404);
    }
    if (
      !deps.verifySignature({
        rawBody,
        secret,
        signature: request.headers.get(FLOW_WEBHOOK_SIGNATURE_HEADER),
      })
    ) {
      return error("Invalid signature", 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return error("Payload must be valid JSON", 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return error("Payload must be a JSON object", 400);
    }

    const result = await deps.dispatch({
      flowId: id,
      event: "webhook",
      idempotencyKey: `flow-webhook:${id}:${deliveryId}`,
      payload: payload as Record<string, unknown>,
      startSource: "webhook",
    });

    if (!result.matched) {
      return error("Active webhook workflow not found", 404);
    }
    return NextResponse.json(result, {
      status: result.outcome === "queued" ? 202 : 200,
    });
  };
}

export const POST = createFlowWebhookPostHandler();
