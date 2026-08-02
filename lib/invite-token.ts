import { randomBytes } from "node:crypto";

// 24 bytes → 32-char base64url string, 192 bits of entropy. The token is the
// bearer credential for accepting an invite; stored as-is in team_invites.token
// (unique index). Single-use, 7-day default expiry.
export function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}
