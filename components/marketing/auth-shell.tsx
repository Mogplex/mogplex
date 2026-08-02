import type { ReactNode } from "react";
import { MarketingHeader } from "@/components/marketing/header";

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
    <main className="mplex-landing relative min-h-dvh overflow-hidden pt-14">
      <div aria-hidden className="mplex-auth-grid" />
      <div aria-hidden className="mplex-auth-vignette" />
      <MarketingHeader mode="login" />

      <section className="relative z-10 flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-6 py-16 sm:py-20">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex flex-col items-center text-center">
            {eyebrow ? (
              <div className="mplex-mono text-marketing-accent-muted mb-4 text-[11px] tracking-[0.24em] uppercase">
                {eyebrow}
              </div>
            ) : null}
            <h1 className="mplex-serif text-[36px] leading-[1.05] font-normal tracking-tight text-white sm:text-[44px]">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-marketing-muted mt-4 max-w-[36ch] text-[15px] leading-[1.5]">
                {subtitle}
              </p>
            ) : null}
          </div>

          {notice ? <div className="mb-4 flex justify-center">{notice}</div> : null}

          {children}

          {footer ? (
            <div className="text-marketing-muted mt-6 text-center text-[13px]">
              {footer}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
