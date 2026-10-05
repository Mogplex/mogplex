import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("Neon client bundles omit legacy realtime and Control defers Shiki", () => {
  const buildDir = join(process.cwd(), ".next");
  const source = readFileSync(
    join(
      buildDir,
      "server/app/(dashboard)/[scope]/control/page_client-reference-manifest.js"
    ),
    "utf8"
  );
  const manifestJson = source.match(
    /^globalThis\.__RSC_MANIFEST\[.+\] = (.+);$/m
  )?.[1];
  expect(manifestJson).toBeDefined();
  const manifest = JSON.parse(manifestJson!) as {
    clientModules: Record<string, { chunks: string[] }>;
  };
  const initialChunks = new Set(
    Object.values(manifest.clientModules).flatMap((module) =>
      module.chunks.map((chunk) => chunk.replace(/^\/_next\//, ""))
    )
  );
  const chunks = readdirSync(join(buildDir, "static/chunks"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => ({
      file,
      source: readFileSync(join(buildDir, "static/chunks", file), "utf8"),
    }));

  expect
    .soft(
      chunks
        .filter(({ source }) => source.includes("postgres_changes"))
        .map(({ file }) => file)
    )
    .toEqual([]);

  // Match the highlighter implementation, rather than the lightweight
  // callers that eventually invoke it after the code plugin loads.
  const shikiChunks = chunks.filter(({ source }) =>
    source.includes("getLoadedLanguages(){")
  );
  expect(shikiChunks.length).toBeGreaterThan(0);
  expect(
    shikiChunks
      .filter(({ file }) => initialChunks.has(`static/chunks/${file}`))
      .map(({ file }) => file)
  ).toEqual([]);
});
