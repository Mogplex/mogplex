import crypto from "node:crypto";

export const FLOW_WEBHOOK_SIGNATURE_HEADER = "x-mogplex-signature";
export const FLOW_WEBHOOK_DELIVERY_HEADER = "x-mogplex-delivery";

export function generateFlowWebhookSecret() {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

export async function storeFlowWebhookSecret(input: {
  flowId: string;
  userId: string;
  secret: string;
}) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { error } = await supabaseAdmin.rpc("store_flow_webhook_secret", {
    p_flow_id: input.flowId,
    p_user_id: input.userId,
    p_secret: input.secret,
  });
  if (error) {
    throw new Error(
      `Failed to store workflow webhook secret: ${error.message}`
    );
  }
}

export async function getFlowWebhookSecret(flowId: string) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin.rpc("get_flow_webhook_secret", {
    p_flow_id: flowId,
  });
  if (error) {
    throw new Error(`Failed to load workflow webhook secret: ${error.message}`);
  }
  return typeof data === "string" && data ? data : null;
}

export function signFlowWebhookPayload(rawBody: string, secret: string) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
}

export function verifyFlowWebhookSignature(input: {
  rawBody: string;
  secret: string;
  signature: string | null;
}) {
  if (!input.signature) return false;
  const expected = Buffer.from(
    signFlowWebhookPayload(input.rawBody, input.secret)
  );
  const received = Buffer.from(input.signature);
  return (
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received)
  );
}
