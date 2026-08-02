import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const AWS_INSTANCE_METADATA_IPV4 = ["169", "254", "169", "254"].join(".");
const AWS_ECS_TASK_METADATA_IPV4 = ["169", "254", "170", "2"].join(".");
const AWS_INSTANCE_METADATA_IPV6 = ["fd00", "ec2", "", "254"].join(":");

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "0.0.0.0",
  "127.0.0.1",
  "::",
  "::1",
  AWS_INSTANCE_METADATA_IPV4,
  AWS_ECS_TASK_METADATA_IPV4,
  AWS_INSTANCE_METADATA_IPV6,
  "metadata.google.internal",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home.arpa",
  ".lan",
];

export class UnsafeOutboundUrlError extends Error {
  code: "INVALID_URL" | "UNSAFE_OUTBOUND_TARGET";

  constructor(message: string, code: "INVALID_URL" | "UNSAFE_OUTBOUND_TARGET") {
    super(message);
    this.name = "UnsafeOutboundUrlError";
    this.code = code;
  }
}

export type DnsLookupAddress = {
  address: string;
  family: number;
};

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<DnsLookupAddress[]>;

function normalizeHostname(hostname: string) {
  return hostname
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  const mappedIpv4Match = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4Match) {
    return isPrivateIpv4(mappedIpv4Match[1]);
  }

  const firstHextet = normalized.split(":", 1)[0];
  if (!/^[\da-f]{1,4}$/.test(firstHextet)) {
    return false;
  }

  const firstHextetValue = Number.parseInt(firstHextet, 16);
  return (
    (firstHextetValue & 65_024) === 64_512 ||
    (firstHextetValue & 65_472) === 65_152
  );
}

function isPrivateIpAddress(hostname: string) {
  const normalized = normalizeHostname(hostname);
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isPrivateIpv6(normalized);
  return false;
}

function isBlockedHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  return isPrivateIpAddress(normalized);
}

export function assertSafeOutboundHttpUrl(value: string, fieldName = "url") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeOutboundUrlError(
      `${fieldName} must be a valid URL`,
      "INVALID_URL"
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError(
      `${fieldName} must use http or https`,
      "INVALID_URL"
    );
  }

  if (isBlockedHostname(url.hostname)) {
    throw new UnsafeOutboundUrlError(
      `${fieldName} must target a public host`,
      "UNSAFE_OUTBOUND_TARGET"
    );
  }

  return url.toString();
}

const lookupAllAddresses: DnsLookupFn = (hostname, options) =>
  dnsLookup(hostname, options);

// DNS checks add a useful SSRF guardrail for hostnames, but they cannot fully
// eliminate DNS rebinding because fetch() resolves the host again at connect
// time. Keep egress controls blocking metadata and private-network targets as a
// second layer of defense.
export async function assertSafeOutboundHttpUrlWithDns(
  value: string,
  fieldName = "url",
  lookupHostname: DnsLookupFn = lookupAllAddresses
) {
  const safeUrl = assertSafeOutboundHttpUrl(value, fieldName);
  const url = new URL(safeUrl);
  const hostname = normalizeHostname(url.hostname);

  if (isPrivateIpAddress(hostname)) {
    throw new UnsafeOutboundUrlError(
      `${fieldName} must target a public host`,
      "UNSAFE_OUTBOUND_TARGET"
    );
  }

  if (isIP(hostname)) {
    return safeUrl;
  }

  let addresses: DnsLookupAddress[];
  try {
    addresses = await lookupHostname(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new UnsafeOutboundUrlError(
      `${fieldName} must resolve to a public host`,
      "UNSAFE_OUTBOUND_TARGET"
    );
  }

  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError(
      `${fieldName} must resolve to a public host`,
      "UNSAFE_OUTBOUND_TARGET"
    );
  }

  if (addresses.some((address) => isPrivateIpAddress(address.address))) {
    throw new UnsafeOutboundUrlError(
      `${fieldName} resolves to a private network address`,
      "UNSAFE_OUTBOUND_TARGET"
    );
  }

  return safeUrl;
}
