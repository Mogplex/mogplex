import type { SVGProps } from "react";

type IconProps = { size?: number } & Omit<
  SVGProps<SVGSVGElement>,
  "width" | "height"
>;

function IconBase({
  size = 16,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Github: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5a3.4 3.4 0 0 0-1-2.6c3.3-.4 6.7-1.6 6.7-7a5.4 5.4 0 0 0-1.5-3.8 5 5 0 0 0-.1-3.8s-1.2-.4-3.9 1.5a13.4 13.4 0 0 0-7 0C5.5 0 4.3.4 4.3.4a5 5 0 0 0-.1 3.8 5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.3 6.6 6.6 7a3.4 3.4 0 0 0-1 2.6V21" />
    </IconBase>
  ),
  ArrowRight: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </IconBase>
  ),
  Play: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Check: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M20 6L9 17l-5-5" />
    </IconBase>
  ),
  Terminal: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 17l6-6-6-6M12 19h8" />
    </IconBase>
  ),
  Cpu: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </IconBase>
  ),
  Eye: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  ),
  Bolt: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
    </IconBase>
  ),
  Hook: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M18 16a4 4 0 0 1-4 4M6 8a4 4 0 0 1 4-4M14 4l-4 4M10 20l4-4M20 14l-4-4M4 10l4 4" />
    </IconBase>
  ),
  Box: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </IconBase>
  ),
  Shield: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  ),
  Lock: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="4" y="11" width="16" height="10" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </IconBase>
  ),
  Chart: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M16 8h4v4" />
    </IconBase>
  ),
  Asterisk: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 3v18M5 7l14 10M5 17L19 7" />
    </IconBase>
  ),
  Hexagon: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
    </IconBase>
  ),
  Clock: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  ),
  Chat: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z" />
    </IconBase>
  ),
  Dots: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="6" cy="6" r="1" />
      <circle cx="12" cy="6" r="1" />
      <circle cx="18" cy="6" r="1" />
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
      <circle cx="6" cy="18" r="1" />
      <circle cx="12" cy="18" r="1" />
      <circle cx="18" cy="18" r="1" />
    </IconBase>
  ),
  Hash: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </IconBase>
  ),
  X: (p: IconProps) => (
    <IconBase {...p}>
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z"
        fill="currentColor"
        stroke="none"
      />
    </IconBase>
  ),
};
