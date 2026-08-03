"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/better-auth/client";
import { AuthField, AuthFormError, AuthFormNotice } from "./auth-field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  if (submittedEmail) {
    return (
      <AuthFormNotice testId="forgot-password-sent">
        If an account exists for {submittedEmail}, a reset link is on the way.
      </AuthFormNotice>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const trimmedEmail = email.trim();
    try {
      // Responds 200 whether or not the account exists — no enumeration.
      const { error: requestError } = await authClient.requestPasswordReset({
        email: trimmedEmail,
        redirectTo: "/reset-password",
      });
      if (requestError) {
        setError(requestError.message ?? "Couldn't send the reset link.");
        return;
      }
      setSubmittedEmail(trimmedEmail);
    } catch {
      setError("Network error — try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      data-testid="forgot-password-form"
      className="flex flex-col gap-3.5"
    >
      <AuthField
        id="forgot-password-email"
        label="Email"
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="you@company.com"
        disabled={isPending}
        required
        maxLength={254}
        data-testid="forgot-password-email"
      />
      <div>
        <button
          type="submit"
          disabled={isPending}
          data-testid="forgot-password-submit"
          className="mplex-btn mplex-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Sending…" : "Send reset link"}
        </button>
      </div>
      <AuthFormError message={error} testId="forgot-password-error" />
    </form>
  );
}
