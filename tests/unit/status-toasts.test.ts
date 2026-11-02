import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("toast status helpers dispatch the matching variant into the shared store", async () => {
  const { toast, useToast } = await import("../../hooks/use-toast");
  // Render the latest toast from the shared store as plain text.
  function Probe() {
    const latest = useToast().toasts[0];
    return `${String(latest?.title)}|${latest?.variant}`;
  }
  const readLatest = () => renderToStaticMarkup(createElement(Probe));
  const cases = [
    [toast.success, "success"],
    [toast.info, "info"],
    [toast.warning, "warning"],
    [toast.error, "destructive"],
  ] as const;

  for (const [show, variant] of cases) {
    show({ title: `${variant} toast` });
    assert.equal(readLatest(), `${variant} toast|${variant}`);
  }

  // The base call still accepts an explicit variant.
  toast({ title: "explicit", variant: "info" });
  assert.equal(readLatest(), "explicit|info");
});

test("each status renders a tinted surface, icon, and screen-reader label", async () => {
  const { ToastIcon, toastVariants } =
    await import("../../components/ui/toast");
  const expectations = {
    success: { token: "accent-green", label: "Success:" },
    info: { token: "accent-blue", label: "Info:" },
    warning: { token: "accent-amber", label: "Warning:" },
    destructive: { token: "destructive", label: "Error:" },
  } as const;

  for (const [variant, { token, label }] of Object.entries(expectations)) {
    const classes = toastVariants({
      variant: variant as keyof typeof expectations,
    });
    assert.ok(
      classes.includes(`border-l-${token}`),
      `${variant} has accent bar`
    );
    assert.ok(
      classes.includes(`var(--${token})`),
      `${variant} has tinted surface`
    );
    // Group class lets ToastAction pick up the status color.
    assert.ok(classes.split(" ").includes(variant), `${variant} group class`);

    const html = renderToStaticMarkup(
      createElement(ToastIcon, {
        variant: variant as keyof typeof expectations,
      })
    );
    assert.ok(html.includes("<svg"), `${variant} renders an icon`);
    assert.ok(
      html.includes('aria-hidden="true"'),
      `${variant} icon is decorative`
    );
    assert.ok(html.includes(label), `${variant} has sr-only label`);
  }
});

test("default toasts stay neutral and render no status icon", async () => {
  const { ToastIcon, toastVariants } =
    await import("../../components/ui/toast");
  const classes = toastVariants({ variant: "default" });
  for (const token of [
    "accent-green",
    "accent-blue",
    "accent-amber",
    "destructive",
  ]) {
    assert.ok(!classes.includes(token), `default has no ${token}`);
  }
  assert.equal(renderToStaticMarkup(createElement(ToastIcon, {})), "");
});
