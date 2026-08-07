export async function loadFlowAssistantChatRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("@/app/api/flows/[id]/chat/route");
}

export function makeRequest(body: unknown, headers?: HeadersInit) {
  const requestHeaders = new Headers({ "Content-Type": "application/json" });
  for (const [key, value] of new Headers(headers).entries()) {
    requestHeaders.set(key, value);
  }
  return new Request("http://localhost/api/flows/flow-1/chat", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

export const params = Promise.resolve({ id: "flow-1" });

export const allowLimits = (async () => ({
  allowed: true,
  claimId: "claim-1",
})) as never;

export const noopRelease = (async () => true) as never;
export const noopRecord = (async () => undefined) as never;

export function createReleaseProbe() {
  let markReleased: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  return { markReleased, released };
}
