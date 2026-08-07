import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  StringRecord,
  SecretMutationRecord,
  VaultSecretRow,
  McpServerStoredState,
} from "./types";

export function uniqueSecretIds(rows: McpServerStoredState[]) {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const secretId of Object.values(row.envRefs)) {
      ids.add(secretId);
    }
    for (const secretId of Object.values(row.headerRefs)) {
      ids.add(secretId);
    }
  }
  return [...ids];
}

export async function resolveVaultSecrets(
  secretIds: string[]
): Promise<Map<string, string>> {
  if (secretIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .schema("vault")
    .from("decrypted_secrets")
    .select("id, decrypted_secret")
    .in("id", secretIds);

  if (error) {
    throw new Error(`Failed to resolve MCP secrets: ${error.message}`);
  }

  return new Map(
    ((data ?? []) as VaultSecretRow[]).map((row) => [
      row.id,
      row.decrypted_secret,
    ])
  );
}

export async function createSecret(
  userId: string,
  serverId: string,
  slot: string,
  value: string
) {
  const { data, error } = await supabaseAdmin.rpc(
    "create_user_mcp_server_secret",
    {
      p_user_id: userId,
      p_server_id: serverId,
      p_slot: slot,
      p_secret: value,
    }
  );

  if (error) {
    throw new Error(`Failed to create MCP secret: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error("Failed to create MCP secret: missing secret id");
  }

  return data;
}

export async function updateSecret(
  secretId: string,
  userId: string,
  serverId: string,
  slot: string,
  value: string
) {
  const { error } = await supabaseAdmin.rpc("update_user_mcp_server_secret", {
    p_secret_id: secretId,
    p_user_id: userId,
    p_server_id: serverId,
    p_slot: slot,
    p_secret: value,
  });

  if (error) {
    throw new Error(`Failed to update MCP secret: ${error.message}`);
  }
}

export async function deleteSecret(secretId: string) {
  const { error } = await supabaseAdmin.rpc("delete_user_mcp_server_secret", {
    p_secret_id: secretId,
  });

  if (error) {
    throw new Error(`Failed to delete MCP secret: ${error.message}`);
  }
}

export async function applySecretMutations(input: {
  userId: string;
  serverId: string;
  slotPrefix: "env" | "header";
  currentRefs: StringRecord;
  operations: SecretMutationRecord;
  createdSecretIds: string[];
}) {
  const nextRefs: StringRecord = { ...input.currentRefs };

  for (const [key, value] of Object.entries(input.operations)) {
    const slot = `${input.slotPrefix}/${key}`;
    if (value === null) {
      delete nextRefs[key];
      continue;
    }

    const existingSecretId = nextRefs[key];
    if (existingSecretId) {
      await updateSecret(
        existingSecretId,
        input.userId,
        input.serverId,
        slot,
        value
      );
      continue;
    }

    const secretId = await createSecret(
      input.userId,
      input.serverId,
      slot,
      value
    );
    input.createdSecretIds.push(secretId);
    nextRefs[key] = secretId;
  }

  return nextRefs;
}
