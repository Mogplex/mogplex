"use client";

import { PROVIDERS } from "./team-settings-types";
import type { Provider } from "@/lib/vault";

type KeysTabContentProps = {
  keysError: Error | undefined;
  canManageKeys: boolean;
  busyKey: string | null;
  configuredProviders: Set<Provider>;
  keyInputs: Record<string, string>;
  setKeyInputs: (fn: (current: Record<string, string>) => Record<string, string>) => void;
  saveProviderKey: (provider: Provider) => void;
  deleteProviderKey: (provider: Provider) => void;
};

export function KeysTabContent({
  keysError,
  canManageKeys,
  busyKey,
  configuredProviders,
  keyInputs,
  setKeyInputs,
  saveProviderKey,
  deleteProviderKey,
}: KeysTabContentProps) {
  return (
    <section className="border border-border/60 bg-card">
      <div className="px-5 pt-5 pb-2">
        <div className="ui-section-title">Team Keys</div>
        <div className="ui-section-caption">Shared provider keys are preferred over personal keys inside this team.</div>
      </div>
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {keysError && <div className="text-sm text-destructive">Unable to load keys.</div>}
        {PROVIDERS.map((provider) => {
          const configured = configuredProviders.has(provider.id);
          return (
            <div key={provider.id} className="border border-border bg-background/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{provider.label}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {configured ? "Set for this team" : "Not set"}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${configured ? "bg-accent-green/10 text-accent-green" : "bg-secondary text-muted-foreground"}`}>
                  {configured ? "Set" : "Empty"}
                </span>
              </div>
              {canManageKeys && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="password"
                    value={keyInputs[provider.id] ?? ""}
                    onChange={(event) =>
                      setKeyInputs((current) => ({
                        ...current,
                        [provider.id]: event.target.value,
                      }))
                    }
                    placeholder={provider.placeholder}
                    className="min-w-0 flex-1 border border-border bg-input px-3 py-2 text-sm text-foreground"
                  />
                  <button
                    type="button"
                    disabled={busyKey === `key:${provider.id}`}
                    onClick={() => void saveProviderKey(provider.id)}
                    className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    Save
                  </button>
                  {configured && (
                    <button
                      type="button"
                      disabled={busyKey === `key:${provider.id}`}
                      onClick={() => void deleteProviderKey(provider.id)}
                      className="border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
