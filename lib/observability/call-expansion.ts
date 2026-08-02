import type { AiCall } from "@/lib/types";

export function getExpandedCallRowIds(
  calls: Pick<AiCall, "id" | "sandbox_context">[],
  input: {
    callId?: string;
    sandboxRecordId?: string;
  } = {}
) {
  if (input.callId) {
    const matchingCall = calls.find((call) => call.id === input.callId);
    if (matchingCall) return [matchingCall.id];
  }

  if (!input.sandboxRecordId) return;

  const matchingCall = calls.find(
    (call) => call.sandbox_context?.sandbox_record_id === input.sandboxRecordId
  );
  return matchingCall ? [matchingCall.id] : [];
}
