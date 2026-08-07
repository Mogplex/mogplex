/**
 * Shared fixtures for cli-inference-handler tests.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key";

export function loadHandler() {
  return import("../../../app/api/cli/inference/chat/completions/handler");
}

export function parseSsePayloads(body: string) {
  return body
    .trim()
    .split("\n\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^data:\s*/, ""));
}
