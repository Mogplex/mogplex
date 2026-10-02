export const CONTROL_TURN_RUNNING_MESSAGE =
  "A turn is already running on this conversation.";

export function isControlTurnConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "23505" &&
    (error.message === CONTROL_TURN_RUNNING_MESSAGE ||
      error.message.includes('"control_conversation_active_turn"'))
  );
}
