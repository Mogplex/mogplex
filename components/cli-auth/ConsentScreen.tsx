"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface ConsentScreenProps {
  tokenName: string;
  userEmail: string;
  callbackUrl: string;
  nonce: string;
}

type FlowState =
  | { status: "pending" }
  | { status: "granting" }
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "error"; message: string }
  | { status: "fallback"; token: string; message: string };

type CopyState = "idle" | "copied" | "error";

async function readResponseMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    const message = payload?.error ?? payload?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  const text = await response.text().catch(() => "");
  return text.trim() || fallbackMessage;
}

/**
 * CLI auth consent screen.
 *
 * Displays the authorization request and handles token generation + callback.
 */
export function ConsentScreen({
  tokenName,
  userEmail,
  callbackUrl,
  nonce,
}: ConsentScreenProps) {
  const [state, setState] = useState<FlowState>({ status: "pending" });
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleGrant = async () => {
    setState({ status: "granting" });
    setCopyState("idle");

    try {
      // Generate token via existing API endpoint
      const tokenRes = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: tokenName,
          expiresInDays: 90,
        }),
      });

      if (!tokenRes.ok) {
        const message = await readResponseMessage(
          tokenRes,
          "Failed to generate token"
        );
        setState({ status: "error", message });
        return;
      }

      const { token } = await tokenRes.json();

      // The CLI callback contract expects JSON plus the nonce header. That
      // means localhost must answer the browser's CORS preflight before the
      // token handoff request itself is sent.
      try {
        const callbackRes = await fetch(callbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CLI-Nonce": nonce,
          },
          credentials: "omit",
          body: JSON.stringify({ token, name: tokenName }),
        });

        if (!callbackRes.ok) {
          const message = await readResponseMessage(
            callbackRes,
            `CLI callback returned ${callbackRes.status}`
          );
          setState({ status: "fallback", token, message });
          return;
        }

        setState({ status: "success" });
      } catch {
        // CLI callback failed (user closed the CLI, network issue, etc.)
        // Show fallback with token to copy manually
        setState({
          status: "fallback",
          token,
          message:
            "Could not reach the CLI callback automatically. Copy the token manually.",
        });
      }
    } catch {
      setState({
        status: "error",
        message: "Unexpected error while generating the token.",
      });
    }
  };

  const handleCancel = () => {
    setState({ status: "cancelled" });
  };

  const handleCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  };

  // Success state
  if (state.status === "success") {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-green/10">
          <svg
            className="h-6 w-6 text-accent-green"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-foreground">
          CLI Authenticated
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can close this tab.
        </p>
      </div>
    );
  }

  // Cancelled state
  if (state.status === "cancelled") {
    return (
      <div className="text-center">
        <h1 className="text-lg font-semibold text-foreground">
          Authentication Cancelled
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No token was generated.
        </p>
      </div>
    );
  }

  // Fallback state (CLI callback failed)
  if (state.status === "fallback") {
    return (
      <div className="w-full max-w-md">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-amber/10">
            <svg
              className="h-6 w-6 text-accent-amber"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground">
            Copy Token Manually
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {state.message}
          </p>
        </div>

        <div className="mt-6 rounded-md border border-border bg-background p-3">
          <code className="block break-all font-mono text-sm text-foreground">
            {state.token}
          </code>
        </div>

        <Button
          onClick={() => handleCopy(state.token)}
          className="mt-4 w-full"
          variant="outline"
        >
          {copyState === "copied" ? "Copied!" : "Copy to Clipboard"}
        </Button>

        {copyState === "error" ? (
          <p className="mt-3 text-center text-[11px] text-destructive">
            Clipboard access failed. Copy the token manually from the field
            above.
          </p>
        ) : null}

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          This token will not be shown again.
        </p>
      </div>
    );
  }

  // Pending/Granting state (consent screen)
  return (
    <div className="w-full max-w-md">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-foreground">
          Grant mogplex CLI access?
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The CLI is requesting a personal access token.
        </p>
      </div>

      <div className="mt-6 space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="text-muted-foreground">Token name</span>
          <span className="ml-auto font-medium text-foreground">
            {tokenName}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="text-muted-foreground">Account</span>
          <span className="ml-auto font-medium text-foreground">
            {userEmail}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <span className="text-muted-foreground">Expires</span>
          <span className="ml-auto font-medium text-foreground">90 days</span>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border-dim bg-muted/30 p-4 text-[11px] text-muted-foreground">
        This token grants read-only access to models and configuration.
      </div>

      {state.status === "error" ? (
        <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[11px] text-destructive">
          {state.message}
        </div>
      ) : null}

      <div className="mt-6 flex gap-3">
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={state.status === "granting"}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={handleGrant}
          disabled={state.status === "granting"}
          className="flex-1"
        >
          {state.status === "granting" ? "Granting..." : "Grant Access"}
        </Button>
      </div>
    </div>
  );
}
