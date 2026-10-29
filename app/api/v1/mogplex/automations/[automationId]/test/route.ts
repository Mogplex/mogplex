import { resolveApiKey } from "@/lib/auth/api-key";
import type { resolveMogplexOAuthToken } from "@/lib/auth/mogplex-oauth";
import { testMogplexApiAutomation } from "@/lib/mogplex-api/automation-test";
import { mogplexAutomationErrorResponse } from "@/lib/mogplex-api/automation-response";
import { triggerAutomationArgsSchema } from "@/lib/mogplex-api/mcp-schemas";
import { requireMogplexApiIdempotencyKey } from "@/lib/mogplex-api/request";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { isAutomationOnly } from "@/lib/mogplex-api/credential-boundary";
import {
  requireKeyAllowedOn,
  type LoadTeamKeyAccess,
} from "@/lib/mogplex-api/team-key-access";

export function createAutomationTestHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    resolveOAuthToken?: typeof resolveMogplexOAuthToken;
    loadTeamKeyAccess?: LoadTeamKeyAccess;
    testAutomation?: typeof testMogplexApiAutomation;
  } = {}
) {
  return async (
    request: Request,
    { params }: { params: Promise<{ automationId: string }> }
  ) => {
    const user = await resolveMogplexApiUser(request, overrides);
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "write");
    if (forbidden) return forbidden;
    const { automationId } = await params;
    const key = requireMogplexApiIdempotencyKey(request.headers);
    if (!key.ok) return key.response;
    const body = await request.json().catch(() => null);
    const parsed = triggerAutomationArgsSchema.safeParse({
      ...body,
      automationId,
      idempotencyKey: key.value,
    });
    if (!parsed.success)
      return mogplexApiError(
        "BAD_REQUEST",
        "repoId and optional input object are required; unsupported fields are refused.",
        400
      );
    const refusal = await requireKeyAllowedOn(
      user,
      [{ automationId }, { repoId: parsed.data.repoId }],
      overrides.loadTeamKeyAccess
    );
    if (refusal) return refusal;
    try {
      const run = await (overrides.testAutomation ?? testMogplexApiAutomation)({
        ...parsed.data,
        idempotencyKey: key.value,
        userId: user.userId,
        credential: {
          kind: user.credentialKind,
          keyId: user.keyId,
          automationOnly: isAutomationOnly(user),
        },
      });
      return mogplexApiSuccess({ run }, { status: 202 });
    } catch (error) {
      return mogplexAutomationErrorResponse(error, "Failed to test automation");
    }
  };
}

export const POST = createAutomationTestHandler();
