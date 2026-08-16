import { createHmac, timingSafeEqual } from "node:crypto";
import { findCapacityAddOn } from "@/lib/billing/capacity-catalog";

export const CAPACITY_PREVIEW_TTL_SECONDS = 10 * 60;

export type CapacityChangeAction = "increase" | "decrease" | "cancel";

export type CapacityChangePreviewRequest = {
  lookupKey: string;
  quantity: number;
  effectiveAction: CapacityChangeAction;
};

export type CapacityChangePreviewTokenPayload = {
  version: 1;
  accountId: string;
  subscriptionId: string;
  subscriptionItemId: string | null;
  lookupKey: string;
  currentQuantity: number;
  targetQuantity: number;
  action: CapacityChangeAction;
  prorationDate: number;
  effectiveAt: number;
  expiresAt: number;
};

export type CapacityChangeConfirmationRequest = {
  previewToken: string;
  attemptId: string;
};

export type CapacityChangeValidation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ATTEMPT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAction(value: unknown): value is CapacityChangeAction {
  return value === "increase" || value === "decrease" || value === "cancel";
}

export function validateCapacityChangePreviewRequest(
  body: unknown
): CapacityChangeValidation<CapacityChangePreviewRequest> {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body" };
  const { lookupKey, quantity, effectiveAction } = body;
  if (typeof lookupKey !== "string" || !findCapacityAddOn(lookupKey)) {
    return { ok: false, error: "Unknown capacity add-on" };
  }
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 0) {
    return {
      ok: false,
      error: "Capacity add-on quantity must be a nonnegative integer",
    };
  }
  if (!isAction(effectiveAction)) {
    return { ok: false, error: "Unknown capacity change action" };
  }
  return {
    ok: true,
    value: {
      lookupKey,
      quantity: quantity as number,
      effectiveAction,
    },
  };
}

export function validateCapacityChangeConfirmationRequest(
  body: unknown
): CapacityChangeValidation<CapacityChangeConfirmationRequest> {
  if (!isRecord(body)) return { ok: false, error: "Invalid request body" };
  const { previewToken, attemptId } = body;
  if (
    typeof previewToken !== "string" ||
    previewToken.length === 0 ||
    previewToken.length > 4_096
  ) {
    return { ok: false, error: "Invalid capacity preview" };
  }
  if (typeof attemptId !== "string" || !ATTEMPT_ID.test(attemptId)) {
    return { ok: false, error: "Invalid capacity change attempt" };
  }
  return { ok: true, value: { previewToken, attemptId } };
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("mogplex-capacity-preview-v1\0")
    .update(encodedPayload)
    .digest();
}

export function signCapacityChangePreview(
  payload: CapacityChangePreviewTokenPayload,
  secret: string
): string {
  if (!secret) throw new Error("Capacity preview signing secret is missing");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  return `${encodedPayload}.${signature(encodedPayload, secret).toString(
    "base64url"
  )}`;
}

function invalidPreview(): never {
  throw new TypeError("Invalid capacity preview");
}

function assertPreviewIdentity(
  payload: Partial<CapacityChangePreviewTokenPayload>
) {
  if (payload.version !== 1) invalidPreview();
  if (typeof payload.accountId !== "string") invalidPreview();
  if (typeof payload.subscriptionId !== "string") invalidPreview();
  if (
    payload.subscriptionItemId !== null &&
    typeof payload.subscriptionItemId !== "string"
  ) {
    invalidPreview();
  }
}

function assertPreviewCatalog(
  payload: Partial<CapacityChangePreviewTokenPayload>
) {
  if (
    typeof payload.lookupKey !== "string" ||
    !findCapacityAddOn(payload.lookupKey)
  ) {
    invalidPreview();
  }
  if (!isAction(payload.action)) invalidPreview();
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function assertPreviewNumbers(
  payload: Partial<CapacityChangePreviewTokenPayload>
) {
  if (!isNonnegativeSafeInteger(payload.currentQuantity)) invalidPreview();
  if (!isNonnegativeSafeInteger(payload.targetQuantity)) invalidPreview();
  if (!isPositiveSafeInteger(payload.prorationDate)) invalidPreview();
  if (!isPositiveSafeInteger(payload.effectiveAt)) invalidPreview();
  if (!isPositiveSafeInteger(payload.expiresAt)) invalidPreview();
}

function assertPreviewAction(
  payload: Partial<CapacityChangePreviewTokenPayload>
) {
  const current = payload.currentQuantity;
  const target = payload.targetQuantity;
  if (!isNonnegativeSafeInteger(current) || !isNonnegativeSafeInteger(target)) {
    invalidPreview();
  }
  if (payload.action === "increase" && target > current) return;
  if (payload.action === "decrease" && target > 0 && target < current) return;
  if (payload.action === "cancel" && target === 0 && current > 0) return;
  invalidPreview();
}

function parsePreviewPayload(
  value: unknown
): CapacityChangePreviewTokenPayload {
  if (!isRecord(value)) invalidPreview();
  const payload = value as Partial<CapacityChangePreviewTokenPayload>;
  assertPreviewIdentity(payload);
  assertPreviewCatalog(payload);
  assertPreviewNumbers(payload);
  assertPreviewAction(payload);
  return payload as CapacityChangePreviewTokenPayload;
}

function tokenParts(token: string): [string, string] {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) invalidPreview();
  return [parts[0], parts[1]];
}

function decodeSignature(encoded: string): Buffer {
  try {
    return Buffer.from(encoded, "base64url");
  } catch {
    invalidPreview();
  }
}

function assertValidSignature(input: {
  encodedPayload: string;
  encodedSignature: string;
  secret: string;
}) {
  const actual = decodeSignature(input.encodedSignature);
  const expected = signature(input.encodedPayload, input.secret);
  if (actual.toString("base64url") !== input.encodedSignature) invalidPreview();
  if (actual.length !== expected.length) invalidPreview();
  if (!timingSafeEqual(actual, expected)) invalidPreview();
}

function decodePayload(encoded: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    invalidPreview();
  }
}

export function verifyCapacityChangePreview(input: {
  token: string;
  secret: string;
  nowSeconds: number;
}): CapacityChangePreviewTokenPayload {
  if (!input.secret)
    throw new Error("Capacity preview signing secret is missing");
  const [encodedPayload, encodedSignature] = tokenParts(input.token);
  assertValidSignature({
    encodedPayload,
    encodedSignature,
    secret: input.secret,
  });
  const payload = parsePreviewPayload(decodePayload(encodedPayload));
  if (payload.expiresAt <= input.nowSeconds) {
    throw new RangeError("Capacity preview has expired");
  }
  return payload;
}

export function capacityChangeIdempotencyKey(
  accountId: string,
  attemptId: string
): string {
  if (!accountId || !ATTEMPT_ID.test(attemptId)) {
    throw new TypeError("Invalid capacity change idempotency scope");
  }
  return `capacity-change:${accountId}:${attemptId}`;
}
