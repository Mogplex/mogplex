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
    <div className="signal-lost relative min-h-dvh w-full overflow-hidden font-mono text-slate-200">
      <section className="relative flex min-h-dvh w-full flex-col">
        <div className="absolute inset-0 z-0">
          <AsciiHero />
        </div>

        <header className="relative z-20 flex items-center justify-between px-6 py-5 text-xs uppercase tracking-[0.28em] text-slate-400 md:px-10">
          {/* TODO(#557 commit 3): root path bounces through middleware to the user's personal slug. */}
          <Link href="/" className="flex items-center gap-2 text-slate-200 transition-colors hover:text-white">
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

            <h1 className="mt-5 text-4xl font-semibold leading-tight text-white md:text-6xl">
              That route fell out of the graph.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-slate-300 md:text-base">
              The destination you asked for is not active on this deployment.
              Jump back into a workspace or re-enter through the front door.
            </p>

            <div className="mt-6 inline-flex items-center gap-3 self-center border border-white/10 bg-slate-950/32 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-300 backdrop-blur-md">
              <span className="text-slate-500">missing path</span>
              <span className="break-all text-slate-100">{pathname}</span>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/"
                className="inline-flex items-center justify-center border border-white/15 bg-slate-950/28 px-6 py-3 text-sm text-slate-100 shadow-signal-lost-action backdrop-blur-md transition-colors hover:bg-slate-950/38 md:bg-white/5 md:shadow-none md:backdrop-blur-0 md:hover:bg-white/10"
              >
                open workspaces
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center border border-white/10 px-6 py-3 text-sm text-slate-300 transition-colors hover:border-white/20 hover:text-white"
              >
                sign in again
              </Link>
            </div>
          </div>
        </div>

        <div className="relative z-20 flex items-center justify-center gap-2 px-6 pb-6 text-[10px] uppercase tracking-[0.22em] text-slate-500 md:px-10">
          <span>built by</span>
          <a
            href="https://www.webrenew.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Webrenew"
            className="text-slate-400 transition-colors hover:text-slate-200"
          >
            <WebrenewWordmark className="h-3 w-auto" />
          </a>
        </div>
      </section>
    </div>
  )
}
