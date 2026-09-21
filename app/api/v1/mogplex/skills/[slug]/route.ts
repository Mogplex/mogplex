import { z } from "zod";
import { resolveApiKey } from "@/lib/auth/api-key";
import {
  mogplexApiError,
  mogplexApiSuccess,
  resolveMogplexApiUser,
} from "@/lib/mogplex-api/response";
import { requireScope } from "@/lib/mogplex-api/scopes";
import { getMogplexApiSkill } from "@/lib/mogplex-api/skills";
import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ slug: string }> };

const slugSchema = z.string().trim().min(1).max(200);
const querySchema = z.object({ repoId: z.string().uuid().optional() });

export function createMogplexApiSkillGetHandler(
  overrides: {
    resolveApiKey?: typeof resolveApiKey;
    getSkill?: typeof getMogplexApiSkill;
  } = {}
) {
  const resolveKey = overrides.resolveApiKey ?? resolveApiKey;
  const getSkill = overrides.getSkill ?? getMogplexApiSkill;
  return async function GET(request: NextRequest, context: RouteContext) {
    const user = await resolveMogplexApiUser(request, {
      resolveApiKey: resolveKey,
    });
    if (!user.ok) return user.response;
    const forbidden = requireScope(user, "read");
    if (forbidden) return forbidden;

    const slug = slugSchema.safeParse((await context.params).slug);
    const query = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    if (!slug.success || !query.success) {
      return mogplexApiError("BAD_REQUEST", "Invalid skill request", 400);
    }
    try {
      const skill = await getSkill({
        userId: user.userId,
        slug: slug.data,
        repoId: query.data.repoId ?? null,
      });
      if (!skill) return mogplexApiError("NOT_FOUND", "Skill not found", 404);
      return mogplexApiSuccess({ skill });
    } catch (error) {
      console.error("[mogplex-api/skills] failed to load skill", error);
      return mogplexApiError("INTERNAL_ERROR", "Failed to load skill", 500);
    }
  };
}

export const GET = createMogplexApiSkillGetHandler();
