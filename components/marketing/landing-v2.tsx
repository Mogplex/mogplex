"use client";

import { useEffect, useRef } from "react";

import {
  BlueprintOverlay,
  interTight,
  MpxFooter,
  MpxHeader,
  plexMono,
} from "@/components/marketing/mpx-chrome";

import {
  BuildMaintainSection,
  EnterpriseSection,
  GatesSection,
  HarnessesSection,
  HeroSection,
  ProofSection,
} from "./landing-v2/index";

import "./landing-v2.css";

/* ── page ─────────────────────────────────────────────────────── */

export function MarketingLandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  /* corner brackets fade in while scrolling, matching the blueprint frame */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      rootRef.current?.classList.add("is-scrolling");
      clearTimeout(timer);
      timer = setTimeout(
        () => rootRef.current?.classList.remove("is-scrolling"),
        180
      );
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      className={`mpx-landing ${interTight.variable} ${plexMono.variable}`}
      ref={rootRef}
    >
      <BlueprintOverlay />

      <MpxHeader />

      <main>
        <HeroSection />

        <ProofSection />

        <BuildMaintainSection />

        <GatesSection />

        <HarnessesSection />

        <EnterpriseSection />
      </main>

      <MpxFooter />
    </div>
  );
}
