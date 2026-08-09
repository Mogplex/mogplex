"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

type AuthFieldProps = {
  id: string;
  label: string;
  rightAdornment?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>;

export function AuthField({
  id,
  label,
  rightAdornment,
  className,
  ...input
}: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="mpx-auth-label">
        {label}
      </label>
      <div className="mpx-auth-input-wrap">
        <input
          id={id}
          className={`mpx-auth-input ${rightAdornment ? "has-action" : ""} ${className ?? ""}`.trim()}
          {...input}
        />
        {rightAdornment ? (
          <div className="mpx-auth-input-action-slot">{rightAdornment}</div>
        ) : null}
      </div>
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
    <p role="alert" data-testid={testId} className="mpx-auth-alert is-error">
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
    <div data-testid={testId} className="mpx-auth-alert is-success">
      {children}
    </div>
  );
}

export function AuthDivider() {
  return (
    <div aria-hidden className="mpx-auth-divider">
      <i />
      <span>or</span>
      <i />
    </div>
  );
}
