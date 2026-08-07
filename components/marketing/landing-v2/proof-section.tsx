"use client";

import { Eyebrow } from "@/components/marketing/mpx-chrome";

import { proofItems } from "./data";

export function ProofSection() {
  return (
    <section className="mpx-proof" aria-label="System properties">
      <Eyebrow>OPEN AND INSPECTABLE</Eyebrow>
      {proofItems.map(({ label, icon }) => (
        <div key={label}>
          <i>{icon}</i>
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}
