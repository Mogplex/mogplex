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
      <div className="mono mpx-auth-muted text-[12px]">
        Signed in as <span className="mpx-auth-strong">{email}</span>
      </div>
      <div className="flex items-center gap-3">
        <a href={next} className="mpx-button is-primary is-small">
          Continue
        </a>
        <button
          type="button"
          onClick={signOut}
          disabled={isSigningOut}
          data-testid="signout-button"
          className="mpx-button is-secondary"
        >
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
