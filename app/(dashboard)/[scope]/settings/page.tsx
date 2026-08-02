import type { Metadata } from "next"
import { SettingsPageClient } from "./settings-page-client"
import { getScopeContext } from "@/lib/scope-context"

export const metadata: Metadata = {
  title: "Settings | Mogplex",
  description:
    "Manage account connections, API keys, model defaults, and workspace preferences.",
  robots: {
    index: false,
    follow: false,
  },
}

export default async function SettingsPage() {
  const scope = await getScopeContext()
  return <SettingsPageClient scope={scope} />
}
