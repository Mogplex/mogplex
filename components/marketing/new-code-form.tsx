"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Icon } from "@/components/marketing/icons";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_request: "Something went wrong — try again.",
  rate_limited: "Too many requests — give it a minute and try again.",
  server: "Couldn't send a new code right now. Try again in a moment.",
};

function friendlyError(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? code.replace(/_/g, " ");
}

export function NewCodeForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email.");
      return;
    }
    setError(null);

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auth/waitlist/new-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
      } catch {
        setError("Network error — try again.");
        return;
      }

      if (response.ok) {
        setSent(true);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        friendlyError(body.error ?? null) ?? "Couldn't send a new code."
      );
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="mpx-auth-alert is-success">
          check your inbox
        </div>
        <p className="mpx-auth-muted max-w-[36ch] text-center">
          If that email matches a Mogplex account, we sent a single-use code
          that expires in 24 hours.
        </p>
      </div>
    );
  }

  const disabled = isPending;

  return (
    <form onSubmit={submit} className="mpx-auth-card gap-3">
      <label className="mpx-auth-label">
        Email
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mpx-auth-input mt-2 normal-case tracking-normal"
          disabled={disabled}
        />
      </label>

      {error ? (
        <div className="mpx-auth-alert is-error">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={disabled}
        className="mpx-button is-primary is-small"
      >
        {isPending ? "Sending…" : "Email me a new code"}
        {!isPending ? <Icon.ArrowRight className="h-3.5 w-3.5" /> : null}
      </button>
    </form>
  );
}
