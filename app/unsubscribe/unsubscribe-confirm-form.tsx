"use client";

import { useState, useTransition } from "react";

import { unsubscribeAction } from "./actions";

// Note on the hidden `t` token field:
// The HMAC signature lives in the DOM, so anyone with the page source can
// extract it and re-POST the same address forever. We accept this because:
//   1. The action only writes to `email_unsubscribes`, which is an
//      idempotent upsert — repeat POSTs are no-ops.
//   2. The token is bound to a single email (the one in the same hidden
//      field), so it can only opt out that one address.
//   3. There is no re-subscribe flow that would let a replay re-enable
//      a previous opt-out.
// If we ever add a re-subscribe path, the action must also enforce a
// rate-limit or an `unsubscribed_at` freshness check before honoring it.

type State =
  | { kind: "idle" }
  | { kind: "done"; email: string }
  | { kind: "error"; message: string };

export function UnsubscribeConfirmForm({
  email,
  token,
}: {
  email: string;
  token: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  if (state.kind === "done") {
    return (
      <div className="space-y-3 text-sm leading-relaxed">
        <p className="text-foreground">
          <strong>{state.email}</strong> has been unsubscribed.
        </p>
        <p className="text-muted-foreground">
          You won&apos;t receive further email from Mogplex, including new
          access codes. If you change your mind, reply to a past message and
          we&apos;ll re-add you.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await unsubscribeAction(formData);
          if (result.ok) {
            setState({ kind: "done", email: result.email });
            return;
          }
          setState({
            kind: "error",
            message:
              result.reason === "invalid_token"
                ? "This link is no longer valid."
                : "Something went wrong. Please try again in a moment.",
          });
        });
      }}
    >
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="t" value={token} />

      <div className="space-y-3 text-sm leading-relaxed">
        <p className="text-foreground">
          Unsubscribe <strong>{email}</strong> from all Mogplex email?
        </p>
        <p className="text-muted-foreground">
          This stops every message — including new sign-in / access codes.
          You won&apos;t be able to use email-based sign-in for this address
          until we re-add you.
        </p>
      </div>

      {state.kind === "error" ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? "Unsubscribing…" : "Confirm unsubscribe"}
      </button>
    </form>
  );
}
