// Response building and event recording for request rate limiting.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  DeniedLimitDecision,
  LimitDecision,
  LimitEventInsert,
  LimitRouteKey,
} from "./types";

export function buildLimitResponse(decision: DeniedLimitDecision) {
  return NextResponse.json(
    {
      error: decision.error,
      code: decision.code,
      retryAfterSeconds: decision.retryAfterSeconds,
      limit: decision.limit,
    },
    {
      status: decision.status,
      headers: {
        "Retry-After": String(decision.retryAfterSeconds),
      },
    }
  );
}

async function safeInsertLimitEvent(input: LimitEventInsert) {
  try {
    const { error } = await supabaseAdmin.from("limit_events").insert({
      user_id: input.userId,
      route_key: input.routeKey,
      decision: input.decision,
      claim_id: input.claimId ?? null,
      resource_id: input.resourceId ?? null,
      repo_id: input.repoId ?? null,
      sandbox_id: input.sandboxId ?? null,
      reason: input.reason ?? null,
      limit_name: input.limitName ?? null,
      window_seconds: input.windowSeconds ?? null,
      limit_value: input.limitValue ?? null,
      remaining: input.remaining ?? null,
      retry_after_seconds: input.retryAfterSeconds ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("[limits] failed to insert limit_event", { input, error });
    }
  } catch (error) {
    console.error("[limits] failed to insert limit_event", { input, error });
  }
}

export async function recordLimitDecision(input: {
  userId: string;
  routeKey: LimitRouteKey;
  decision: LimitDecision;
  resourceId?: string | null;
  repoId?: string | null;
  sandboxId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (input.decision.allowed) {
    await safeInsertLimitEvent({
      userId: input.userId,
      routeKey: input.routeKey,
      decision: "allowed",
      claimId: input.decision.claimId ?? null,
      resourceId: input.resourceId,
      repoId: input.repoId,
      sandboxId: input.sandboxId,
      metadata: input.metadata,
    });
    return;
  }

  await safeInsertLimitEvent({
    userId: input.userId,
    routeKey: input.routeKey,
    decision: "denied",
    resourceId: input.resourceId,
    repoId: input.repoId,
    sandboxId: input.sandboxId,
    reason: input.decision.reason,
    limitName: input.decision.limit.name,
    windowSeconds: input.decision.limit.windowSeconds,
    limitValue: input.decision.limit.value,
    remaining: 0,
    retryAfterSeconds: input.decision.retryAfterSeconds,
    metadata: input.metadata,
  });
}

export async function loadAllowedLimitEventTimestamps(input: {
  userId: string;
  routeKey: LimitRouteKey;
  since: string;
  resourceId?: string | null;
}) {
  let query = supabaseAdmin
    .from("limit_events")
    .select("created_at")
    .eq("user_id", input.userId)
    .eq("route_key", input.routeKey)
    .eq("decision", "allowed")
    .gte("created_at", input.since)
    .order("created_at", { ascending: true });

  if (input.resourceId !== undefined) {
    query =
      input.resourceId === null
        ? query.is("resource_id", null)
        : query.eq("resource_id", input.resourceId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to load limit_events for ${input.routeKey}: ${error.message}`
    );
  }

  return (data ?? [])
    .map((entry) => entry.created_at)
    .filter((value): value is string => typeof value === "string");
}
