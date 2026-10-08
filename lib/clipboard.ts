/**
 * Copies text to the clipboard and reports whether it worked.
 *
 * `navigator.clipboard.writeText` rejects in ordinary situations: the
 * document is not focused (a toolbar iframe or devtools holds focus), the
 * browser or webview denies clipboard permission, or the page is not a
 * secure context so the API is missing. When it fails, this falls back to
 * the legacy selection + `execCommand("copy")` path, which still runs
 * inside the click's user activation. Callers must show failure, since a
 * silent miss reads as "copied" to the user.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path.
    }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  const previousFocus = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    if (
      previousFocus &&
      "focus" in previousFocus &&
      typeof previousFocus.focus === "function"
    )
      previousFocus.focus();
  }
}
