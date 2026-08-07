export type McpServer = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  envPlain: Record<string, string>;
  envSecretNames: string[];
  url: string | null;
  headerPlain: Record<string, string>;
  headerSecretNames: string[];
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type McpServersResponse = {
  servers: McpServer[];
};

export type KeyValueEntry = {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  saved: boolean;
  clearRequested: boolean;
  originalKey?: string;
};

export type FormState = {
  name: string;
  enabled: boolean;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  url: string;
  extraText: string;
  envEntries: KeyValueEntry[];
  headerEntries: KeyValueEntry[];
};

export const EMPTY_FORM: FormState = {
  name: "",
  enabled: true,
  transport: "stdio",
  command: "",
  argsText: "",
  url: "",
  extraText: "{}",
  envEntries: [],
  headerEntries: [],
};
