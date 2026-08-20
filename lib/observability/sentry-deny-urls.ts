/**
 * Stack-frame URL patterns whose errors should never be reported to Sentry.
 *
 * Each entry filters out crashes whose origin frame matches the pattern, not
 * crashes whose message happens to contain the substring — that's the
 * difference between Sentry's `denyUrls` (URL-based) and `ignoreErrors`
 * (message-based). Use this list for third-party scripts injected into the
 * page that we don't ship (browser extensions, analytics shims, etc.) — we
 * see their unhandled rejections in our project but cannot fix them.
 *
 * When adding an entry, leave a comment with the originating Sentry issue or
 * MOGPLEX ticket so future maintainers can verify the filter is still useful.
 */
export const SENTRY_DENY_URLS: ReadonlyArray<RegExp> = [
  // gadstat.com — third-party tracking script (likely injected by a browser
  // extension; the domain does not appear in our source). Surfaced as an
  // unhandled `TypeError: Failed to fetch` on /automations in MOGPLEX-5
  // (Sentry issue 7430540013) — see mogplex#287.
  //
  // The pattern is anchored on `://(<sub>.)?gadstat.com/` so it cannot match
  // a domain that merely contains "gadstat.com" as a substring (e.g.
  // `notgadstat.com` or `gadstat.com.attacker.tld`).
  /:\/\/(?:[^/]+\.)?gadstat\.com\//i,

  // MetaMask extension — the extension's inpage.js content script throws
  // `Error: MetaMask extension not found` for users with a broken or partial
  // MetaMask install. We don't ship or support MetaMask as an auth provider,
  // so this is unfixable third-party noise (Sentry issue 7674230253).
  //
  // The captured frame URL is `app:///scripts/inpage.js`; anchor on the full
  // scheme + path so the filter can't match unrelated scripts.
  /^app:\/\/\/scripts\/inpage\.js$/i, // `$`-anchored so inpage.js.map and siblings don't match
];
