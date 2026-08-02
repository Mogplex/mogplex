"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MogplexWordmark } from "@/components/brand/mogplex-wordmark";

type HeaderProps = {
  mode?: "home" | "login";
};

const NAV_LINKS = [
  { label: "Product", href: "/#benefits" },
  { label: "Workflows", href: "/#workflows" },
  { label: "CLI", href: "/#install" },
  { label: "Docs", href: "https://docs.mogplex.com/", external: true },
] as const;

export function MarketingHeader({ mode = "home" }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-close the mobile menu once the viewport reaches the desktop (md)
  // breakpoint, where the menu UI and its toggle are hidden. Without this, a
  // menu opened on a narrow screen would leave the body scroll-locked with no
  // visible control to close it after a resize/rotate.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // While the menu is open: lock body scroll, trap focus inside the overlay,
  // close on Escape, and restore focus to the toggle on close.
  useEffect(() => {
    if (!menuOpen) return;
    document.body.style.overflow = "hidden";
    const toggle = toggleRef.current;

    // Tab cycle includes the toggle button so the visible close control (the
    // "X") stays reachable by keyboard even though it lives outside the overlay.
    const focusable = () => {
      const menu = menuRef.current;
      const items = menu
        ? Array.from(
            menu.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
      return toggle ? [toggle, ...items] : items;
    };

    // Send focus into the menu content (first nav link) on open.
    focusable().find((el) => el !== toggle)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      toggle?.focus();
    };
  }, [menuOpen]);

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: "var(--mplex-bg)",
        borderBottom: "1px dashed var(--mplex-grid-line)",
      }}
    >
      <div className="mplex-wrap relative z-50 flex h-14 items-center justify-between gap-4">
        <Link
          href="/"
          aria-label="Mogplex home"
          className="text-white"
        >
          <MogplexWordmark height={20} />
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target={"external" in l && l.external ? "_blank" : undefined}
              rel={
                "external" in l && l.external
                  ? "noopener noreferrer"
                  : undefined
              }
              className="px-4 py-2 text-[14px] text-white/85 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          {mode === "login" ? null : (
            <div className="hidden items-center gap-4 md:flex">
              <Link
                href="/login"
                className="text-[13px] text-white/70 transition-colors hover:text-white"
              >
                Sign in
              </Link>
              <Link
                href="/request-access"
                className="mplex-btn mplex-btn-primary text-[13px]"
                style={{ padding: "6px 12px" }}
              >
                Request access
              </Link>
            </div>
          )}

          <MenuToggle
            ref={toggleRef}
            open={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          />
        </div>
      </div>

      <MobileMenu
        ref={menuRef}
        open={menuOpen}
        mode={mode}
        onClose={() => setMenuOpen(false)}
      />
    </header>
  );
}

function MenuToggle({
  ref,
  open,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls="mobile-nav"
      onClick={onClick}
      className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white transition-colors hover:border-white/40 md:hidden"
    >
      <span className="relative block h-[14px] w-[16px]">
        <span
          className="absolute left-0 block h-[1.5px] w-full rounded-full bg-current transition-all duration-300 ease-out"
          style={{
            top: open ? "50%" : "1px",
            transform: open
              ? "translateY(-50%) rotate(45deg)"
              : "translateY(0) rotate(0)",
          }}
        />
        <span
          className="absolute left-0 top-1/2 block h-[1.5px] w-full -translate-y-1/2 rounded-full bg-current transition-all duration-200 ease-out"
          style={{ opacity: open ? 0 : 1 }}
        />
        <span
          className="absolute left-0 block h-[1.5px] w-full rounded-full bg-current transition-all duration-300 ease-out"
          style={{
            bottom: open ? "50%" : "1px",
            transform: open
              ? "translateY(50%) rotate(-45deg)"
              : "translateY(0) rotate(0)",
          }}
        />
      </span>
    </button>
  );
}

function MobileMenu({
  ref,
  open,
  mode,
  onClose,
}: {
  ref?: React.Ref<HTMLDivElement>;
  open: boolean;
  mode: "home" | "login";
  onClose: () => void;
}) {
  return (
    <div
      ref={ref}
      id="mobile-nav"
      aria-hidden={!open}
      className="fixed inset-0 z-40 flex flex-col md:hidden"
      style={{
        background: "var(--mplex-bg)",
        opacity: open ? 1 : 0,
        visibility: open ? "visible" : "hidden",
        pointerEvents: open ? "auto" : "none",
        transition: "opacity 0.3s ease, visibility 0.3s ease",
      }}
    >
      <div className="mplex-wrap flex h-14 w-full items-center" aria-hidden>
        {/* spacer matching the header bar; logo + close stay visible from the fixed header */}
      </div>

      <nav className="mplex-wrap flex w-full flex-1 flex-col overflow-y-auto pt-6">
        {NAV_LINKS.map((l, i) => (
          <a
            key={l.href}
            href={l.href}
            target={"external" in l && l.external ? "_blank" : undefined}
            rel={
              "external" in l && l.external ? "noopener noreferrer" : undefined
            }
            onClick={onClose}
            className="border-b border-dashed border-white/10 py-5 text-[24px] font-medium tracking-tight text-white/90 transition-[color,transform,opacity] duration-300 ease-out hover:text-white"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? "translateX(0)" : "translateX(-16px)",
              transitionDelay: open ? `${80 + i * 55}ms` : "0ms",
            }}
          >
            {l.label}
          </a>
        ))}

        {mode === "login" ? null : (
          <div
            className="mt-auto flex flex-col gap-3 pb-10 pt-8"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 0.3s ease, transform 0.3s ease",
              transitionDelay: open ? `${80 + NAV_LINKS.length * 55}ms` : "0ms",
            }}
          >
            <Link
              href="/request-access"
              onClick={onClose}
              className="mplex-btn mplex-btn-primary justify-center py-3 text-[15px]"
            >
              Request access
            </Link>
            <Link
              href="/login"
              onClick={onClose}
              className="mplex-btn mplex-btn-ghost justify-center py-3 text-[15px]"
            >
              Sign in
            </Link>
          </div>
        )}
      </nav>
    </div>
  );
}
