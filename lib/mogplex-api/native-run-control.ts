import { createTableEventListener } from "@/lib/db/table-event-listener";
import { loadOwnedAiCall } from "@/lib/interactive-runs";

const defaultDeps = {
  createListener: createTableEventListener,
  loadCall: loadOwnedAiCall,
};

/** Subscribe before reading so cancellation during startup cannot be missed. */
export async function createNativeRunControl(
  userId: string,
  aiCallId: string,
  deps = defaultDeps
) {
  const controller = new AbortController();
  const listener = await deps.createListener();
  let cancelled = false;
  let pending = Promise.resolve();
  const check = async () => {
    const call = await deps.loadCall(userId, aiCallId);
    if (!call) throw new Error("Agent run no longer exists");
    if (
      call.control_state === "cancel_requested" ||
      call.control_state === "cancelled" ||
      call.status === "cancelled"
    ) {
      cancelled = true;
      controller.abort(new Error("Agent run cancelled"));
    }
  };
  listener.onError((error) => controller.abort(error));
  listener.onNotification((event) => {
    if (
      event.table !== "ai_calls" ||
      event.id !== aiCallId ||
      event.user_id !== userId
    )
      return;
    pending = pending.then(check).catch((error) => controller.abort(error));
  });
  try {
    await check();
  } catch (error) {
    await listener.end();
    throw error;
  }
  return {
    signal: controller.signal,
    isCancelled: () => cancelled,
    async close() {
      await listener.end();
      await pending;
    },
  };
}
