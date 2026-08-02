"use server";

import {
  recordUnsubscribe,
  verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe";

export type UnsubscribeActionResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid_token" | "storage_error" };

export async function unsubscribeAction(
  formData: FormData
): Promise<UnsubscribeActionResult> {
  const email = formData.get("email");
  const token = formData.get("t");
  const verified = verifyUnsubscribeToken(email, token);
  if (!verified.ok) return { ok: false, reason: "invalid_token" };

  const recorded = await recordUnsubscribe(verified.email, "landing_page");
  if (!recorded.ok) return { ok: false, reason: "storage_error" };
  return { ok: true, email: verified.email };
}
