// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

const originalExecCommand = document.execCommand;
let copiedBySelection: string | null = null;

function setClipboard(
  writeText: ((text: string) => Promise<void>) | undefined
) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function setExecCommand(result: boolean | Error) {
  copiedBySelection = null;
  document.execCommand = vi.fn(() => {
    if (result instanceof Error) throw result;
    const active = document.activeElement;
    if (result && active instanceof HTMLTextAreaElement) {
      copiedBySelection = active.value;
    }
    return result;
  });
}

beforeEach(() => {
  const trigger = document.createElement("button");
  trigger.id = "trigger";
  document.body.replaceChildren(trigger);
  trigger.focus();
});

afterEach(() => {
  document.execCommand = originalExecCommand;
  setClipboard(undefined);
});

describe("copyText", () => {
  it("should use the async clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    setExecCommand(true);

    await expect(copyText("mog_abc")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("mog_abc");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("should fall back to a selection copy when writeText rejects", async () => {
    setClipboard(
      vi.fn().mockRejectedValue(new Error("Document is not focused."))
    );
    setExecCommand(true);

    await expect(copyText("mog_abc")).resolves.toBe(true);
    expect(copiedBySelection).toBe("mog_abc");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement?.id).toBe("trigger");
  });

  it("should fall back when the clipboard API is missing", async () => {
    setClipboard(undefined);
    setExecCommand(true);

    await expect(copyText("mog_abc")).resolves.toBe(true);
    expect(copiedBySelection).toBe("mog_abc");
  });

  it("should report failure when both paths fail", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    setExecCommand(false);

    await expect(copyText("mog_abc")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("should report failure when execCommand throws", async () => {
    setClipboard(undefined);
    setExecCommand(new Error("not supported"));

    await expect(copyText("mog_abc")).resolves.toBe(false);
    expect(document.activeElement?.id).toBe("trigger");
  });
});
