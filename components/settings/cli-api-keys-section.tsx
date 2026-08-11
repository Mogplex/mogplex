"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchJsonObject } from "@/lib/client-fetch";

type CliApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<CreateKeyResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

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
    await navigator.clipboard.writeText(newToken.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setKeyName("");
    setExpiresInDays(null);
    setNewToken(null);
    setCreateError(null);
    setCopied(false);
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString();
  };

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    return date.toLocaleDateString();
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
        {keys.length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground py-8">
            No keys configured. Generate one to authenticate MCP clients and
            CLI tools.
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {key.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {key.prefix}...
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    <span>Created {formatDate(key.createdAt)}</span>
                    {key.lastUsedAt && (
                      <span className="ml-3">
                        Last used {formatRelativeTime(key.lastUsedAt)}
                      </span>
                    )}
                    {key.expiresAt && (
                      <span className="ml-3">
                        Expires {formatDate(key.expiresAt)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(key.id)}
                  disabled={revoking === key.id}
                  className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-accent-red disabled:opacity-50"
                >
                  {revoking === key.id ? "..." : "Revoke"}
                </button>
              </div>
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
                  <code className="break-all font-mono text-sm text-foreground">
                    {newToken.token}
                  </code>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleCopyToken}
                    className="flex-1 rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-secondary"
                  >
                    {copied ? "Copied!" : "Copy to Clipboard"}
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
