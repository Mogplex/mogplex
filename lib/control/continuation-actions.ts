import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchControlContinuation } from "./continuation-dispatch";
import { loadControlContinuation } from "./continuation-store";

/** Cancelling a handoff stops its coordinator, not its workers or sandbox. */
export async function actOnControlContinuation(
  userId: string,
  id: string,
  action: "cancel" | "retry_delivery",
  deps: NonNullable<Parameters<typeof dispatchControlContinuation>[2]> = {}
) {
  const client = deps.client ?? supabaseAdmin;
  const ticket = await loadControlContinuation(userId, id, client);
  if (!ticket) return { status: 404, error: "Follow-up not found." };
  if (action === "retry_delivery") {
    if (ticket.status !== "ready")
      return {
        status: 409,
        error:
          "This follow-up cannot be requeued. Review the saved conversation before continuing.",
      };
    await dispatchControlContinuation(userId, id, deps);
    return { status: 200 };
  }
  if (ticket.status === "cancelled") return { status: 200 };
  if (!["waiting", "ready", "running"].includes(ticket.status))
    return { status: 409, error: "This follow-up is no longer active." };
  const { data, error } = await client
    .from("control_continuations")
    .update({
      status: "cancelled",
      error:
        "Coordinator follow-up cancelled. Workers and sandbox were left unchanged.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .in("status", ["waiting", "ready", "running"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not cancel the coordinator follow-up.");
  return data
    ? { status: 200 }
    : { status: 409, error: "The follow-up changed. Refresh its status." };
}
