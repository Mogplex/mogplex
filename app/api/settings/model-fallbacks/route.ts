import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { ACCOUNT_FALLBACK_MODEL_MAX_COUNT } from "@/lib/models/fallback-limits";
import { listUsableModelIdsForScope } from "@/lib/models/default-model";
import {
  loadFallbackModelPreference,
  parseFallbackModelIds,
  saveFallbackModelPreference,
} from "@/lib/models/fallback-preferences";

const defaultDeps = {
  requireUserId,
  loadFallbackModelPreference,
  listUsableModelIdsForScope,
  saveFallbackModelPreference,
};

export function createModelFallbackHandlers(
  overrides: Partial<typeof defaultDeps> = {}
) {
  const deps = { ...defaultDeps, ...overrides };
  return {
    async GET() {
      const userId = await deps.requireUserId();
      if (userId instanceof Response) return userId;
      try {
        return NextResponse.json({
          fallback_model_ids: await deps.loadFallbackModelPreference(userId),
        });
      } catch {
        return NextResponse.json(
          { error: "Unable to load fallback models" },
          { status: 500 }
        );
      }
    },
    async PATCH(request: Request) {
      const userId = await deps.requireUserId();
      if (userId instanceof Response) return userId;
      const body = await request.json().catch(() => null);
      if (
        Array.isArray(body?.fallback_model_ids) &&
        body.fallback_model_ids.length > ACCOUNT_FALLBACK_MODEL_MAX_COUNT
      )
        return NextResponse.json(
          {
            error: `Choose up to ${ACCOUNT_FALLBACK_MODEL_MAX_COUNT} fallback models`,
          },
          { status: 400 }
        );
      const ids = parseFallbackModelIds(body?.fallback_model_ids);
      if (!ids)
        return NextResponse.json(
          { error: "Choose different gateway models" },
          { status: 400 }
        );
      try {
        const usable = new Set(await deps.listUsableModelIdsForScope(userId));
        if (ids.some((id) => !usable.has(id)))
          return NextResponse.json(
            { error: "Fallback models must be enabled and available" },
            { status: 400 }
          );
        await deps.saveFallbackModelPreference(userId, ids);
        return NextResponse.json({ fallback_model_ids: ids });
      } catch {
        return NextResponse.json(
          { error: "Unable to save fallback models" },
          { status: 500 }
        );
      }
    },
  };
}

export const { GET, PATCH } = createModelFallbackHandlers();
