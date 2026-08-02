"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Icon } from "@/components/marketing/icons";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_request: "Something went wrong — try again.",
  rate_limited: "Too many requests — give it a minute and try again.",
  server: "Couldn't send a new code right now. Try again in a moment.",
};

function friendlyError(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? code.replace(/_/g, " ");
}

export function NewCodeForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email.");
      return;
    }
    setError(null);

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auth/waitlist/new-code", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
      } catch {
        setError("Network error — try again.");
        return;
      }

      if (response.ok) {
        setSent(true);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        friendlyError(body.error ?? null) ?? "Couldn't send a new code."
      );
    });
  }

  if (sent) {
    return (
      <div className="mplex-mono flex flex-col items-center gap-3 text-[12px] tracking-[0.18em] uppercase text-white/85">
        <div className="border border-emerald-300/25 bg-emerald-300/[0.08] px-3 py-2 text-emerald-100">
          check your inbox
        </div>
        <p className="max-w-[36ch] text-center text-[11px] tracking-[0.12em] normal-case text-white/55">
          If that email matches a Mogplex account, we sent a single-use code
          that expires in 24 hours.
        </p>
      </div>
    );
  }

  const disabled = isPending;

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3">
      <label className="mplex-mono text-[10px] tracking-[0.22em] uppercase text-white/55">
        Email
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2.5 text-[14px] tracking-normal text-white normal-case placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          disabled={disabled}
        />
      </label>

      {error ? (
        <div className="mplex-mono border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-[11px] tracking-[0.18em] uppercase text-rose-200">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={disabled}
        className="mplex-mono inline-flex items-center justify-center gap-2 rounded-md border border-white/15 bg-white px-4 py-2.5 text-[12px] tracking-[0.18em] uppercase text-black transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Email me a new code"}
        {!isPending ? <Icon.ArrowRight className="h-3.5 w-3.5" /> : null}
      </button>
    </form>
  );
}
