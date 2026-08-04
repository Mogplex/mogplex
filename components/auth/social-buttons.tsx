"use client";

import { useState } from "react";
import { Icon } from "@/components/marketing/icons";
import { trackActivation } from "@/lib/activation-tracking";
import { authClient } from "@/lib/better-auth/client";
import { AuthFormError } from "./auth-field";

const PROVIDERS = [
  { id: "github", label: "GitHub", ProviderIcon: Icon.Github },
  { id: "google", label: "Google", ProviderIcon: Icon.Google },
  { id: "microsoft", label: "Microsoft", ProviderIcon: Icon.Microsoft },
] as const;

type SocialProviderId = (typeof PROVIDERS)[number]["id"];

export function SocialButtons({
  next,
  source,
}: {
  next: string;
  source: string;
}) {
  const [pendingProvider, setPendingProvider] =
    useState<SocialProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(provider: SocialProviderId) {
    setPendingProvider(provider);
    setError(null);
    trackActivation("login_started", { source, provider });

    try {
      const { error: signInError } = await authClient.signIn.social({
        provider,
        callbackURL: next,
      });
      // On success better-auth navigates the page to the provider's
      // authorize URL, so only the error path continues here.
      if (signInError) {
        setPendingProvider(null);
        setError(
          signInError.message ?? `Couldn't start ${provider} sign-in.`
        );
      }
    } catch {
      setPendingProvider(null);
      setError("Network error — try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {PROVIDERS.map(({ id, label, ProviderIcon }) => (
        <button
          key={id}
          type="button"
          onClick={() => start(id)}
          disabled={pendingProvider !== null}
          data-testid={`auth-social-${id}`}
          className="mpx-button is-secondary"
        >
          <ProviderIcon size={14} />
          {pendingProvider === id ? "Redirecting…" : `Continue with ${label}`}
        </button>
      ))}
      <AuthFormError message={error} testId="auth-social-error" />
    </div>
  );
}
