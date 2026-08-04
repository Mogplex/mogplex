"use client";

import { useState, type FormEvent } from "react";
import { trackActivation } from "@/lib/activation-tracking";
import { authClient } from "@/lib/better-auth/client";
import { AuthField, AuthFormError, AuthFormNotice } from "./auth-field";

// better-auth's default minimum; the server rejects shorter passwords, the
// input's minLength just surfaces it before a round-trip.
const MIN_PASSWORD_LENGTH = 8;

function signUpErrorMessage(code?: string, fallback?: string): string {
  if (code === "USER_ALREADY_EXISTS") {
    return "An account with that email already exists — sign in instead.";
  }
  return fallback || "Sign-up failed — try again.";
}

export function SignUpForm({ verifiedNext }: { verifiedNext: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  if (submittedEmail) {
    return (
      <AuthFormNotice testId="signup-check-email">
        Check your email — we sent a verification link to {submittedEmail}.
      </AuthFormNotice>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);
    trackActivation("signup_submitted", { source: "signup_page" });

    const trimmedEmail = email.trim();
    try {
      const { error: signUpError } = await authClient.signUp.email({
        name: name.trim(),
        email: trimmedEmail,
        password,
        // The emailed verification link lands here after better-auth
        // verifies and (autoSignInAfterVerification) signs the user in.
        callbackURL: verifiedNext,
      });
      if (signUpError) {
        setError(signUpErrorMessage(signUpError.code, signUpError.message));
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
      data-testid="signup-form"
      className="flex flex-col gap-3.5"
    >
      <AuthField
        id="signup-name"
        label="Name"
        name="name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoComplete="name"
        placeholder="Ada Lovelace"
        disabled={isPending}
        required
        maxLength={128}
        data-testid="signup-name"
      />
      <AuthField
        id="signup-email"
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
        data-testid="signup-email"
      />
      <AuthField
        id="signup-password"
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        disabled={isPending}
        required
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={128}
        data-testid="signup-password"
      />
      <div>
        <button
          type="submit"
          disabled={isPending}
          data-testid="signup-submit"
          className="mpx-button is-primary is-small"
        >
          {isPending ? "Creating account…" : "Create account"}
        </button>
      </div>
      <AuthFormError message={error} testId="signup-error" />
    </form>
  );
}
