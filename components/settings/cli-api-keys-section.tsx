"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ApiKeyAccessOptions,
  KEY_ACCESS_OPTIONS,
} from "@/components/settings/api-key-access-options";
import {
  CliApiKeyRow,
  type CliApiKey,
} from "@/components/settings/cli-api-key-row";
import { copyText } from "@/lib/clipboard";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { ApiKeyAccess } from "@/lib/mogplex-api/key-access";


type KeysResponse = {
  keys: CliApiKey[];
};

type CreateKeyResponse = {
  id: string;
  token: string;
  prefix: string;
  expiresAt: string | null;
};

export function CliApiKeysSection() {
  const { data, mutate } = useSWR<KeysResponse>(
    "/api/settings/api-keys",
    (url: string) =>
      fetchJsonObject<KeysResponse>(url, "Failed to load Mogplex keys"),
  );
  const keys = data?.keys ?? [];

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [access, setAccess] = useState<ApiKeyAccess>("full");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<CreateKeyResponse | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [revoking, setRevoking] = useState<string | null>(null);
  const [changingAccess, setChangingAccess] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName,
          expiresInDays: expiresInDays ?? undefined,
          access,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setCreateError(result.error || "Failed to create key");
        return;
      }
      setNewToken(result);
      await mutate();
    } catch {
      setCreateError("Network error");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyToken = async () => {
    if (!newToken?.token) return;
    const copiedToClipboard = await copyText(newToken.token);
    setCopyState(copiedToClipboard ? "copied" : "failed");
    if (copiedToClipboard) setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setKeyName("");
    setExpiresInDays(null);
    setAccess("full");
    setNewToken(null);
    setCreateError(null);
    setCopyState("idle");
  };

  const handleRevoke = async (keyId: string) => {
    setRevoking(keyId);
    try {
      const res = await fetch(`/api/settings/api-keys/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        console.error("Failed to revoke key:", result.error);
      }
      await mutate();
    } finally {
      setRevoking(null);
    }
  };

  const handleChangeAccess = async (keyId: string, next: ApiKeyAccess) => {
    setChangingAccess(keyId);
    setAccessError(null);
    try {
      await fetchJsonObject(
        `/api/settings/api-keys/${keyId}`,
        "Unable to change this key's access",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access: next }),
        },
      );
      await mutate();
    } catch (cause) {
      setAccessError(
        cause instanceof Error
          ? cause.message
          : "Unable to change this key's access",
      );
    } finally {
      setChangingAccess(null);
    }
  };

  return (
    <section className="border border-border/60 bg-card">
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div>
          <div className="ui-section-title">Mogplex Keys</div>
          <div className="ui-section-caption">
            Personal access tokens (mog_...) for MCP clients, mogplex-cli, and
            scripts
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="rounded-sm border border-border bg-background px-3 py-1.5 text-[11px] text-foreground hover:bg-secondary"
        >
          Generate New Key
        </button>
      </div>

      <div className="px-5 pb-5">
        {accessError ? (
          <p role="alert" className="mb-2 text-[11px] text-destructive">
            {accessError}
          </p>
        ) : null}
        {keys.length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground py-8">
            No keys configured. Generate one to authenticate MCP clients and
            CLI tools.
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <CliApiKeyRow
                key={key.id}
                apiKey={key}
                changingAccess={changingAccess === key.id}
                revoking={revoking === key.id}
                onChangeAccess={handleChangeAccess}
                onRevoke={handleRevoke}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            {newToken ? (
              <>
                <h3 className="text-lg font-semibold text-foreground">
                  Key Created
                </h3>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Copy this key now. You will not be able to see it again.
                </p>
                <div className="mt-4 rounded-md border border-border bg-background p-3">
                  <code className="select-all break-all font-mono text-sm text-foreground">
                    {newToken.token}
                  </code>
                </div>
                {copyState === "failed" ? (
                  <p
                    role="alert"
                    className="mt-2 text-[11px] text-destructive"
                  >
                    Your browser blocked clipboard access. Select the key above
                    and copy it manually.
                  </p>
                ) : null}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleCopyToken}
                    className="flex-1 rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    {copyState === "copied" ? "Copied!" : "Copy to Clipboard"}
                  </button>
                  <button
                    onClick={handleCloseModal}
                    className="rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground">
                  Generate Mogplex Key
                </h3>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Create a personal access token for MCP client, CLI, and
                  script authentication.
                </p>
                {createError && (
                  <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                    {createError}
                  </div>
                )}
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">
                      Key Name
                    </label>
                    <input
                      type="text"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      placeholder="e.g., laptop CLI, work machine"
                      className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground"
                      maxLength={100}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">
                      Expiration (optional)
                    </label>
                    <select
                      value={expiresInDays ?? ""}
                      onChange={(e) =>
                        setExpiresInDays(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="w-full border border-border bg-input px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">Never expires</option>
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                      <option value="90">90 days</option>
                      <option value="365">1 year</option>
                    </select>
                  </div>
                  <div>
                    <div className="block text-[11px] text-muted-foreground mb-1">
                      Access
                    </div>
                    <ApiKeyAccessOptions
                      idPrefix="new-key-access"
                      label="Access"
                      options={KEY_ACCESS_OPTIONS}
                      value={access}
                      onChange={setAccess}
                    />
                  </div>
                </div>
                <div className="mt-6 flex gap-2">
                  <button
                    onClick={handleCloseModal}
                    className="rounded-sm border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={creating || !keyName.trim()}
                    className="flex-1 rounded-sm border border-primary bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {creating ? "Creating..." : "Generate Key"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
