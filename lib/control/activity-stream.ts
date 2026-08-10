import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";
import type { UIMessage } from "ai";

/**
 * CLI-style activity entries derived from the control chat's UI messages.
 * The right rail's Terminal tab renders these as a live stream of what the
 * agent is doing, similar to watching a CLI agent work.
 */
export type ActivityEntry =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: string;
      state: "running" | "done" | "failed";
      output?: string;
      error?: string;
    }
  | {
      kind: "approval";
      id: string;
      name: string;
      state: "requested" | "approved" | "denied";
    };

const MAX_INLINE = 140;

function summarize(value: unknown): string {
  if (value === undefined) return "…";
  const raw =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "…");
  return raw.length > MAX_INLINE ? `${raw.slice(0, MAX_INLINE)}…` : raw;
}

export function buildActivityEntries(messages: UIMessage[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const msg of messages) {
    if (!msg.parts || !Array.isArray(msg.parts)) continue;

    if (msg.role === "user") {
      const text = msg.parts
        .filter(
          (part): part is { type: "text"; text: string } =>
            part.type === "text" && "text" in part
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) entries.push({ kind: "user", id: msg.id, text });
      continue;
    }

    if (msg.role !== "assistant") continue;

    for (const [index, part] of msg.parts.entries()) {
      if (typeof part !== "object" || part == null || !("type" in part)) {
        continue;
      }
      const id = `${msg.id}-${index}`;

      if (isToolOrDynamicToolUIPart(part)) {
        const name = getToolOrDynamicToolName(part);
        const state = "state" in part ? String(part.state) : "";

        if (state === "approval-requested") {
          entries.push({ kind: "approval", id, name, state: "requested" });
          continue;
        }
        if (state === "approval-responded" || state === "output-denied") {
          const approval =
            "approval" in part
              ? (part.approval as { approved?: boolean } | undefined)
              : undefined;
          entries.push({
            kind: "approval",
            id,
            name,
            state: approval?.approved === true ? "approved" : "denied",
          });
          continue;
        }
        if (state === "output-error") {
          entries.push({
            kind: "tool",
            id,
            name,
            input: summarize("input" in part ? part.input : undefined),
            state: "failed",
            error:
              "errorText" in part ? String(part.errorText) : "unknown error",
          });
          continue;
        }
        if (state === "output-available") {
          entries.push({
            kind: "tool",
            id,
            name,
            input: summarize("input" in part ? part.input : undefined),
            state: "done",
            output: summarize("output" in part ? part.output : undefined),
          });
          continue;
        }
        entries.push({
          kind: "tool",
          id,
          name,
          input: summarize("input" in part ? part.input : undefined),
          state: "running",
        });
        continue;
      }

      if (part.type === "text" && "text" in part) {
        const text = String(part.text).trim();
        if (!text) continue;
        const streaming = "state" in part && part.state === "streaming";
        entries.push({ kind: "text", id, text, streaming });
      }
    }
  }

  return entries;
}

/** Tool names that mutate files; the Diffs tab lists these from the stream. */
const FILE_MUTATION_PATTERN = /write|edit|patch|apply|create_file|delete/i;

export type FileMutation = {
  id: string;
  tool: string;
  path: string;
  state: "running" | "done" | "failed";
};

export function collectFileMutations(messages: UIMessage[]): FileMutation[] {
  const mutations: FileMutation[] = [];

  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.parts) continue;

    for (const [index, part] of msg.parts.entries()) {
      if (!isToolOrDynamicToolUIPart(part)) continue;
      const name = getToolOrDynamicToolName(part);
      if (!FILE_MUTATION_PATTERN.test(name)) continue;

      const input =
        "input" in part && typeof part.input === "object" && part.input !== null
          ? (part.input as Record<string, unknown>)
          : {};
      const path =
        input.path ?? input.file_path ?? input.filePath ?? input.filename;
      const rawState = "state" in part ? String(part.state) : "";
      const state =
        rawState === "output-available"
          ? "done"
          : rawState === "output-error"
            ? "failed"
            : "running";

      mutations.push({
        id: `${msg.id}-${index}`,
        tool: name,
        path: typeof path === "string" ? path : "(unknown file)",
        state,
      });
    }
  }

  return mutations;
}
