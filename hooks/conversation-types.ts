import type { UIMessage } from "ai";

export type Message = UIMessage;
export type HarnessId = "claude-code" | "codex";

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

export type LocalMessage = {
  id: string;
  text: string;
  toolCalls?: LocalToolCall[];
  segments?: LocalMessageSegment[];
};

export type HarnessSessionState = {
  sessionId: string;
  sandboxId?: string | null;
};

export type HarnessState = Partial<Record<HarnessId, HarnessSessionState>>;

export type ConversationState = {
  id: string;
  repoId: string | null;
  workspaceSessionId: string | null;
  messages: Message[];
  localMsgs: LocalMessage[];
  harnessState: HarnessState;
  model: string;
  mode: "AUTO" | "YOLO" | "SAFE";
  title?: string;
  updatedAt?: string | null;
};

export type ConversationListItem = {
  id: string;
  repo_id: string | null;
  workspace_session_id: string | null;
  model: string;
  mode: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};
