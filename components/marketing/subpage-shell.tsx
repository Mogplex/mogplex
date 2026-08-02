"use client";

/* Shared chrome for marketing "sheet" pages (/workflows, /how-it-works,
   /faq). Same spine, nav, close CTA and footer as landing-v2, but static —
   no GSAP; the only client behavior is the mobile menu. Page content is
   passed as server-rendered children. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MogplexWordmark } from "@/components/brand/mogplex-wordmark";

import "./landing-v2.css";
import "./subpage.css";

const NAV_LINKS = [
  { label: "Product", href: "/#pipeline" },
  { label: "Workflows", href: "/workflows" },
  { label: "How it works", href: "/how-it-works" },
  { label: "FAQ", href: "/faq" },
  { label: "Docs", href: "https://docs.mogplex.com" },
] as const;

type CloseCta = {
  kicker: string;
  lines: [string, string];
  note: string;
};

export function MarketingSubpageShell({
  close,
  children,
}: {
  close: CloseCta;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      // the hamburger only exists ≤860px; close the menu if the viewport outgrows it
      if (window.innerWidth > 860) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="mlp">
      <header className="nav">
        <Link className="nav-brand" href="/" aria-label="Mogplex home">
          <MogplexWordmark className="wordmark" height={20} />
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href ? "page" : undefined}
            >
              {l.label}
            </a>
          ))}
          <Link href="/login">Sign in</Link>
        </nav>
        <Link className="btn btn-primary btn-sm nav-cta" href="/request-access">
          Request access
        </Link>
        <button
          className="nav-toggle"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="bar" aria-hidden />
          <span className="bar" aria-hidden />
        </button>
      </header>

      <div className={`mobile-menu${menuOpen ? " is-open" : ""}`} id="mobile-menu">
        <nav className="mobile-links" aria-label="Mobile">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={closeMenu}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="mobile-cta">
          <Link className="btn btn-primary" href="/request-access" onClick={closeMenu}>
            Request access
          </Link>
          <Link className="btn btn-ghost" href="/login" onClick={closeMenu}>
            Sign in
          </Link>
        </div>
      </div>

      <main>
        <div className="sub-wrap">
          <div className="spine" aria-hidden />
          <div className="rail-right" aria-hidden />
          {children}
        </div>

        <section className="close">
          <p className="kicker mono close-kicker">{close.kicker}</p>
          <h2 className="close-title">
            <span className="line"><span className="line-inner">{close.lines[0]}</span></span>
            <span className="line"><span className="line-inner">{close.lines[1]}</span></span>
          </h2>
          <div className="close-cta">
            <Link className="btn btn-inverse" href="/request-access">
              Get an access code
            </Link>
            <p className="mono micro">{close.note}</p>
          </div>
          <div className="close-flow" aria-hidden />
        </section>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <svg
            className="mark"
            width="18"
            height="18"
            viewBox="0 0 32 32"
            fill="currentColor"
            aria-hidden
          >
            <path d="M16.0002 26.6667L10.667 32L0 21.3335L5.33326 15.9998L16.0002 26.6667ZM32.0005 21.3335L21.3335 32L16.0002 26.6667L26.6667 15.9998L32.0005 21.3335ZM16.0002 5.33326L5.33326 15.9998L0.000460359 10.667L10.667 0L16.0002 5.33326ZM32.0005 10.6665L26.6667 15.9998L16.0002 5.33326L21.3335 0L32.0005 10.6665Z" />
          </svg>
          <span className="mono">MOGPLEX — AGENTIC CI/CD</span>
        </div>
        <nav className="footer-links mono" aria-label="Footer">
          <Link href="/workflows">Workflows</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/faq">FAQ</Link>
          <a href="https://docs.mogplex.com">Docs</a>
          <Link href="/request-access">Request access</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <a href="https://x.com/mogplex">@mogplex</a>
        </nav>
        <p className="mono footer-fine">© 2026 Webrenew · Mogplex. Drawn to scale.</p>
      </footer>
    </div>
  );
}
