import type { Metadata } from "next"
import { MarketingLandingPage } from "@/components/marketing/landing-v2"
import { MARKETING_JSON_LD, buildMarketingMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMarketingMetadata({
  path: "/",
})

export default function HomePage() {
  return (
    <>
      <MarketingLandingPage />
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(MARKETING_JSON_LD),
        }}
      />
    </>
  )
}
