"use client";

import { ConsentBanner, ConsentDialog } from "@c15t/nextjs";
import "@c15t/nextjs/styles.css";

export default function ConsentUi() {
  return (
    <>
      <ConsentBanner legalLinks={["privacyPolicy", "termsOfService"]} />
      <ConsentDialog />
    </>
  );
}
