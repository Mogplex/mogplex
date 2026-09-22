import type { IconProps } from "./icons";

// Official monochrome logomark: https://neon.com/brand (2026-06-03 assets).
// Keep its geometry intact; inherit the same foreground as other provider icons.
export function NeonIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M63 0.0177909V63.5526L38.4178 42.2501V63.5526H0V0L63 0.0177909ZM7.72251 55.8389H30.6953V25.3238L55.2779 47.0476V7.72922L7.72251 7.71559V55.8389Z" />
    </svg>
  );
}
