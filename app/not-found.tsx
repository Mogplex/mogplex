"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BlueprintOverlay,
  MpxFooter,
  MpxHeader,
} from "@/components/marketing/mpx-chrome"
import { interTight, plexMono } from "@/components/marketing/mpx-fonts"

import "@/components/marketing/landing-v2.css"
import "@/components/marketing/subpage.css"

export default function NotFound() {
  const pathname = usePathname() || "/"

  return (
    <div className={`mpx-landing mpx-sub ${interTight.variable} ${plexMono.variable}`}>
      <BlueprintOverlay />
      <MpxHeader />

      <main>
        <section className="sub-hero min-h-[70vh]">
          <div className="hero-annot mono" aria-hidden>
            <span>MOGPLEX</span>
            <span className="annot-rule" />
            <span>404 · PATH NOT FOUND</span>
          </div>
          <h1 className="sub-title">This path is not in the foundry.</h1>
          <p className="sub-lede">
            No page exists at this path. Return to Mogplex, or sign in again if
            your workspace session ended.
          </p>
          <p className="mono micro break-all">missing path · {pathname}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className="mpx-button is-primary" href="/">
              Return to Mogplex
            </Link>
            <Link className="mpx-button" href="/login">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <MpxFooter />
    </div>
  )
}
