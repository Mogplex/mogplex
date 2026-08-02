const SEMVER_PREFIX = /^\d+\.\d+\.\d+/;

export function resolveTriggerCliPackage(input: {
  sdkVersion?: string | null;
  buildVersion?: string | null;
}) {
  const sdkVersion = input.sdkVersion?.trim() || null;
  const buildVersion = input.buildVersion?.trim() || null;

  if (sdkVersion && buildVersion && sdkVersion !== buildVersion) {
    throw new Error(
      `Mismatched Trigger package versions: @trigger.dev/sdk=${sdkVersion}, @trigger.dev/build=${buildVersion}`
    );
  }

  const version = sdkVersion ?? buildVersion;
  if (!version) {
    throw new Error(
      "Unable to determine a local Trigger.dev package version for the CLI wrapper"
    );
  }

  if (!SEMVER_PREFIX.test(version)) {
    throw new Error(
      `Invalid Trigger.dev package version: "${version}" does not look like a semver string`
    );
  }

  return `trigger.dev@${version}`;
}
