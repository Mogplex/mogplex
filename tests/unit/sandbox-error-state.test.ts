import assert from "node:assert/strict";
import test from "node:test";
import {
  createSandboxLaunchAttemptId,
  parseSandboxErrorCode,
  presentSandboxError,
  shouldShowSandboxLaunchError,
} from "../../lib/sandbox/error-state";

function parseFallbackLaunchAttemptId(id: string) {
  const match = /^launch-([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]+)$/.exec(id);
  assert.ok(match, `Expected fallback launch attempt id, received ${id}`);
  return {
    now: match[1],
    time: match[2],
    sequence: Number.parseInt(match[3], 36),
  };
}

test("parseSandboxErrorCode maps GitHub and Vercel launch blockers", () => {
  assert.equal(
    parseSandboxErrorCode("Connect GitHub account first"),
    "GITHUB_NOT_CONNECTED"
  );
  assert.equal(
    parseSandboxErrorCode(
      "Reconnect Vercel to launch sandboxes in a linked Vercel project."
    ),
    "VERCEL_RECONNECT_REQUIRED"
  );
  assert.equal(
    parseSandboxErrorCode(
      "Select or create a Vercel project for user-owned sandbox billing."
    ),
    "VERCEL_PROJECT_REQUIRED"
  );
  assert.equal(
    parseSandboxErrorCode(
      "Platform sandbox billing is not enabled for this account. Link Personal Vercel and select a billing project to launch sandboxes."
    ),
    "VERCEL_CONNECTION_REQUIRED"
  );
  assert.equal(
    parseSandboxErrorCode(
      "Platform sandbox access is not enabled for this account. Relaunch this repo with a personal Vercel billing project to keep using sandbox tools."
    ),
    "VERCEL_CONNECTION_REQUIRED"
  );

  // Specific platform-access phrases outrank a generic status-code-403 match,
  // even when both appear in the same message.
  assert.equal(
    parseSandboxErrorCode(
      "Request failed with status code 403: Platform sandbox billing is not enabled for this account."
    ),
    "VERCEL_CONNECTION_REQUIRED"
  );

  // A bare 403 without a platform-access phrase falls back to the generic
  // classification — expected for SDK-native auth errors that aren't from
  // our platform gate.
  assert.equal(
    parseSandboxErrorCode("Request failed with status code 403"),
    "SANDBOX_SERVICE_UNAVAILABLE"
  );
});

test("presentSandboxError returns action-oriented titles and CTAs", () => {
  const reconnect = presentSandboxError(
    "Reconnect Vercel to launch sandboxes in a linked Vercel project."
  );
  const projectRequired = presentSandboxError(
    "Select or create a Vercel project for user-owned sandbox billing."
  );
  const generic = presentSandboxError("Something else went wrong");

  assert.equal(reconnect?.title, "Reconnect Vercel to launch this preview");
  assert.deepEqual(reconnect?.cta, {
    label: "Reconnect Vercel",
    href: "/api/auth/vercel",
  });

  assert.equal(
    projectRequired?.title,
    "Link a Vercel project to launch this preview"
  );
  assert.deepEqual(projectRequired?.cta, {
    label: "Open project settings",
    href: "/projects/repositories",
  });

  assert.equal(generic?.title, "Sandbox launch failed");
  assert.equal(generic?.cta, null);

  const platformBlocked = presentSandboxError(
    "Platform sandbox billing is not enabled for this account. Link Personal Vercel and select a billing project to launch sandboxes."
  );
  assert.equal(
    platformBlocked?.title,
    "Connect your Vercel account to launch sandboxes"
  );
  assert.deepEqual(platformBlocked?.cta, {
    label: "Connect Vercel",
    href: "/api/auth/vercel",
  });
});

test("createSandboxLaunchAttemptId fallback stays unique when clocks do not advance", () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "crypto"
  );
  const performanceDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "performance"
  );
  const originalDateNow = Date.now;

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "performance", {
      configurable: true,
      value: { now: () => 123.456 },
    });
    Date.now = () => 1_700_000_000_000;

    const first = createSandboxLaunchAttemptId();
    const second = createSandboxLaunchAttemptId();
    const firstParts = parseFallbackLaunchAttemptId(first);
    const secondParts = parseFallbackLaunchAttemptId(second);

    assert.notEqual(first, second);
    assert.equal(firstParts.now, (1_700_000_000_000).toString(36));
    assert.equal(firstParts.time, Math.floor(123.456 * 1000).toString(36));
    // The fallback sequence is module-global, so assert relative order instead
    // of assuming this test is the first fallback caller in the process.
    assert.equal(secondParts.now, firstParts.now);
    assert.equal(secondParts.time, firstParts.time);
    assert.equal(secondParts.sequence, firstParts.sequence + 1);
  } finally {
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
    if (performanceDescriptor) {
      Object.defineProperty(globalThis, "performance", performanceDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "performance");
    }
    Date.now = originalDateNow;
  }
});

test("shouldShowSandboxLaunchError keeps stale stopped errors hidden", () => {
  assert.equal(
    shouldShowSandboxLaunchError({
      error: { message: "Old launch failed", code: "UNKNOWN" },
      overlayStatus: "stopped",
      stoppedOverlayLaunchAttemptId: null,
    }),
    false
  );
  assert.equal(
    shouldShowSandboxLaunchError({
      error: {
        message: "Old launch failed",
        code: "UNKNOWN",
        launchAttemptId: "launch-old",
      },
      overlayStatus: "stopped",
      stoppedOverlayLaunchAttemptId: "launch-new",
    }),
    false
  );
});

test("shouldShowSandboxLaunchError hides stale errors once the sandbox is running", () => {
  // A "Sandbox is still booting" 409 from /restart can stamp a launch error
  // moments before the original launch finishes successfully. Once the record
  // reports running, the stale error must not pin an overlay over a working
  // preview.
  assert.equal(
    shouldShowSandboxLaunchError({
      error: {
        message: "Sandbox is still booting",
        code: "UNKNOWN",
        launchAttemptId: "launch-stale",
      },
      overlayStatus: "running",
      stoppedOverlayLaunchAttemptId: null,
    }),
    false
  );
});

test("shouldShowSandboxLaunchError surfaces fresh stopped-overlay errors", () => {
  assert.equal(
    shouldShowSandboxLaunchError({
      error: {
        message: "Fresh launch failed",
        code: "UNKNOWN",
        launchAttemptId: "launch-new",
      },
      overlayStatus: "stopped",
      stoppedOverlayLaunchAttemptId: "launch-new",
    }),
    true
  );
  assert.equal(
    shouldShowSandboxLaunchError({
      error: { message: "Launch failed", code: "UNKNOWN" },
      overlayStatus: "error",
      stoppedOverlayLaunchAttemptId: null,
    }),
    true
  );
});
