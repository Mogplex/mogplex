import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  listUsableModelIdsForScope,
  resolveStoredUserDefaultModelId,
} from "@/lib/models/default-model";
import { parseFallbackModelIds } from "@/lib/models/fallback-preferences";

export function createModelChainHandlers(
  overrides: { requireUserId?: typeof requireUserId } = {}
) {
  const authenticate = overrides.requireUserId ?? requireUserId;
  return {
    async GET() {
      const userId = await authenticate();
      if (userId instanceof Response) return userId;
      try {
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .select("default_model, fallback_model_ids")
          .eq("id", userId)
          .single();
        if (error || !data) throw new Error("Missing profile");
        return NextResponse.json({
          primary:
            data.default_model ??
            (await resolveStoredUserDefaultModelId(userId)) ??
            "",
          fallbacks: data.fallback_model_ids ?? [],
        });
      } catch {
        return NextResponse.json(
          { error: "Unable to load model chain" },
          { status: 500 }
        );
      }
    },
    async PATCH(request: Request) {
      const userId = await authenticate();
      if (userId instanceof Response) return userId;
      const body: unknown = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body))
        return NextResponse.json(
          { error: "Invalid model chain" },
          { status: 400 }
        );
      const { primary, fallbacks } = body as Record<string, unknown>;
      const ids = parseFallbackModelIds(fallbacks);
      if (
        typeof primary !== "string" ||
        !primary ||
        !ids ||
        ids.includes(primary)
      )
        return NextResponse.json(
          { error: "Choose a primary and up to 4 different gateway fallbacks" },
          { status: 400 }
        );
      try {
        const usable = new Set(await listUsableModelIdsForScope(userId));
        if (![primary, ...ids].every((id) => usable.has(id)))
          return NextResponse.json(
            { error: "Chain models must be enabled and available" },
            { status: 400 }
          );
        const previous = await resolveStoredUserDefaultModelId(userId);
        const { error } = await supabaseAdmin.rpc("save_model_chain", {
          p_user_id: userId,
          p_primary: primary,
          p_fallbacks: ids,
          p_previous_resolved: previous ?? primary,
        });
        if (error) throw new Error("Save failed");
        return NextResponse.json({ primary, fallbacks: ids });
      } catch {
        return NextResponse.json(
          { error: "Unable to save model chain. No changes were applied." },
          { status: 500 }
        );
      }
    },
  };
}

export const { GET, PATCH } = createModelChainHandlers();
