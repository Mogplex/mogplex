import { NextResponse } from "next/server";
import {
  allowsCliPatApiPath as allowsCliPatApiAuth,
  allowsMachineApiPath as allowsMachineApiAuth,
} from "@/lib/auth-route-policy";
import { ACTIVE_TEAM_HEADER } from "@/lib/team-capabilities";

const INTERNAL_AUTHORIZATION_HEADER = "authorization";
const CLI_PAT_AUTHORIZATION_HEADER = INTERNAL_AUTHORIZATION_HEADER;
const INTERNAL_DELEGATED_USER_HEADER = "x-delegated-user-id";
const PLAYWRIGHT_AUTH_BYPASS_HEADER = "x-mogplex-e2e-auth";
export const PLAYWRIGHT_USER_ID_HEADER = "x-mogplex-e2e-user-id";
const PAT_BEARER_PREFIX = "Bearer mog_";

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get(INTERNAL_AUTHORIZATION_HEADER);
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length);
}

export function getCronSecret() {
  return process.env.CRON_SECRET?.trim() || null;
}

export function getInternalApiSecret() {
  return process.env.INTERNAL_API_SECRET?.trim() || null;
}

export function buildInternalApiHeaders(
  userId?: string,
  options?: { teamId?: string | null }
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (!userId) return headers;

  const secret = getInternalApiSecret();
  if (!secret) {
    throw new Error(
      "INTERNAL_API_SECRET is required for delegated internal API calls"
    );
  }

  headers.Authorization = `Bearer ${secret}`;
  headers["X-Delegated-User-Id"] = userId;
  if (options?.teamId?.trim()) {
    headers[ACTIVE_TEAM_HEADER] = options.teamId.trim();
  }
  return headers;
}

export function getDelegatedUserIdFromRequest(request: Request) {
  const secret = getInternalApiSecret();
  const delegatedUserId =
    request.headers.get(INTERNAL_DELEGATED_USER_HEADER)?.trim() || null;
  const bearerToken = getBearerToken(request);

  if (!secret || !delegatedUserId || !bearerToken) return null;
  if (!constantTimeEqual(bearerToken, secret)) return null;

  return delegatedUserId;
}

export type MachineApiAuthResult =
  | { type: "not_applicable" }
  | { type: "authorized" }
  | { type: "missing_secret" }
  | { type: "unauthorized" };

export function getMachineApiAuthResult(
  request: Request,
  pathname: string
): MachineApiAuthResult {
  if (!allowsMachineApiAuth(pathname)) {
    return { type: "not_applicable" };
  }

  const secret = getCronSecret();
  if (!secret) {
    return { type: "missing_secret" };
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken || !constantTimeEqual(bearerToken, secret)) {
    return { type: "unauthorized" };
  }

  return { type: "authorized" };
}

export function buildMachineApiAuthFailureResponse(
  result: Extract<
    MachineApiAuthResult,
    { type: "missing_secret" | "unauthorized" }
  >
) {
  if (result.type === "missing_secret") {
    return NextResponse.json(
      { error: "CRON_SECRET_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function requireMachineApiAuth(request: Request, pathname: string) {
  const result = getMachineApiAuthResult(request, pathname);
  if (result.type === "authorized" || result.type === "not_applicable") {
    return null;
  }

  return buildMachineApiAuthFailureResponse(result);
}

/**
 * Detect a CLI Personal Access Token request targeting a route that is
 * intentionally PAT-aware. The middleware delegates these to the route handler,
 * which runs the real validation in `getResolvedAuth` -> `resolveApiKey`
 * (lib/auth.ts). We intentionally reuse the standard Authorization header here;
 * the `mog_` token prefix is what distinguishes CLI PATs from machine secrets.
 */
export function isCliPatApiRequest(request: Request, pathname: string) {
  if (!allowsCliPatApiAuth(pathname)) return false;

  const authorization = request.headers.get(CLI_PAT_AUTHORIZATION_HEADER);
  return Boolean(authorization?.startsWith(PAT_BEARER_PREFIX));
}

/**
 * Let the dedicated Mogplex v1 routes validate PAT and OAuth bearer tokens.
 * This delegation is path-bounded; no other API accepts arbitrary bearers.
 */
export function isMogplexBearerApiRequest(request: Request, pathname: string) {
  const isMogplexApiPath =
    pathname === "/api/v1/mogplex" || pathname.startsWith("/api/v1/mogplex/");
  if (!isMogplexApiPath) return false;
  return Boolean(getBearerToken(request));
}

export function hasPlaywrightAuthBypass(request: Request) {
  if (process.env.PLAYWRIGHT !== "1") return false;

  const expected = process.env.PLAYWRIGHT_AUTH_BYPASS_SECRET?.trim();
  const provided = request.headers.get(PLAYWRIGHT_AUTH_BYPASS_HEADER)?.trim();

  if (!expected || !provided) return false;
  return constantTimeEqual(provided, expected);
}

export function getPlaywrightUserIdFromHeaders(headers: Pick<Headers, "get">) {
  if (process.env.PLAYWRIGHT !== "1") return null;

  const expected = process.env.PLAYWRIGHT_AUTH_BYPASS_SECRET?.trim();
  const provided = headers.get(PLAYWRIGHT_AUTH_BYPASS_HEADER)?.trim();
  const userId =
    headers.get(PLAYWRIGHT_USER_ID_HEADER)?.trim() ||
    headers.get(INTERNAL_DELEGATED_USER_HEADER)?.trim();

  if (!expected || !provided || !userId) return null;
  if (!constantTimeEqual(provided, expected)) return null;

  return userId;
}
