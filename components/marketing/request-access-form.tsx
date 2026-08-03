"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/marketing/icons";
import { trackActivation } from "@/lib/activation-tracking";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Enter a valid email address.",
  invalid_field: "One of the fields is too long.",
  invalid_request: "Something went wrong — try again.",
  rate_limited: "Too many requests — give it a minute and try again.",
  server: "Couldn't save your request. Try again in a moment.",
};

function friendlyError(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? code.replace(/_/g, " ");
}

export function RequestAccessForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [useCase, setUseCase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    null | { alreadyRequested: boolean }
  >(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email.");
      return;
    }
    setError(null);

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auth/waitlist/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: trimmedEmail,
            name: name.trim() || null,
            company: company.trim() || null,
            useCase: useCase.trim() || null,
          }),
        });
      } catch {
        setError("Network error — try again.");
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        alreadyRequested?: boolean;
      };

      if (response.ok && body.ok) {
        trackActivation("waitlist_request_submitted", {
          source: "request_access_page",
          already_requested: Boolean(body.alreadyRequested),
        });
        setSuccess({ alreadyRequested: Boolean(body.alreadyRequested) });
        return;
      }

      setError(
        friendlyError(body.error ?? null) ?? "Couldn't submit your request."
      );
    });
  }

  if (success) {
    return (
      <div
        className="mplex-panel flex w-full flex-col gap-3 p-5 sm:p-6"
        data-testid="request-access-success"
      >
        <div
          className="mplex-mono text-[10.5px] tracking-[0.22em] uppercase"
          style={{ color: "var(--mplex-violet-dim)" }}
        >
          You're on the list
        </div>
        <p className="text-[15px] leading-[1.5] text-white">
          {success.alreadyRequested
            ? "You've already requested access. We'll email you the moment a code is ready."
            : "Thanks — we'll email you when an access code is ready."}
        </p>
        <p className="text-marketing-muted text-[13px] leading-[1.5]">
          Already have a code?{" "}
          <Link
            href="/login/beta"
            className="text-white underline underline-offset-4 hover:no-underline"
          >
            Sign in →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mplex-panel flex w-full flex-col gap-4 p-5 sm:p-6"
      data-testid="request-access-form"
    >
      <Field
        id="request-email"
        label="Email"
        required
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@company.com"
        disabled={isPending}
        autoComplete="email"
      />
      <Field
        id="request-name"
        label="Name"
        value={name}
        onChange={setName}
        placeholder="Optional"
        disabled={isPending}
        autoComplete="name"
      />
      <Field
        id="request-company"
        label="Company"
        value={company}
        onChange={setCompany}
        placeholder="Optional"
        disabled={isPending}
        autoComplete="organization"
      />
      <Field
        id="request-use-case"
        label="What would you build with it?"
        value={useCase}
        onChange={setUseCase}
        placeholder="Optional — a sentence or two helps us prioritize"
        disabled={isPending}
        multiline
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          data-testid="request-access-submit"
          className="mplex-btn mplex-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon.Github size={14} />
          {isPending ? "Submitting…" : "Request access"}
        </button>
        <Link
          href="/login/beta"
          className="mplex-mono text-marketing-muted text-[11px] tracking-[0.22em] uppercase hover:text-white"
        >
          Have a code? Sign in →
        </Link>
      </div>
      {error ? (
        <p
          role="alert"
          data-testid="request-access-error"
          className="mplex-mono border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-[11px] tracking-[0.22em] text-rose-200 uppercase"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
};

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  type = "text",
  autoComplete,
  multiline,
}: FieldProps) {
  const shared = {
    id,
    name: id,
    value,
    placeholder,
    disabled,
    required,
    autoComplete,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onChange(event.target.value),
    className:
      "mplex-mono px-3.5 py-3 text-[14px] tracking-wide text-white placeholder:text-marketing-faint focus:outline-none disabled:opacity-60",
    style: {
      background:
        "color-mix(in srgb, var(--mplex-foreground) 2%, transparent)",
      border: "1px solid var(--mplex-line-strong)",
    } as const,
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="mplex-mono text-[10.5px] tracking-[0.22em] uppercase"
        style={{ color: "var(--mplex-violet-dim)" }}
      >
        {label}
        {required ? " *" : ""}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} maxLength={2000} />
      ) : (
        <input {...shared} type={type} maxLength={320} />
      )}
    </div>
  );
}
