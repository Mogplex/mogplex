import type {
  FlowGraph,
  PersonalFlowTemplate,
  PersonalFlowTemplateReconnect,
} from "@/lib/types";
import type { PreconfiguredAgentTemplate } from "@/lib/agents/template-forks";

export type FlowRow = {
  id: string;
  user_id: string;
  installation_id: number;
  name: string;
  description: string | null;
  notes: string | null;
  source_kind: "github" | "schedule" | "webhook" | "slack";
  status: "active" | "inactive";
  draft_graph: unknown;
  published_version_id: string | null;
  trigger_schedule_id: string | null;
  vault_webhook_secret_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FlowVersionRow = {
  id: string;
  flow_id: string;
  version_number: number;
  graph: unknown;
  created_at: string;
};

export type PersonalFlowTemplateRow = {
  id: string;
  user_id: string;
  owner_type: "user" | "team";
  owner_user_id: string | null;
  product_team_id: string | null;
  created_by_user_id: string | null;
  name: string;
  description: string | null;
  graph: unknown;
  source_flow_id: string | null;
  trigger_event: PersonalFlowTemplate["trigger_event"];
  reconnect: PersonalFlowTemplateReconnect[];
  requires_repository: boolean;
  created_at: string;
  updated_at: string;
};

export type StoredPersonalFlowTemplate = PersonalFlowTemplate & {
  graph: FlowGraph;
};

export type FlowPresetAgentResolverDeps = {
  resolveTemplateAgentFork: (
    userId: string,
    template: PreconfiguredAgentTemplate,
    // Verified active-team scope from the request header (null = personal).
    // Must reach the default-model resolver so the immutable fork is stamped
    // with the same scope the UI displayed when the preset was selected.
    teamId: string | null
  ) => Promise<{ id: string } | null>;
};
