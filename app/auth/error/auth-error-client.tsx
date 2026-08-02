"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  expired: "Your session has expired. Please sign in again.",
  invalid_state:
    "OAuth state mismatch. This can happen if the login page was open in multiple tabs.",
  access_denied:
    "Access was denied. Make sure you authorize the required permissions.",
  server_error:
    "The authentication server returned an error. Try again in a moment.",
};

function ErrorContent() {
  const params = useSearchParams();
  const code = params.get("code") || params.get("error") || "unknown";

  const message =
    ERROR_MESSAGES[code] || "Something went wrong during authentication.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-5 max-w-sm w-full text-center">
        <div className="text-xl font-mono text-foreground">
          Authentication Error
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {message}
        </div>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-xs font-mono border border-border rounded hover:bg-secondary transition-colors"
          >
            Sign in again
          </Link>
        </div>
      </div>
    </div>
  );
}

export function AuthErrorClient() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ErrorContent />
    </Suspense>
  );
}
