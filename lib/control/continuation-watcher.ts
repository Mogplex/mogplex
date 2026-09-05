import { createTableEventListener } from "@/lib/db/table-event-listener";

/** A live execution lease, never a timer/poll or a waiting background job. */
export async function watchControlContinuation(
  input: {
    userId: string;
    sessionId: string;
    continuationId: string;
    assertCurrent: () => Promise<void>;
    abort: (error: unknown) => void;
  },
  createListener = createTableEventListener
) {
  const listener = await createListener();
  listener.onError(input.abort);
  listener.onNotification((event) => {
    if (event.user_id !== input.userId) return;
    if (
      (event.table === "control_continuations" &&
        event.id === input.continuationId) ||
      (event.table === "control_sessions" && event.id === input.sessionId)
    ) {
      void input.assertCurrent().catch(input.abort);
    }
  });
  try {
    // Subscribe before checking so a superseding turn cannot land in the gap.
    await input.assertCurrent();
  } catch (error) {
    await listener.end();
    throw error;
  }
  return listener;
}
