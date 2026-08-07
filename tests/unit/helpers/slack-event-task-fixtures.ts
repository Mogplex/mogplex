/**
 * Shared fixtures and helpers for slack-event-task tests.
 */

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("should not fetch in this test");
}) as typeof fetch;

export function restoreFetch() {
  globalThis.fetch = originalFetch;
}

export async function loadSlackEventTask() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../../trigger/slack-event");
}

export type AgentResult = {
  finalText: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  stepCount: number;
};

export type Installation = {
  id: string;
  team_id: string;
  team_name: string | null;
  installed_by_user_id: string;
  bot_user_id: string;
  vault_bot_token_id: string;
  scopes: string[];
  authed_user_slack_id: string | null;
  created_at: string;
  updated_at: string;
  repo_agent_enabled?: boolean | null;
  allowed_slack_user_ids?: string[];
  monthly_repo_run_limit?: number;
};

export const baseInstallation: Installation = {
  id: "install-1",
  team_id: "T1",
  team_name: "Mogplex",
  installed_by_user_id: "installer-user",
  bot_user_id: "UBOT",
  vault_bot_token_id: "vault-secret-1",
  scopes: ["chat:write", "app_mentions:read"],
  authed_user_slack_id: "USLACK-INSTALLER",
  created_at: "2026-05-11T00:00:00Z",
  updated_at: "2026-05-11T00:00:00Z",
};

export const mappedAttribution = (
  mogplexUserId = "user-mogplex",
  slackEmail: string | null = "user@example.com",
  githubUsername?: string | null
) => ({
  mode: "mapped_profile" as const,
  mogplexUserId,
  slackEmail,
  ...(githubUsername === undefined ? {} : { githubUsername }),
});

export const installerFallbackAttribution = (
  mogplexUserId = "installer-user",
  slackEmail: string | null = "installer@example.com"
) => ({
  mode: "installer_fallback" as const,
  mogplexUserId,
  slackEmail,
});

export const basePayload = {
  teamId: "T1",
  eventId: "Ev123",
  channelId: "C1",
  threadTs: "1700000000.000100",
  messageTs: "1700000000.000100",
  slackUserId: "USLACK",
  text: "<@UBOT> what's the build status?",
  channelType: "im" as const,
  eventType: "message" as const,
};

export const fixedNow = new Date("2026-05-13T12:00:00.000Z");
export const fixedMonthStartDate = "2026-05-01";

export const agentSuccess = (
  overrides: Partial<AgentResult> = {}
): AgentResult => ({
  finalText: "Build is green",
  finishReason: "stop",
  inputTokens: 100,
  outputTokens: 25,
  totalTokens: 125,
  stepCount: 1,
  ...overrides,
});

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
