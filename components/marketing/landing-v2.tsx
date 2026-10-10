import {
  MpxHeader,
} from "@/components/marketing/mpx-chrome";
import { BlueprintOverlay } from "./mpx-static";
import { MpxFooter } from "./mpx-chrome-footer";
import { MarketingScrollFrame } from "./marketing-scroll-frame";
import { interTight, plexMono } from "@/components/marketing/mpx-fonts";

import {
  BuildMaintainSection,
  EnterpriseSection,
  GatesSection,
  HarnessesSection,
  HeroSection,
  OrchestratorSection,
  ProofSection,
} from "./landing-v2/index";

import "./landing-v2.css";

/* ── page ─────────────────────────────────────────────────────── */

export function MarketingLandingPage() {
  return (
    <MarketingScrollFrame
      className={`mpx-landing ${interTight.variable} ${plexMono.variable}`}
    >
      <BlueprintOverlay />

      <MpxHeader />

      <main>
        <HeroSection />

        <ProofSection />

        <OrchestratorSection />

        <BuildMaintainSection />

        <GatesSection />

        <HarnessesSection />

        <EnterpriseSection />
      </main>

      <MpxFooter />
    </MarketingScrollFrame>
  );
}
