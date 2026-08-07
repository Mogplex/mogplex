import type { TeamRole } from "@/lib/team-capabilities";
import type { Provider } from "@/lib/vault";

export type TeamSettingsTab =
  | "members"
  | "keys"
  | "models"
  | "audit"
  | "connections"
  | "billing";

export type TeamKeysResponse = {
  keys: Array<{ provider: Provider; created_at: string; updated_at: string }>;
  viewer: { role: TeamRole; canManage: boolean };
};

export const TEAM_TABS = [
  "members",
  "keys",
  "models",
  "audit",
  "connections",
  "billing",
] as const;

export const TEAM_TAB_SET: ReadonlySet<string> = new Set(TEAM_TABS);

export const PROVIDERS: Array<{
  id: Provider;
  label: string;
  placeholder: string;
}> = [
  { id: "ai_gateway", label: "AI Gateway", placeholder: "Paste Gateway key" },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-..." },
];
