export interface CliReleaseAsset {
  target: string;
  archiveName: string;
  archiveFormat: string;
  archiveUrl: string;
  sha256: string;
}

export interface CliReleaseManifest {
  version: string;
  releaseTag: string;
  baseUrl: string;
  generatedAt?: string;
  installScriptUrl: string;
  assets: CliReleaseAsset[];
}

export const CANONICAL_CLI_BASE_URL = "https://install.mogplex.com";
export const CANONICAL_CLI_MANIFEST_URL = `${CANONICAL_CLI_BASE_URL}/latest.json`;
export const CANONICAL_CLI_INSTALL_SCRIPT_URL = `${CANONICAL_CLI_BASE_URL}/install.sh`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeCliReleaseAsset(value: unknown): CliReleaseAsset | null {
  if (!isRecord(value)) return null;

  const target = readString(value, "target");
  const archiveName = readString(value, "archiveName");
  const archiveFormat = readString(value, "archiveFormat");
  const archiveUrl = readString(value, "archiveUrl");
  const sha256 = readString(value, "sha256");

  if (!target || !archiveName || !archiveFormat || !archiveUrl || !sha256) {
    return null;
  }

  return {
    target,
    archiveName,
    archiveFormat,
    archiveUrl,
    sha256,
  };
}

export function normalizeCliReleaseManifest(
  value: unknown
): CliReleaseManifest | null {
  if (!isRecord(value)) return null;

  const version = readString(value, "version");
  const releaseTag = readString(value, "releaseTag");
  const baseUrl = readString(value, "baseUrl");
  const generatedAt =
    typeof value.generatedAt === "string" ? value.generatedAt : undefined;
  const assets = Array.isArray(value.assets)
    ? value.assets
        .map((asset) => normalizeCliReleaseAsset(asset))
        .filter((asset): asset is CliReleaseAsset => asset !== null)
    : [];

  if (!version || !releaseTag || !baseUrl || assets.length === 0) {
    return null;
  }

  return {
    version,
    releaseTag,
    baseUrl,
    generatedAt,
    installScriptUrl: CANONICAL_CLI_INSTALL_SCRIPT_URL,
    assets,
  };
}

export async function fetchCliReleaseManifest(
  fetchImpl: typeof fetch = fetch
): Promise<CliReleaseManifest | null> {
  try {
    const response = await fetchImpl(CANONICAL_CLI_MANIFEST_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return normalizeCliReleaseManifest(await response.json());
  } catch {
    return null;
  }
}
