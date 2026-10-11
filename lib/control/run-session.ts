import type { UIMessage } from "ai";
import type { AiCallEvent } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadRunWorkspace } from "@/lib/run-workspace/context";
import { projectRunTranscript } from "@/lib/run-workspace/transcript";
import { presentMogplexApiRunEvent } from "@/lib/mogplex-api/run-control";
import { redactSecretsInValue } from "@/lib/ai-telemetry";
import type { ControlSessionRecord } from "./session-types";

export class ControlRunError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409
  ) {
    super(message);
  }
}

/** An explicit run link imports one reference; it never starts agent execution. */
export async function openRunInControl(
  userId: string,
  runId: string,
  continueChat = false,
  client = supabaseAdmin
): Promise<ControlSessionRecord> {
  const context = await loadRunWorkspace(userId, runId, client);
  if (!context) throw new ControlRunError("Run not found", 404);
  if (
    continueChat &&
    !["success", "failed", "cancelled"].includes(context.status)
  )
    throw new ControlRunError(
      "This run is still active. Send guidance or wait for it to finish.",
      409
    );
  const read = async () => {
    const { data, error } = await client
      .from("control_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("external_run_id", runId)
      .maybeSingle();
    if (error) throw new Error("Could not load the conversation");
    return data as (ControlSessionRecord & { archived: boolean }) | null;
  };
  let session = await read();
  if (!session) {
    const { error } = await client.from("control_sessions").upsert(
      {
        id: runId,
        user_id: userId,
        external_run_id: runId,
        repo_id: context.repo.id,
        title: context.prompt.trim().slice(0, 160) || "Agent task",
        project: context.repo.full_name,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    if (error) throw new Error("Could not open the conversation");
    session = await read();
  }
  if (!session) throw new Error("Could not open the conversation");
  // Following an explicit link restores this task to the visible task list.
  if (session.archived) {
    const { data, error } = await client
      .from("control_sessions")
      .update({ archived: false })
      .eq("id", session.id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (error || !data) throw new Error("Could not restore the conversation");
    session = data as typeof session;
  }
  if (!continueChat || session.messages.length > 0) return session;
  // Read all durable history before enabling continuation. Telemetry is kept as
  // readable text, not fabricated tool calls in the next model conversation.
  const events: AiCallEvent[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await client
      .from("ai_call_events")
      .select("*")
      .eq("user_id", userId)
      .eq("ai_call_id", context.aiCallId)
      .order("created_at")
      .order("id")
      .range(offset, offset + 199);
    if (error) throw new Error("Could not load run history");
    events.push(...((data ?? []) as AiCallEvent[]));
    if (!data || data.length < 200) break;
  }
  const projected = projectRunTranscript(
    runId,
    context.prompt,
    events.map(presentMogplexApiRunEvent),
    context.status
  );
  const messages: UIMessage[] = projected.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part) => {
      if (part.type === "text") return [part];
      if (part.type !== "dynamic-tool") return [];
      return [
        {
          type: "text" as const,
          text: `\n${part.toolName}: ${part.state}\n${JSON.stringify(part.input)}\n${part.state === "output-error" ? part.errorText : part.state === "output-available" ? JSON.stringify(part.output) : ""}\n`,
        },
      ];
    }),
  }));
  for (const guidance of context.guidance ?? [])
    messages.push({
      id: guidance.id,
      role: "user",
      parts: [
        {
          type: "text",
          text: `${guidance.body}\n(${guidance.status === "delivered" ? "Delivered to agent" : "Not applied before the run stopped"})`,
        },
      ],
    });
  const { data, error } = await client
    .from("control_sessions")
    .update({ messages: redactSecretsInValue(messages) })
    .eq("id", session.id)
    .eq("user_id", userId)
    .eq("updated_at", session.updated_at)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("Could not save the conversation");
  if (data) return data as ControlSessionRecord;
  const fresh = await read();
  if (fresh?.messages.length) return fresh;
  throw new ControlRunError(
    "The conversation changed. Try continuing again.",
    409
  );
}
