import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneNextConfig,
  MOGPLEX_SANDBOX_ORIGIN_PATTERN,
  patchNextConfigContent,
} from "../../lib/sandbox/runtimes/next-config-patch";

test("patchNextConfigContent injects allowedDevOrigins into an export-default object literal", () => {
  const input = [
    "/** @type {import('next').NextConfig} */",
    "export default {",
    "  reactStrictMode: true,",
    "};",
    "",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "patched");
  if (result.kind !== "patched") return;

  assert.match(
    result.content,
    /allowedDevOrigins:\s*\[\s*"\*\.vercel\.run"\s*\]/
  );
  assert.match(result.content, /reactStrictMode:\s*true/);
});

test("patchNextConfigContent injects allowedDevOrigins into a module.exports object literal", () => {
  const input = [
    "/** @type {import('next').NextConfig} */",
    "module.exports = {",
    "  images: { unoptimized: true },",
    "};",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "patched");
  if (result.kind !== "patched") return;

  assert.match(result.content, /allowedDevOrigins/);
  assert.match(result.content, /images:\s*\{\s*unoptimized:\s*true\s*\}/);
});

test("patchNextConfigContent handles named TypeScript config variables", () => {
  const input = [
    "import type { NextConfig } from 'next';",
    "",
    "const nextConfig: NextConfig = {",
    "  reactStrictMode: true,",
    "};",
    "",
    "export default nextConfig;",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "patched");
  if (result.kind !== "patched") return;

  assert.match(result.content, /allowedDevOrigins/);
  assert.match(result.content, /const nextConfig: NextConfig/);
});

test("patchNextConfigContent targets the export default, not a preceding variable", () => {
  const input = [
    "const plugins = { mdx: true };",
    "export default {",
    "  reactStrictMode: true,",
    "};",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "patched");
  if (result.kind !== "patched") return;

  // allowedDevOrigins must appear inside `export default {`, not inside `plugins`
  assert.match(result.content, /export default \{\n {2}allowedDevOrigins/);
  // The plugins object must remain untouched
  assert.match(result.content, /const plugins = \{ mdx: true \}/);
});

test("patchNextConfigContent targets the last named variable when no export default or module.exports is present", () => {
  const input = [
    "const plugins = { mdx: true };",
    "const nextConfig: NextConfig = {",
    "  reactStrictMode: true,",
    "};",
    "export default nextConfig;",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "patched");
  if (result.kind !== "patched") return;

  // allowedDevOrigins must appear inside `nextConfig`, not inside `plugins`
  assert.match(
    result.content,
    /const nextConfig: NextConfig = \{\n {2}allowedDevOrigins/
  );
  // The plugins object must remain untouched
  assert.match(result.content, /const plugins = \{ mdx: true \}/);
});

test("patchNextConfigContent is idempotent when allowedDevOrigins is already present", () => {
  const input = [
    "export default {",
    "  allowedDevOrigins: ['existing.example.com'],",
    "  reactStrictMode: true,",
    "};",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "unchanged");
  if (result.kind !== "unchanged") return;
  assert.equal(result.reason, "already_configured");
});

test("patchNextConfigContent reports no_injection_point when it cannot locate the config object", () => {
  const input = [
    "import makeConfig from './factory.js';",
    "export default makeConfig();",
  ].join("\n");

  const result = patchNextConfigContent(input);
  assert.equal(result.kind, "unchanged");
  if (result.kind !== "unchanged") return;
  assert.equal(result.reason, "no_injection_point");
});

test("patchNextConfigContent uses a custom origin when provided", () => {
  const input = "export default { reactStrictMode: true };";
  const result = patchNextConfigContent(input, "sb-abc123.vercel.run");
  assert.equal(result.kind, "patched");
  if (result.kind !== "patched") return;

  assert.match(result.content, /"sb-abc123\.vercel\.run"/);
});

test("buildStandaloneNextConfig produces a valid ESM config with allowedDevOrigins", () => {
  const output = buildStandaloneNextConfig();

  assert.match(output, /export default nextConfig/);
  assert.match(
    output,
    new RegExp(
      `allowedDevOrigins:\\s*\\["${MOGPLEX_SANDBOX_ORIGIN_PATTERN.replace(/[.*]/g, "\\$&")}"\\]`
    )
  );
});
