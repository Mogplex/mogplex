"use client";

import { useState, type FormEvent } from "react";
import { trackActivation } from "@/lib/activation-tracking";
import { authClient } from "@/lib/better-auth/client";
import { AuthField, AuthFormError } from "./auth-field";

export function SsoForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    trackActivation("login_started", {
      source: "sso_page",
      provider: "sso",
    });

    try {
      const { error: ssoError } = await authClient.signIn.sso({
        email: email.trim(),
        callbackURL: next,
      });
      // On success better-auth redirects to the identity provider.
      if (ssoError) {
        setIsPending(false);
        setError(
          ssoError.status === 404
            ? "No SSO provider is registered for that email domain."
            : (ssoError.message ?? "Couldn't start SSO sign-in.")
        );
      }
    } catch {
      setIsPending(false);
      setError("Network error — try again.");
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="sso-form"
      className="flex flex-col gap-3.5"
    >
      <AuthField
        id="sso-email"
        label="Work email"
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="you@company.com"
        disabled={isPending}
        required
        maxLength={254}
        data-testid="sso-email"
      />
      <div>
        <button
          type="submit"
          disabled={isPending}
          data-testid="sso-submit"
          className="mpx-button is-primary is-small"
        >
          {isPending ? "Looking up your provider…" : "Continue with SSO"}
        </button>
      </div>
      <AuthFormError message={error} testId="sso-error" />
    </form>
  );
}
