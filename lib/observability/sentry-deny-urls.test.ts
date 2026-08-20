import { describe, expect, it } from "vitest";
import { SENTRY_DENY_URLS } from "./sentry-deny-urls";

function matchesAnyDenyUrl(url: string): boolean {
  return SENTRY_DENY_URLS.some((pattern) => pattern.test(url));
}

describe("SENTRY_DENY_URLS", () => {
  describe("MetaMask extension (Sentry issue 7674230253)", () => {
    it("matches the captured inpage.js frame URL", () => {
      expect(matchesAnyDenyUrl("app:///scripts/inpage.js")).toBe(true);
    });

    it("does not match same-path scripts on http(s) origins", () => {
      expect(matchesAnyDenyUrl("https://app.mogplex.com/scripts/inpage.js")).toBe(false);
      expect(matchesAnyDenyUrl("http://localhost:3000/scripts/inpage.js")).toBe(false);
    });

    it("does not match other app-scheme scripts", () => {
      expect(matchesAnyDenyUrl("app:///scripts/other.js")).toBe(false);
      expect(matchesAnyDenyUrl("app:///scripts/inpage.js.map")).toBe(false);
    });
  });

  describe("gadstat.com tracker (Sentry issue 7430540013)", () => {
    it("matches gadstat.com and its subdomains", () => {
      expect(matchesAnyDenyUrl("https://gadstat.com/track.js")).toBe(true);
      expect(matchesAnyDenyUrl("https://cdn.gadstat.com/pixel.js")).toBe(true);
    });

    it("does not match lookalike domains", () => {
      expect(matchesAnyDenyUrl("https://notgadstat.com/x.js")).toBe(false);
      expect(matchesAnyDenyUrl("https://gadstat.com.attacker.tld/x.js")).toBe(false);
    });
  });
});
