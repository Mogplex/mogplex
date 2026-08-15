import type { Connection } from "@/lib/types";
import { needsNativeOAuthMigration } from "./presets";

export type ConnectionDisplayState = {
  isDisabled: boolean;
  isExcluded: boolean;
  isAvailable: boolean;
  rowMuted: boolean;
  oauthActionLabel: "Connect" | "Reconnect" | null;
};

export type PresetConnectionState = {
  connection: Connection | null;
  isAddable: boolean;
  label: "Available" | "Connected" | "Configured";
  detail: string | null;
};

export type PresetConnectionDisplayInput = {
  presetId: string;
  requiresOAuth: boolean;
};

function getPresetConnectionRank(
  connection: Connection,
  excludedIds: ReadonlySet<string>
) {
  const isExcluded = excludedIds.has(connection.id);
  if (connection.is_enabled && !isExcluded) return 3;
  if (connection.is_enabled) return 2;
  return 1;
}

export function getConnectionDisplayState(
  connection: Pick<
    Connection,
    "id" | "auth_type" | "health_status" | "is_enabled" | "oauth_authorized_at"
  > & {
    needsOAuthMigration?: boolean;
  },
  excludedIds: ReadonlySet<string> = new Set()
): ConnectionDisplayState {
  const isDisabled = !connection.is_enabled;
  const isExcluded = excludedIds.has(connection.id);
  const needsOAuthMigration = connection.needsOAuthMigration === true;
  const oauthActionLabel = needsOAuthMigration
    ? "Reconnect"
    : connection.auth_type === "oauth"
      ? connection.oauth_authorized_at
        ? "Reconnect"
        : "Connect"
      : null;

  return {
    isDisabled,
    isExcluded,
    isAvailable: connection.is_enabled && !isExcluded,
    rowMuted: isDisabled || isExcluded,
    oauthActionLabel,
  };
}

export function getPresetConnectionState(
  preset: PresetConnectionDisplayInput,
  connections: Connection[],
  excludedIds: ReadonlySet<string> = new Set()
): PresetConnectionState {
  const connection =
    connections
      .filter((candidate) => candidate.source_preset === preset.presetId)
      .sort((left, right) => {
        const rankDelta =
          getPresetConnectionRank(right, excludedIds) -
          getPresetConnectionRank(left, excludedIds);
        if (rankDelta !== 0) return rankDelta;
        return (
          new Date(left.created_at).getTime() -
          new Date(right.created_at).getTime()
        );
      })[0] ?? null;

  if (!connection) {
    return {
      connection: null,
      isAddable: true,
      label: "Available",
      detail: null,
    };
  }

  const needsOAuthMigration =
    preset.requiresOAuth && needsNativeOAuthMigration(connection);
  const state = getConnectionDisplayState(
    {
      ...connection,
      needsOAuthMigration,
    },
    excludedIds
  );
  const pendingOAuthAuthorization =
    !needsOAuthMigration &&
    connection.auth_type === "oauth" &&
    !connection.oauth_authorized_at;
  const detail =
    state.isDisabled && state.isExcluded
      ? "Disabled and excluded"
      : state.isDisabled
        ? "Disabled"
        : state.isExcluded
          ? "Excluded from this project"
          : needsOAuthMigration
            ? "Reconnect with OAuth to migrate this connection to native authorization"
            : pendingOAuthAuthorization
              ? "OAuth authorization required"
              : null;
  const label =
    state.isAvailable && !pendingOAuthAuthorization && !needsOAuthMigration
      ? "Connected"
      : "Configured";

  return {
    connection,
    isAddable: false,
    label,
    detail,
  };
}
