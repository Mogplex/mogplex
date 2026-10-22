"use client";

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { PasswordVisibilityToggle } from "@/components/ui/password-input";

type AuthFieldProps = {
  id: string;
  label: string;
} & InputHTMLAttributes<HTMLInputElement>;

export function AuthField({
  id,
  label,
  type,
  disabled,
  className,
  ...input
}: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const revealed = visible && !disabled;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="mpx-auth-label">
        {label}
      </label>
      <div
        className="mpx-auth-input-wrap"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setVisible(false);
        }}
      >
        <input
          id={id}
          {...input}
          type={isPassword && revealed ? "text" : type}
          disabled={disabled}
          className={`mpx-auth-input ${isPassword ? "has-action" : ""} ${className ?? ""}`.trim()}
        />
        {isPassword ? (
          <div className="mpx-auth-input-action-slot">
            <PasswordVisibilityToggle
              visible={revealed}
              onToggle={() => setVisible((current) => !current)}
              label={label.toLowerCase()}
              disabled={disabled}
              aria-controls={id}
              data-testid={`${id}-toggle`}
              className="mpx-auth-input-action"
            />
          </div>
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
