import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import type { UIMessage } from "ai";

const optionalText = z.string().nullable().optional();
// Direct Postgres returns Date; PostgREST and JSON-returning RPCs return text.
const timestamp = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value.toISOString() : value));
export const controlContinuationContextSchema = z.object({
  model: z.string().min(1),
  repoId: z.string().uuid(),
  missionId: z.string().uuid(),
  sandboxId: optionalText,
  conversationId: optionalText,
  repoFullName: optionalText,
  repoOwner: optionalText,
  repoName: optionalText,
  repoBranch: optionalText,
  repoBaseBranch: optionalText,
  missionTitle: optionalText,
  scope: optionalText,
  target: optionalText,
  permissions: optionalText,
  teamId: optionalText,
  mode: z.literal("run").nullable().optional(),
  enableTools: z.boolean().optional(),
});
export type ControlContinuationContext = z.infer<
  typeof controlContinuationContextSchema
>;
const continuationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  session_id: z.string().uuid(),
  parent_ai_call_id: z.string().uuid(),
  origin_message: z.record(z.string(), z.unknown()),
  worker_run_ids: z.array(z.string().uuid()).min(1),
  request_context: controlContinuationContextSchema,
  instruction: z.string(),
  parent_ready: z.boolean(),
  status: z.enum([
    "waiting",
    "ready",
    "running",
    "finished",
    "needs_input",
    "failed",
    "cancelled",
  ]),
  runtime_run_id: z.string().nullable(),
  resume_ai_call_id: z.string().uuid().nullable(),
  error: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type ControlContinuation = z.infer<typeof continuationSchema>;
type Client = typeof supabaseAdmin;

function parseTicket(data: unknown): ControlContinuation | null {
  if (data === null) return null;
  const parsed = continuationSchema.safeParse(data);
  if (!parsed.success)
    throw new Error("The saved coordinator handoff is invalid.");
  return parsed.data;
}

export async function registerControlContinuation(
  input: {
    userId: string;
    sessionId: string;
    parentAiCallId: string;
    originMessageId: string;
    workerRunIds: string[];
    context: ControlContinuationContext;
    instruction: string;
  },
  client: Client = supabaseAdmin
): Promise<
  | { status: "waiting"; continuation: ControlContinuation }
  | { status: "already_finished" | "needs_input" }
> {
  const context = controlContinuationContextSchema.parse(input.context);
  const { data, error } = await client.rpc("control_register_continuation", {
    p_user_id: input.userId,
    p_session_id: input.sessionId,
    p_parent_ai_call_id: input.parentAiCallId,
    p_origin_message_id: input.originMessageId,
    p_worker_run_ids: input.workerRunIds,
    p_request_context: context,
    p_instruction: redactSecretsInValue(input.instruction),
  });
  if (error) throw new Error("Could not save the coordinator handoff.");
  const result = z
    .object({ status: z.string(), continuation: z.unknown().optional() })
    .parse(data);
  if (result.status === "ok")
    return {
      status: "waiting" as const,
      continuation: parseTicket(result.continuation)!,
    };
  if (result.status === "already_finished" || result.status === "needs_input")
    return { status: result.status };
  throw new Error(
    "The mission or its workers changed. Refresh the conversation before scheduling a follow-up."
  );
}

export async function loadControlContinuation(
  userId: string,
  id: string,
  client: Client = supabaseAdmin
) {
  const { data, error } = await client
    .from("control_continuations")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not load the coordinator handoff.");
  return parseTicket(data);
}

export async function refreshControlContinuation(
  input: {
    userId: string;
    id: string;
    parentAiCallId?: string;
    parentMessage?: UIMessage;
  },
  client: Client = supabaseAdmin
) {
  const { data, error } = await client.rpc("control_refresh_continuation", {
    p_user_id: input.userId,
    p_continuation_id: input.id,
    p_parent_ai_call_id: input.parentAiCallId ?? null,
    p_parent_message: input.parentMessage
      ? redactSecretsInValue(input.parentMessage)
      : null,
  });
  if (error)
    throw new Error("Could not complete the coordinator handoff checkpoint.");
  return parseTicket(data);
}

export async function claimControlContinuation(
  userId: string,
  id: string,
  runtimeRunId: string,
  client: Client = supabaseAdmin
) {
  const { data, error } = await client.rpc("control_claim_continuation", {
    p_user_id: userId,
    p_continuation_id: id,
    p_runtime_run_id: runtimeRunId,
  });
  if (error) throw new Error("Could not claim the coordinator follow-up.");
  return parseTicket(data);
}

export async function assertControlContinuationCurrent(
  userId: string,
  id: string,
  runtimeRunId: string,
  client: Client = supabaseAdmin
) {
  const ticket = await loadControlContinuation(userId, id, client);
  if (ticket?.status !== "running" || ticket.runtime_run_id !== runtimeRunId)
    throw new Error(
      "This coordinator follow-up was cancelled or superseded. No further action is authorized."
    );
}

export async function listControlContinuations(
  userId: string,
  sessionId: string,
  client: Client = supabaseAdmin
) {
  const summary = continuationSchema.pick({
    id: true,
    status: true,
    error: true,
    parent_ready: true,
    updated_at: true,
    worker_run_ids: true,
  });
  const query = () =>
    client
      .from("control_continuations")
      .select("id,status,error,parent_ready,updated_at,worker_run_ids")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
  const active = await query().in("status", ["waiting", "ready", "running"]);
  if (active.error) throw new Error("Could not load coordinator follow-ups.");
  if (active.data?.length) return active.data.map((row) => summary.parse(row));
  // The UI renders all active tickets, or exactly the latest historical ticket.
  // Never load hidden history or saved prompts on each realtime invalidation.
  const latest = await query().limit(1);
  if (latest.error) throw new Error("Could not load coordinator follow-ups.");
  return (latest.data ?? []).map((row) => summary.parse(row));
}

export async function continuationsForWorker(
  userId: string,
  workerId: string,
  client: Client = supabaseAdmin
) {
  const { data, error } = await client
    .from("control_continuations")
    .select("*")
    .eq("user_id", userId)
    .contains("worker_run_ids", [workerId])
    .in("status", ["waiting", "ready"]);
  // Trigger deployments can precede the schema-first app deploy. No app can
  // register handoffs until that migration exists, so old worker completion
  // delivery remains compatible during this narrow transition.
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error)
    throw new Error("Could not find the worker's coordinator handoff.");
  return (data ?? []).map((row) => parseTicket(row)!);
}

export async function updateClaimedControlContinuation(
  input: {
    userId: string;
    id: string;
    runtimeRunId: string;
    status?: "finished" | "needs_input" | "failed";
    aiCallId?: string;
    error?: string | null;
  },
  client: Client = supabaseAdmin
) {
  const { data, error } = await client
    .from("control_continuations")
    .update({
      ...(input.status ? { status: input.status } : {}),
      ...(input.aiCallId ? { resume_ai_call_id: input.aiCallId } : {}),
      ...(input.error === undefined
        ? {}
        : { error: redactSecretsInValue(input.error) }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .eq("runtime_run_id", input.runtimeRunId)
    .eq("status", "running")
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Could not save coordinator follow-up status.");
  return parseTicket(data);
}

export async function recordControlContinuationFailure(
  input: {
    userId: string;
    id: string;
    runtimeRunId: string;
    timedOut?: boolean;
  },
  client: Client = supabaseAdmin
) {
  const { data, error } = await client
    .from("control_continuations")
    .update({
      status: "failed",
      error: input.timedOut
        ? "The coordinator reached its time limit. Saved output is available; it was not replayed."
        : "The coordinator follow-up stopped before finishing. Review its saved output before continuing; it was not replayed.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .in("status", ["ready", "running"])
    .or(`runtime_run_id.is.null,runtime_run_id.eq.${input.runtimeRunId}`)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Could not save the stopped coordinator status.");
  return parseTicket(data);
}
