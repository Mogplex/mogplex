export type LocalToolCallState = "running" | "done" | "error" | "denied";

export type LocalToolCall = {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  state: LocalToolCallState;
};

export type LocalMessageSegment =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCall: LocalToolCall };
