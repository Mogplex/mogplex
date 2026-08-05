import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";
import { sanitizeObservabilityToolEntry } from "@/lib/observability/user-facing-errors";

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("id, model, type, started_at, tool_calls")
    .eq("user_id", userId)
    .gt("tool_calls_count", 0)
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("observability tool call query failed", error);
    return NextResponse.json(
      { error: "Failed to fetch tool calls" },
      { status: 500 }
    );
  }

  type StoredToolCall = {
    name: string;
    input_preview?: string;
    output_preview?: string;
    input?: unknown;
    output?: unknown;
  };
  const entries = (data || []).flatMap((call) => {
    const tcs = Array.isArray(call.tool_calls)
      ? (call.tool_calls as StoredToolCall[])
      : [];
    return tcs.map((tc, i) => ({
      id: `${call.id}-${i}`,
      name: tc.name,
      input_preview: tc.input_preview || null,
      output_preview: tc.output_preview || null,
      input: tc.input ?? tc.input_preview ?? null,
      output: tc.output ?? tc.output_preview ?? null,
      model: call.model,
      type: call.type,
      started_at: call.started_at,
    }));
  });

  return NextResponse.json(
    entries.map((entry) => sanitizeObservabilityToolEntry(entry))
  );
}
