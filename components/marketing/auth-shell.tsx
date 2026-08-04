import type { ReactNode } from "react";
import { IBM_Plex_Mono } from "next/font/google";
import {
  BlueprintOverlay,
  Eyebrow,
  MpxHeader,
} from "@/components/marketing/mpx-chrome";
import "./auth.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

type AuthShellProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  notice?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  notice,
  footer,
  children,
}: AuthShellProps) {
  return (
    <div className={`mpx-landing mpx-auth ${plexMono.variable}`}>
      <BlueprintOverlay />
      <MpxHeader />
      <main>
        <section className="mpx-auth-panel">
          <div className="mpx-auth-head">
            {eyebrow ? <Eyebrow large>{eyebrow}</Eyebrow> : null}
            <h1>{title}</h1>
            {subtitle ? <p className="mpx-auth-sub">{subtitle}</p> : null}
          </div>

          {notice ? <div className="mpx-auth-notices">{notice}</div> : null}

          {children}

          {footer ? <div className="mpx-auth-foot">{footer}</div> : null}
        </section>
      </main>
    </div>
  );
}
