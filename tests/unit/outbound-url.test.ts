import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeOutboundHttpUrl,
  assertSafeOutboundHttpUrlWithDns,
  type DnsLookupFn,
  UnsafeOutboundUrlError,
} from "../../lib/security/outbound-url";

test("assertSafeOutboundHttpUrl rejects localhost targets", () => {
  assert.throws(
    () => assertSafeOutboundHttpUrl("http://localhost:3000/api", "base_url"),
    (error: unknown) =>
      error instanceof UnsafeOutboundUrlError &&
      error.message === "base_url must target a public host"
  );
});

test("assertSafeOutboundHttpUrlWithDns rejects hostnames resolving to private addresses", async () => {
  const privateIpv4 = ["10", "42", "0", "15"].join(".");
  const lookupHostname: DnsLookupFn = async () => [
    { address: privateIpv4, family: 4 },
  ];

  await assert.rejects(
    () =>
      assertSafeOutboundHttpUrlWithDns(
        "https://public.example/api",
        "base_url",
        lookupHostname
      ),
    (error: unknown) =>
      error instanceof UnsafeOutboundUrlError &&
      error.message === "base_url resolves to a private network address"
  );
});

test("assertSafeOutboundHttpUrl rejects explicit cloud metadata endpoints", () => {
  assert.throws(
    () => assertSafeOutboundHttpUrl("https://169.254.169.254/latest/meta-data"),
    (error: unknown) =>
      error instanceof UnsafeOutboundUrlError &&
      error.message === "url must target a public host"
  );
});

test("assertSafeOutboundHttpUrlWithDns rejects hostnames when any resolved address is private", async () => {
  const publicIpv4 = ["93", "184", "216", "34"].join(".");
  const privateIpv4 = ["10", "0", "0", "1"].join(".");
  const lookupHostname: DnsLookupFn = async () => [
    { address: publicIpv4, family: 4 },
    { address: privateIpv4, family: 4 },
  ];

  await assert.rejects(
    () =>
      assertSafeOutboundHttpUrlWithDns(
        "https://public.example/api",
        "base_url",
        lookupHostname
      ),
    (error: unknown) =>
      error instanceof UnsafeOutboundUrlError &&
      error.message === "base_url resolves to a private network address"
  );
});

test("assertSafeOutboundHttpUrlWithDns allows hostnames resolving to public addresses", async () => {
  const publicIpv4 = ["93", "184", "216", "34"].join(".");
  const lookupHostname: DnsLookupFn = async () => [
    { address: publicIpv4, family: 4 },
  ];

  const safeUrl = await assertSafeOutboundHttpUrlWithDns(
    "https://public.example/api",
    "base_url",
    lookupHostname
  );

  assert.equal(safeUrl, "https://public.example/api");
});

test("assertSafeOutboundHttpUrlWithDns rejects hostnames that cannot be resolved", async () => {
  const lookupHostname: DnsLookupFn = async () => {
    throw new Error("dns failed");
  };

  await assert.rejects(
    () =>
      assertSafeOutboundHttpUrlWithDns(
        "https://public.example/api",
        "base_url",
        lookupHostname
      ),
    (error: unknown) =>
      error instanceof UnsafeOutboundUrlError &&
      error.message === "base_url must resolve to a public host"
  );
});

test("assertSafeOutboundHttpUrl rejects IPv6 unique local addresses", () => {
  assert.throws(
    () => assertSafeOutboundHttpUrl("https://[fd00:ec2::254]/latest/meta-data"),
    (error: unknown) =>
      error instanceof UnsafeOutboundUrlError &&
      error.message === "url must target a public host"
  );
});
