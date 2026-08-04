"use client";

/* Shared chrome for marketing "sheet" pages (/workflows, /how-it-works,
   /faq). Reuses the exact landing header/footer from mpx-chrome so the
   sheets can never drift from the landing design; page content is passed
   as server-rendered children and styled by subpage.css. */

import Link from "next/link";

import {
  BlueprintOverlay,
  Eyebrow,
  MpxFooter,
  MpxHeader,
  plexMono,
} from "@/components/marketing/mpx-chrome";

import "./landing-v2.css";
import "./subpage.css";

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
  return (
    <div className={`mpx-landing mpx-sub ${plexMono.variable}`}>
      <BlueprintOverlay />
      <MpxHeader />

      <main>
        {children}

        <section className="mpx-sub-close">
          <Eyebrow large>{close.kicker}</Eyebrow>
          <h2>
            {close.lines[0]}
            <br />
            {close.lines[1]}
          </h2>
          <div className="mpx-sub-close-actions">
            <Link className="mpx-button is-primary" href="/request-access">
              Get an access code
            </Link>
            <p>{close.note}</p>
          </div>
        </section>
      </main>

      <MpxFooter />
    </div>
  );
}
