"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { WebrenewWordmark } from "@/components/brand/webrenew-wordmark"

const AsciiHero = dynamic(
  () => import("@/components/marketing/ascii-hero").then((m) => m.AsciiHero),
  { ssr: false, loading: () => null },
)

export default function NotFound() {
  const pathname = usePathname() || "/"

  return (
    <div className="signal-lost relative min-h-dvh w-full overflow-hidden font-mono text-foreground">
      <section className="relative flex min-h-dvh w-full flex-col">
        <div className="absolute inset-0 z-0">
          <AsciiHero />
        </div>

        <header className="relative z-20 flex items-center justify-between px-6 py-5 text-xs uppercase tracking-[0.28em] text-muted-foreground md:px-10">
          {/* TODO(#557 commit 3): root path bounces through middleware to the user's personal slug. */}
          <Link href="/" className="flex items-center gap-2 text-foreground transition-colors hover:text-foreground/85">
            <span aria-hidden="true" className="text-base leading-none">
              👾
            </span>
            mogplex
          </Link>
          <span className="hidden md:inline">a workbench for agents and makers</span>
        </header>

        <div className="relative z-20 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 pb-[12dvh] pt-10 text-center md:px-10">
          <div className="mx-auto max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.28em] text-rose-300">
              signal lost · 404
            </div>

            <h1 className="mt-5 text-4xl font-semibold leading-tight text-foreground md:text-6xl">
              That route fell out of the graph.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
              The destination you asked for is not active on this deployment.
              Jump back into a workspace or re-enter through the front door.
            </p>

            <div className="mt-6 inline-flex items-center gap-3 self-center border border-border bg-background/35 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground backdrop-blur-md">
              <span className="text-muted-foreground/70">missing path</span>
              <span className="break-all text-foreground">{pathname}</span>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/"
                className="inline-flex items-center justify-center border border-border bg-background/30 px-6 py-3 text-sm text-foreground shadow-signal-lost-action backdrop-blur-md transition-colors hover:bg-secondary/60 md:bg-foreground/[0.05] md:shadow-none md:backdrop-blur-0 md:hover:bg-foreground/10"
              >
                open workspaces
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center border border-border px-6 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
              >
                sign in again
              </Link>
            </div>
          </div>
        </div>

        <div className="relative z-20 flex items-center justify-center gap-2 px-6 pb-6 text-[10px] uppercase tracking-[0.22em] text-muted-foreground md:px-10">
          <span>built by</span>
          <a
            href="https://www.webrenew.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Webrenew"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <WebrenewWordmark className="h-3 w-auto" />
          </a>
        </div>
      </section>
    </div>
  )
}
