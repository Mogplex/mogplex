import { z } from "zod";
import { resolveApiKey } from "@/lib/auth/api-key";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import {
  listMogplexApiSkills,
  MOGPLEX_API_SKILLS_MAX_LIMIT,
} from "@/lib/mogplex-api/skills";
import type { NextRequest } from "next/server";

const querySchema = z.object({
  q: z.string().trim().max(500).optional(),
  repoId: z.string().uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MOGPLEX_API_SKILLS_MAX_LIMIT)
    .optional(),
});

export function createMogplexApiSkillsGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    listSkills?: typeof listMogplexApiSkills;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const listSkills = overrides.listSkills ?? listMogplexApiSkills;
  return async function GET(request: NextRequest) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!parsed.success) {
      return mogplexApiError(
        "BAD_REQUEST",
        parsed.error.issues[0]?.message ?? "Invalid query",
        400
      );
    }
    try {
      return mogplexApiSuccess(
        await listSkills({
          userId: user.userId,
          repoId: parsed.data.repoId ?? null,
          query: parsed.data.q ?? null,
          limit: parsed.data.limit,
        })
      );
    } catch (error) {
      console.error("[mogplex-api/skills] failed to list skills", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to list skills", 500);
    }
  };
}

export const GET = createMogplexApiSkillsGetHandler();
