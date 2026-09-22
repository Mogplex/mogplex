/**
 * Types and constants for the personal settings page.
 */

export type GithubInstallationView = {
  id: string;
  installation_id: number;
  account_login: string | null;
  account_type: string | null;
  target_type: string | null;
  repository_count: number;
  synced_repo_count: number;
  scope_label: string;
  manage_url: string | null;
  repositories: Array<{
    id: string;
    full_name: string;
  }>;
};

export type GithubOwnerTarget = {
  login: string;
  kind: "personal" | "org";
  github_installation_id: number | null;
  scope_label: string;
  source: "oauth" | "installation" | "oauth+installation";
};

export type VerifyResult = {
  key_stored: boolean;
  key_valid: boolean | null;
  key_error?: string;
  service: string;
  harness?: string;
  package?: string;
  binary?: string;
};

export type SettingsView = {
  default_model?: string | null;
  theme?: string | null;
};

export const PROVIDER_META: Record<
  string,
  { label: string; description: string; placeholder: string; masked: string }
> = {
  ai_gateway: {
    label: "AI Gateway",
    description:
      "Use your own Vercel AI Gateway key so model usage is billed to your gateway account.",
    placeholder: "Paste your AI Gateway key",
    masked: "gateway key saved",
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude Code CLI",
    placeholder: "sk-ant-...",
    masked: "sk-ant-...****",
  },
  openai: {
    label: "OpenAI",
    description: "Codex CLI",
    placeholder: "sk-...",
    masked: "sk-...****",
  },
  openrouter: {
    label: "OpenRouter",
    description: "Route inference through OpenRouter models with your own key.",
    placeholder: "sk-or-...",
    masked: "sk-or-...****",
  },
};

export const SETTINGS_TABS = ["account", "teams", "keys", "billing"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const SETTINGS_TAB_SET: ReadonlySet<string> = new Set(SETTINGS_TABS);

export const KEYS_SUB_TABS = ["api", "cli"] as const;
export type KeysSubTab = (typeof KEYS_SUB_TABS)[number];
export const KEYS_SUB_TAB_SET: ReadonlySet<string> = new Set(KEYS_SUB_TABS);
