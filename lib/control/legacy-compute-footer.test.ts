import { expect, it } from "vitest";
import { isLegacyRoutineComputeFooter } from "./legacy-compute-footer";

it.each([
  "Compute: stopped automatically; no sandbox task remains running.",
  "Compute: still running because the preview remains available.",
  "Compute: still running because this is a persistent session.",
  "Compute: still running because follow-up work still needs it.",
  "Compute: still running because you asked to keep it running.",
])("recognizes the old server-authored routine footer: %s", (text) => {
  expect(isLegacyRoutineComputeFooter(`\n\n${text} `)).toBe(true);
});

it.each([
  "Compute: still running because an automatic stop could not be confirmed.",
  "Could not confirm that sandbox compute stopped. Check its status before leaving.",
  "The previous reply said: Compute: still running because this is a persistent session.",
  "```\nCompute: still running because this is a persistent session.\n```",
  "Compute: still running because the deployment is active.",
])(
  "preserves warnings, quoted text, and other status explanations: %s",
  (text) => {
    expect(isLegacyRoutineComputeFooter(text)).toBe(false);
  }
);
