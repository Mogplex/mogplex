"use client"

type Variant = "dots" | "pulse" | "bars"

export function AsciiLoader({ variant = "dots" }: { variant?: Variant }) {
  if (variant === "bars") {
    return (
      <span className="inline-flex gap-[3px] items-center h-3">
        <span className="w-4 h-[3px] rounded-full bg-secondary-foreground/40 animate-[pulse-bar_1s_ease-in-out_infinite]" />
        <span className="w-4 h-[3px] rounded-full bg-secondary-foreground/40 animate-[pulse-bar_1s_ease-in-out_0.15s_infinite]" />
        <span className="w-4 h-[3px] rounded-full bg-secondary-foreground/40 animate-[pulse-bar_1s_ease-in-out_0.3s_infinite]" />
      </span>
    )
  }

  return (
    <span className="inline-flex gap-[3px] items-center h-3">
      <span className="w-[5px] h-[5px] rounded-full bg-secondary-foreground/60 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
      <span className="w-[5px] h-[5px] rounded-full bg-secondary-foreground/60 animate-[pulse-dot_1.4s_ease-in-out_0.2s_infinite]" />
      <span className="w-[5px] h-[5px] rounded-full bg-secondary-foreground/60 animate-[pulse-dot_1.4s_ease-in-out_0.4s_infinite]" />
    </span>
  )
}
