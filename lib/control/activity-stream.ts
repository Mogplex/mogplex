import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { redactSecretsInText } from "@/lib/ai-telemetry";
import { controlToolOutcome } from "./tool-outcome";

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
const MAX_TERMINAL_LINES = 8;
const MAX_TERMINAL_LINE_LENGTH = 240;

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
            state: controlToolOutcome(state, part.output),
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

/** A bounded, read-only rendering of the sandbox work currently visible to a user. */
export type TerminalActivityEntry = {
  id: string;
  kind: "command" | "sandbox";
  toolName: string;
  command: string | null;
  sandboxId: string | null;
  state: "running" | "done" | "failed";
  lines: string[];
  workerBranch?: string;
};

function terminalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const safe = redactSecretsInText(value).trim();
  return safe || null;
}

function boundedTerminalLines(values: unknown[]): string[] {
  return values
    .flatMap((value) => terminalText(value)?.split(/\r?\n/) ?? [])
    .map((line) =>
      line.length > MAX_TERMINAL_LINE_LENGTH
        ? `${line.slice(0, MAX_TERMINAL_LINE_LENGTH)}…`
        : line
    )
    .filter(Boolean)
    .slice(-MAX_TERMINAL_LINES);
}

function isTerminalExecutionTool(name: string) {
  return /(?:^|_)(?:bash|terminal_exec|run_command|command)(?:$|_)/i.test(name);
}

function isSandboxLaunchTool(name: string) {
  return /^sandbox_(?:start|provision|create|launch)$/.test(name);
}

function terminalEntryFromPart(
  part: Parameters<typeof getToolOrDynamicToolName>[0],
  id: string
): TerminalActivityEntry | null {
  const toolName = getToolOrDynamicToolName(part);
  const commandTool = isTerminalExecutionTool(toolName);
  const sandboxTool = isSandboxLaunchTool(toolName);
  if (!commandTool && !sandboxTool) return null;

  const input =
    "input" in part && typeof part.input === "object" && part.input !== null
      ? (part.input as Record<string, unknown>)
      : {};
  const output =
    "output" in part && typeof part.output === "object" && part.output !== null
      ? (part.output as Record<string, unknown>)
      : {};
  const rawState = "state" in part ? String(part.state) : "";
  const state = controlToolOutcome(rawState, output);
  const command = terminalText(input.command) ?? null;
  const sandboxId =
    terminalText(output.sandboxId) ?? terminalText(input.sandboxId) ?? null;
  const cleanupRecoveryLine =
    sandboxTool && output.recoveredFromCleanup === true
      ? `Sandbox recovered and ready · cleanup ${Math.ceil(
          (typeof output.cleanupWaitMs === "number"
            ? Math.max(0, output.cleanupWaitMs)
            : 0) / 1000
        )}s`
      : null;
  const lines = boundedTerminalLines([
    cleanupRecoveryLine,
    output.stdout,
    output.stderr,
    output.output,
    "output" in part && typeof part.output === "string"
      ? part.output
      : undefined,
    output.error,
    "errorText" in part ? part.errorText : undefined,
  ]);

  return {
    id,
    kind: commandTool ? "command" : "sandbox",
    toolName,
    command,
    sandboxId,
    state,
    lines,
  };
}

/**
 * Keeps shell execution visible where the user is already writing follow-up
 * work. This deliberately excludes generic tool activity so it reads like a
 * terminal transcript rather than a second copy of the conversation.
 */
export function buildTerminalActivityEntries(
  messages: UIMessage[]
): TerminalActivityEntry[] {
  const entries: TerminalActivityEntry[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) {
      continue;
    }
    for (const [index, part] of message.parts.entries()) {
      if (!isToolOrDynamicToolUIPart(part)) continue;
      const entry = terminalEntryFromPart(part, `${message.id}-${index}`);
      if (entry) {
        const metadata = message.metadata as
          | { workerBranch?: unknown }
          | undefined;
        const branch = terminalText(metadata?.workerBranch);
        entries.push(branch ? { ...entry, workerBranch: branch } : entry);
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
      const state = controlToolOutcome(
        rawState,
        "output" in part ? part.output : undefined
      );

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
