import assert from "node:assert/strict";
import test from "node:test";
import { resolveTriggerCliPackage } from "../../lib/trigger/cli-package";

test("resolveTriggerCliPackage uses the shared Trigger version when sdk and build match", () => {
  assert.equal(
    resolveTriggerCliPackage({
      sdkVersion: "4.4.4",
      buildVersion: "4.4.4",
    }),
    "trigger.dev@4.4.4"
  );
});

test("resolveTriggerCliPackage accepts semver with prerelease suffix", () => {
  assert.equal(
    resolveTriggerCliPackage({
      sdkVersion: "4.4.4-beta.1",
      buildVersion: null,
    }),
    "trigger.dev@4.4.4-beta.1"
  );
});

test("resolveTriggerCliPackage falls back to whichever Trigger package version is available", () => {
  assert.equal(
    resolveTriggerCliPackage({
      sdkVersion: "4.4.4",
      buildVersion: null,
    }),
    "trigger.dev@4.4.4"
  );
  assert.equal(
    resolveTriggerCliPackage({
      sdkVersion: null,
      buildVersion: "4.4.4",
    }),
    "trigger.dev@4.4.4"
  );
});

test("resolveTriggerCliPackage rejects mismatched local Trigger package versions", () => {
  assert.throws(
    () =>
      resolveTriggerCliPackage({
        sdkVersion: "4.4.4",
        buildVersion: "4.4.3",
      }),
    /Mismatched Trigger package versions/
  );
});

test("resolveTriggerCliPackage throws when no local Trigger package version is available", () => {
  assert.throws(
    () =>
      resolveTriggerCliPackage({
        sdkVersion: null,
        buildVersion: null,
      }),
    /Unable to determine a local Trigger\.dev package version/
  );
});

test("resolveTriggerCliPackage rejects non-semver version strings", () => {
  for (const bad of [
    "file:../local",
    "git+https://github.com/example/repo.git",
    "latest",
    "abc",
    "../../../etc/passwd",
  ]) {
    assert.throws(
      () => resolveTriggerCliPackage({ sdkVersion: bad, buildVersion: null }),
      /Invalid Trigger\.dev package version/,
      `expected rejection for version: ${bad}`
    );
  }
});
