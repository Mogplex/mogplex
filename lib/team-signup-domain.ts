const sharedEmailDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "msn.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/** Only a verified work email can authorize its own exact domain. */
export function verifiedWorkEmailDomain(
  email: string | null,
  verified: boolean
): string | null {
  if (!verified || !email) return null;
  const match =
    /^[^@\s]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i.exec(
      email
    );
  const domain = match?.[1].toLowerCase();
  return domain && !sharedEmailDomains.has(domain) ? domain : null;
}
