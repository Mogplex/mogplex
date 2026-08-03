"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

const INPUT_STYLE = {
  background: "color-mix(in srgb, var(--mplex-foreground) 2%, transparent)",
  border: "1px solid var(--mplex-line-strong)",
} as const;

type AuthFieldProps = {
  id: string;
  label: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function AuthField({ id, label, ...input }: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="mplex-mono text-marketing-accent-muted text-[10.5px] tracking-[0.22em] uppercase"
      >
        {label}
      </label>
      <input
        id={id}
        className="mplex-mono placeholder:text-marketing-faint h-11 px-3.5 text-[14px] tracking-wide text-white focus:outline-none disabled:opacity-60"
        style={INPUT_STYLE}
        {...input}
      />
    </div>
  );
}

export function AuthFormError({
  message,
  testId,
}: {
  message: string | null;
  testId: string;
}) {
  if (!message) return null;

  return (
    <p
      role="alert"
      data-testid={testId}
      className="mplex-mono border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2 text-[11px] tracking-[0.22em] text-rose-200 uppercase"
    >
      {message}
    </p>
  );
}

export function AuthFormNotice({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mplex-mono border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-2 text-[11px] leading-relaxed tracking-[0.18em] text-emerald-100 uppercase"
    >
      {children}
    </div>
  );
}

export function AuthDivider() {
  return (
    <div
      aria-hidden
      className="text-marketing-faint flex items-center gap-3"
    >
      <div
        className="h-px flex-1"
        style={{ background: "var(--mplex-line-strong)" }}
      />
      <span className="mplex-mono text-[10px] tracking-[0.24em] uppercase">
        or
      </span>
      <div
        className="h-px flex-1"
        style={{ background: "var(--mplex-line-strong)" }}
      />
    </div>
  );
}
