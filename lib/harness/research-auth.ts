import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resolveAppBaseUrl } from "@/lib/agents/tools/shared";
import type { AiCall } from "@/lib/types";

const claimsSchema = z.object({
  purpose: z.literal("harness-web-research"),
  userId: z.string().min(1),
  aiCallId: z.string().min(1),
  sandboxRecordId: z.string().min(1),
  expiresAt: z.number().int(),
});
export type ResearchClaims = z.infer<typeof claimsSchema>;

type ResearchRun = Pick<
  AiCall,
  | "id"
  | "user_id"
  | "status"
  | "control_state"
  | "cancel_requested_at"
  | "metadata"
>;
export function isActiveResearchRun(
  run: ResearchRun | null,
  claims: ResearchClaims
): run is ResearchRun {
  if (run === null) return false;
  return (
    run.id === claims.aiCallId &&
    run.user_id === claims.userId &&
    ["pending", "streaming"].includes(run.status) &&
    run.control_state === "active" &&
    !run.cancel_requested_at &&
    run.metadata.sandbox_record_id === claims.sandboxRecordId
  );
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest();
}

export function buildHarnessResearchEnv(context: {
  userId: string;
  aiCallId: string;
  id: string;
}): Record<string, string> {
  const secret = process.env.EXA_RESEARCH_SECRET?.trim();
  if (!secret || secret === "[SENSITIVE]") return {};
  const claims: ResearchClaims = {
    purpose: "harness-web-research",
    userId: context.userId,
    aiCallId: context.aiCallId,
    sandboxRecordId: context.id,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    MOGPLEX_RESEARCH_MCP_URL: new URL(
      "/api/harness-research/mcp",
      resolveAppBaseUrl()
    ).href,
    MOGPLEX_RESEARCH_TOKEN: `${payload}.${signature(payload, secret).toString("base64url")}`,
  };
}

export function verifyResearchToken(token: string): ResearchClaims | null {
  const secret = process.env.EXA_RESEARCH_SECRET?.trim();
  if (!secret || secret === "[SENSITIVE]" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const actual = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0], secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    const claims = claimsSchema.safeParse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString())
    );
    return claims.success && claims.data.expiresAt > Date.now()
      ? claims.data
      : null;
  } catch {
    return null;
  }
}

/** Only the run-scoped token is passed to clients; never the platform Exa key. */
export function codexResearchArgs(env: Record<string, string>): string[] {
  if (!env.MOGPLEX_RESEARCH_MCP_URL || !env.MOGPLEX_RESEARCH_TOKEN) return [];
  return [
    `mcp_servers.mogplex_research.url=${JSON.stringify(env.MOGPLEX_RESEARCH_MCP_URL)}`,
    'mcp_servers.mogplex_research.bearer_token_env_var="MOGPLEX_RESEARCH_TOKEN"',
  ].flatMap((value) => ["-c", value]);
}
