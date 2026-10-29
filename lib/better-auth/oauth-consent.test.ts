import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readOAuthConsent } from "./oauth-consent";

describe("OAuth consent display", () => {
  it("does not display or approve unsigned, forged or retired authorization requests", async () => {
    const secret = randomBytes(32).toString("hex");
    for (const query of [
      "",
      "authorization_id=retired-supabase-request",
      "client_id=client&redirect_uri=https%3A%2F%2Fclient.example&scope=write",
      "client_id=client&redirect_uri=javascript%3Aalert%281%29&exp=1&sig=forged",
    ])
      expect(await readOAuthConsent(query, secret)).toBeNull();
  });
});
