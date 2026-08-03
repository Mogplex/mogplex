"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { trackActivation } from "@/lib/activation-tracking";
import { authClient } from "@/lib/better-auth/client";
import { AuthField, AuthFormError } from "./auth-field";

function signInErrorMessage(status: number, fallback?: string): string {
  // better-auth: 403 = email exists but is unverified (requireEmailVerification),
  // 401 = bad credentials.
  if (status === 403) {
    return "Verify your email first — check your inbox for the link.";
  }
  if (status === 401) {
    return "Invalid email or password.";
  }
  return fallback || "Sign-in failed — try again.";
}

export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const disabled = isPending || isRedirecting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    trackActivation("login_started", {
      source: "login_page",
      provider: "password",
    });

    try {
      const { error: signInError } = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setIsPending(false);
        setError(
          signInErrorMessage(signInError.status, signInError.message)
        );
        return;
      }
    } catch {
      setIsPending(false);
      setError("Network error — try again.");
      return;
    }

    // Full navigation so the server sees the fresh session cookie.
    setIsRedirecting(true);
    window.location.assign(next);
  }

  return (
    <form
      onSubmit={submit}
      data-testid="signin-form"
      className="flex flex-col gap-3.5"
    >
      <AuthField
        id="signin-email"
        label="Email"
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="you@company.com"
        disabled={disabled}
        required
        maxLength={254}
        data-testid="signin-email"
      />
      <AuthField
        id="signin-password"
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        placeholder="••••••••"
        disabled={disabled}
        required
        maxLength={128}
        data-testid="signin-password"
      />
      <div className="flex items-center justify-between gap-3">
        <button
          type="submit"
          disabled={disabled}
          data-testid="signin-submit"
          className="mplex-btn mplex-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRedirecting ? "Redirecting…" : isPending ? "Signing in…" : "Sign in"}
        </button>
        <Link
          href="/forgot-password"
          className="mplex-mono text-marketing-muted text-[11px] tracking-[0.22em] uppercase hover:text-white"
        >
          Forgot password?
        </Link>
      </div>
      <AuthFormError message={error} testId="signin-error" />
    </form>
  );
}
