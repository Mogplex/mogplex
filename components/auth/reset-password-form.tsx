"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/better-auth/client";
import { AuthField, AuthFormError } from "./auth-field";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  if (!token) {
    return (
      <div className="flex flex-col gap-3">
        <AuthFormError
          message="That reset link is invalid or expired."
          testId="reset-password-invalid"
        />
        <div className="mpx-auth-muted">
          <Link
            href="/forgot-password"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  // Captured after the guard so the submit closure sees a non-null token.
  const resetToken = token;
  const disabled = isPending || isRedirecting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setIsPending(true);

    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token: resetToken,
      });
      if (resetError) {
        setIsPending(false);
        setError(
          resetError.code === "INVALID_TOKEN"
            ? "That reset link is invalid or expired — request a new one."
            : (resetError.message ?? "Couldn't reset the password.")
        );
        return;
      }
    } catch {
      setIsPending(false);
      setError("Network error — try again.");
      return;
    }

    setIsRedirecting(true);
    window.location.assign("/login?reset=1");
  }

  return (
    <form
      onSubmit={submit}
      data-testid="reset-password-form"
      className="flex flex-col gap-3.5"
    >
      <AuthField
        id="reset-password-new"
        label="New password"
        name="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        disabled={disabled}
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={128}
        data-testid="reset-password-new"
      />
      <AuthField
        id="reset-password-confirm"
        label="Confirm password"
        name="confirm"
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        placeholder="Repeat the new password"
        disabled={disabled}
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={128}
        data-testid="reset-password-confirm"
      />
      <div>
        <button
          type="submit"
          disabled={disabled}
          data-testid="reset-password-submit"
          className="mpx-button is-primary is-small"
        >
          {isRedirecting
            ? "Redirecting…"
            : isPending
              ? "Updating…"
              : "Update password"}
        </button>
      </div>
      <AuthFormError message={error} testId="reset-password-error" />
    </form>
  );
}
