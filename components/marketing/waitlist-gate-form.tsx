"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/marketing/icons";
import { trackActivation } from "@/lib/activation-tracking";
import { LOGIN_NEXT_FALLBACK, buildGithubLoginHref } from "@/lib/login-next";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That code isn't recognized.",
  expired: "That code has expired.",
  exhausted: "That code is fully redeemed.",
  invalid_request: "Enter a valid access code.",
  waitlist_required: "Enter your access code to continue.",
};

function friendlyError(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? code.replace(/_/g, " ");
}

type Props = {
  next: string;
  initialError: string | null;
};

export function WaitlistGateForm({ next, initialError }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    friendlyError(initialError)
  );
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const disabled = isPending || isRedirecting;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter your access code.");
      return;
    }
    setError(null);

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auth/waitlist/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: trimmed }),
        });
      } catch {
        setError("Network error — try again.");
        return;
      }

      if (response.ok) {
        setIsRedirecting(true);
        trackActivation("login_started", {
          source: "login_page",
          provider: "github",
          has_next: next !== LOGIN_NEXT_FALLBACK,
        });
        window.location.href = buildGithubLoginHref(next);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        friendlyError(body.error ?? null) ?? "Couldn't validate that code."
      );
    });
  }

  return (
    <form
      onSubmit={submit}
      className="mpx-auth-card gap-3.5"
      data-testid="waitlist-gate-form"
    >
      <label
        htmlFor="waitlist-code"
        className="mpx-auth-label"
      >
        Access code
      </label>
      <input
        id="waitlist-code"
        name="code"
        type="text"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="early-access-xxxx"
        disabled={disabled}
        required
        maxLength={128}
        data-testid="waitlist-code-input"
        className="mpx-auth-input"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={disabled}
          data-testid="login-github-button"
          data-ready={!disabled ? "true" : undefined}
          className="mpx-button is-primary is-small"
        >
          <Icon.Github size={14} />
          {isRedirecting
            ? "Redirecting…"
            : isPending
              ? "Validating…"
              : "Continue with GitHub"}
        </button>
        <Link href="/signup" className="mpx-auth-minor">
          No code? Create an account →
        </Link>
      </div>
      {error ? (
        <p
          role="alert"
          data-testid="waitlist-error"
          className="mpx-auth-alert is-error"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
