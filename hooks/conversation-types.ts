import type { UIMessage } from "ai";
import type {
  LocalMessageSegment,
  LocalToolCall,
} from "@/lib/harness/output-types";

export type {
  LocalMessageSegment,
  LocalToolCall,
  LocalToolCallState,
} from "@/lib/harness/output-types";

export type Message = UIMessage;
export type HarnessId = "claude-code" | "codex";

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

export type ConversationContext = {
  id: string;
  repoId: string | null;
  workspaceSessionId: string | null;
  sandboxId?: string | null;
};

export type ConversationState = {
  id: string;
  repoId: string | null;
  workspaceSessionId: string | null;
  sandboxId?: string | null;
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
  sandbox_id?: string | null;
  model: string;
  mode: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};
