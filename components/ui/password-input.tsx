"use client";

import { Eye, EyeClosed } from "iconoir-react";
import { useId, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type PasswordVisibilityToggleProps = {
  visible: boolean;
  onToggle: () => void;
  label?: string;
  unavailable?: boolean;
} & Omit<ComponentProps<"button">, "onClick" | "type" | "children">;

export function PasswordVisibilityToggle({
  visible,
  onToggle,
  label = "secret",
  unavailable = false,
  disabled,
  className,
  ...props
}: PasswordVisibilityToggleProps) {
  const action = unavailable
    ? "Saved secret cannot be shown"
    : `${visible ? "Hide" : "Show"} ${label}`;

  return (
    <button
      {...props}
      type="button"
      aria-label={action}
      aria-pressed={visible}
      title={action}
      disabled={disabled || unavailable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-40",
        className
      )}
    >
      {visible ? <EyeClosed aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
    </button>
  );
}

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  type?: "password" | "text";
  containerClassName?: string;
  previewable?: boolean;
};

export function PasswordInput({
  type = "password",
  containerClassName,
  previewable = true,
  className,
  disabled,
  ...props
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = props.id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const revealed = visible && previewable && !disabled;

  if (type !== "password") {
    return <Input {...props} type={type} disabled={disabled} className={className} />;
  }

  return (
    <div
      className={cn("relative min-w-0", containerClassName)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setVisible(false);
      }}
    >
      <Input
        {...props}
        id={inputId}
        type={revealed ? "text" : "password"}
        disabled={disabled}
        className={cn("border-border", className, "pr-10")}
      />
      <PasswordVisibilityToggle
        visible={revealed}
        onToggle={() => setVisible((current) => !current)}
        unavailable={!previewable}
        disabled={disabled}
        aria-controls={inputId}
        className="absolute inset-y-0 right-1 my-auto"
      />
    </div>
  );
}
