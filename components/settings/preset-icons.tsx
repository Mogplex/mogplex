import type { FC } from "react"
import { NeonIcon } from "./neon-icon"
import {
  Browserbase,
  Linear,
  NotionFill,
  PlugFill,
  Sanity,
  Sentry,
  SlackFill,
  SupabaseFill,
  TriggerDev,
  VercelFill,
  WebhookFill,
  type IconProps,
} from "./icons"

type PresetIcon = FC<IconProps>

const PRESET_ICON: Record<string, PresetIcon> = {
  zapier: WebhookFill,
  notion: NotionFill,
  supabase: SupabaseFill,
  neon: NeonIcon,
  browserbase: Browserbase,
  sentry: Sentry,
  sanity: Sanity,
  linear: Linear,
  trigger: TriggerDev,
  slack: SlackFill,
  vercel: VercelFill,
}

export function getPresetIcon(presetId: string | null | undefined): PresetIcon {
  if (!presetId) return PlugFill
  return PRESET_ICON[presetId] ?? PlugFill
}
