"use client";

import { useState } from "react";
import { authClient } from "@/lib/better-auth/client";

export function SignedInPanel({
  email,
  next,
}: {
  email: string;
  next: string;
}) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    try {
      await authClient.signOut();
    } catch {
      // Fall through to the reload — the server session state wins.
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-4" data-testid="signed-in-panel">
      <div className="mplex-mono text-marketing-muted text-[12px] tracking-wide">
        Signed in as <span className="text-white">{email}</span>
      </div>
      <div className="flex items-center gap-3">
        <a href={next} className="mplex-btn mplex-btn-primary">
          Continue
        </a>
        <button
          type="button"
          onClick={signOut}
          disabled={isSigningOut}
          data-testid="signout-button"
          className="mplex-btn mplex-btn-ghost disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
