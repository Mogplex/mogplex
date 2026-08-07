export type JsonObject = Record<string, unknown>;
export type StringRecord = Record<string, string>;
export type SecretMutationRecord = Record<string, string | null>;

export type McpServerRow = {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: unknown;
  env_refs: unknown;
  env_plain: unknown;
  url: string | null;
  header_refs: unknown;
  header_plain: unknown;
  extra: unknown;
  created_at: string;
  updated_at: string;
};

export type McpServerWebRecord = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envPlain: StringRecord;
  envSecretNames: string[];
  url: string | null;
  headerPlain: StringRecord;
  headerSecretNames: string[];
  extra: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type McpServerCliRecord = {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

export type McpServerCreateInput =
  | {
      name: string;
      enabled: boolean;
      transport: "stdio";
      command: string;
      args: string[];
      envPlain: StringRecord;
      envSecrets: StringRecord;
      url: null;
      headerPlain: StringRecord;
      headerSecrets: StringRecord;
      extra: JsonObject;
    }
  | {
      name: string;
      enabled: boolean;
      transport: "http";
      command: null;
      args: string[];
      envPlain: StringRecord;
      envSecrets: StringRecord;
      url: string;
      headerPlain: StringRecord;
      headerSecrets: StringRecord;
      extra: JsonObject;
    };

export type McpServerStoredState = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envRefs: StringRecord;
  envPlain: StringRecord;
  url: string | null;
  headerRefs: StringRecord;
  headerPlain: StringRecord;
  extra: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type McpServerUpdateInput =
  | {
      name: string;
      enabled: boolean;
      transport: "stdio";
      command: string;
      args: string[];
      envPlain: StringRecord;
      envSecretOps: SecretMutationRecord;
      url: null;
      headerPlain: StringRecord;
      headerSecretOps: SecretMutationRecord;
      extra: JsonObject;
    }
  | {
      name: string;
      enabled: boolean;
      transport: "http";
      command: null;
      args: string[];
      envPlain: StringRecord;
      envSecretOps: SecretMutationRecord;
      url: string;
      headerPlain: StringRecord;
      headerSecretOps: SecretMutationRecord;
      extra: JsonObject;
    };

export type VaultSecretRow = {
  id: string;
  decrypted_secret: string;
};

export type SupabaseLikeError = {
  code?: string;
  message: string;
};

export class McpServerValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, code = "INVALID_MCP_SERVER", status = 400) {
    super(message);
    this.name = "McpServerValidationError";
    this.status = status;
    this.code = code;
  }
}
