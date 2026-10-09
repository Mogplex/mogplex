/**
 * Whether a channel type represents a direct conversation (1:1 DM or group DM).
 */
export function isDirectChannelType(
  type: string | undefined | null
): type is "im" | "mpim" {
  return type === "im" || type === "mpim";
}
