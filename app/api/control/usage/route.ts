import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/auth";

const UUIDISH = /^[0-9a-f-]{36}$/i;
const MAX_CALLS = 200;

/**
 * Sum token usage and cost across a control session's ai_calls. The client
 * derives the call ids from streamed `ai_call_id` message metadata (the chat
 * body carries no conversation id), so this route is keyed by explicit ids
 * rather than by session. ai_calls.cost_usd is populated by the
 * compute_ai_call_cost trigger as soon as tokens land at run finish, then
 * refined by gateway reconciliation.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (userId instanceof Response) return userId;

  const calls = (new URL(req.url).searchParams.get("calls") ?? "")
    .split(",")
    .filter((id) => UUIDISH.test(id))
    .slice(0, MAX_CALLS);

  if (calls.length === 0) {
    return NextResponse.json({
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("ai_calls")
    .select("input_tokens, output_tokens, cost_usd")
    .eq("user_id", userId)
    .in("id", calls);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const row of data ?? []) {
    inputTokens += row.input_tokens ?? 0;
    outputTokens += row.output_tokens ?? 0;
    costUsd += row.cost_usd ?? 0;
  }

  return NextResponse.json({ inputTokens, outputTokens, costUsd });
}
