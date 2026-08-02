import type { FC } from "react"
import {
  Browserbase,
  Linear,
  NotionFill,
  PlugFill,
  Sanity,
  Sentry,
  SlackFill,
  SupabaseFill,
  VercelFill,
  WebhookFill,
  type IconProps,
} from "./icons"

type PresetIcon = FC<IconProps>

const PRESET_ICON: Record<string, PresetIcon> = {
  zapier: WebhookFill,
  notion: NotionFill,
  supabase: SupabaseFill,
  browserbase: Browserbase,
  sentry: Sentry,
  sanity: Sanity,
  linear: Linear,
  slack: SlackFill,
  vercel: VercelFill,
}

export function getPresetIcon(presetId: string | null | undefined): PresetIcon {
  if (!presetId) return PlugFill
  return PRESET_ICON[presetId] ?? PlugFill
}
