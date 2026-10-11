/** A server-owned ai_call identifies every provider request in one harness run. */
export function harnessGatewayTag(aiCallId: string) {
  if (!/^[A-Za-z0-9_-]{1,56}$/.test(aiCallId))
    throw new Error("Invalid harness AI call ID");
  return `ai-call:${aiCallId}`;
}

export function harnessGatewayHeaders(aiCallId?: string) {
  return aiCallId
    ? { "ai-reporting-tags": `surface:harness,${harnessGatewayTag(aiCallId)}` }
    : undefined;
}
