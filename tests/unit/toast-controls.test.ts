import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reducer, toast, useToast } from "../../hooks/use-toast";
import { toastVariants, ToastIcon } from "../../components/ui/toast";

function readToasts() {
  function Probe() {
    return useToast()
      .toasts.map(
        (item) =>
          `${item.id}|${String(item.title)}|${item.variant}|${item.open}`
      )
      .join("\n");
  }
  return renderToStaticMarkup(createElement(Probe))
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title, variant, open] = line.split("|");
      return { id, title, variant, open: open === "true" };
    });
}

test("a burst preserves each notification instead of replacing the previous one", () => {
  let state: Parameters<typeof reducer>[0] = { toasts: [] };
  for (let index = 0; index < 5; index += 1) {
    state = reducer(state, {
      type: "ADD_TOAST",
      toast: { id: `toast-${index}`, title: `Result ${index}`, open: true },
    });
  }
  assert.deepEqual(
    state.toasts.map((item) => item.id),
    ["toast-4", "toast-3", "toast-2", "toast-1", "toast-0"]
  );
});

test("an operation can update its existing notification without supplying or changing its identity", () => {
  const handle = toast.info({ title: "Saving changes" });
  handle.update({ title: "Changes saved", variant: "success" });
  const matches = readToasts().filter((item) => item.id === handle.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "Changes saved");
  assert.equal(matches[0].variant, "success");
});

test("an excessive burst retains the 100 newest notifications with stable identities", () => {
  let state: Parameters<typeof reducer>[0] = { toasts: [] };
  for (let index = 0; index < 250; index += 1) {
    state = reducer(state, {
      type: "ADD_TOAST",
      toast: { id: `burst-${index}`, title: `Result ${index}`, open: true },
    });
  }
  assert.equal(state.toasts.length, 100);
  assert.equal(state.toasts[0].id, "burst-249");
  assert.equal(state.toasts.at(-1)?.id, "burst-150");
  state = reducer(state, {
    type: "UPDATE_TOAST",
    toast: { id: "burst-0", open: true },
  });
  assert.equal(state.toasts.length, 100);
  assert.equal(
    state.toasts.some((item) => item.id === "burst-0"),
    false
  );
});

test("dismissing one notification preserves the others and its removal is final", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const first = toast.error({ title: "Build failed" });
  const second = toast.success({ title: "Changes saved" });
  first.dismiss();
  assert.equal(readToasts().find((item) => item.id === first.id)?.open, false);
  assert.equal(readToasts().find((item) => item.id === second.id)?.open, true);
  context.mock.timers.runAll();
  assert.equal(
    readToasts().some((item) => item.id === first.id),
    false
  );
  first.update({ title: "A late update" });
  assert.equal(
    readToasts().some((item) => item.id === first.id),
    false
  );
});

test("status surfaces have a single background rule and no generic global marker classes", () => {
  for (const variant of [
    "success",
    "info",
    "warning",
    "destructive",
  ] as const) {
    const classes = toastVariants({ variant }).split(/\s+/);
    assert.equal(classes.filter((name) => name.startsWith("bg-")).length, 1);
    assert.equal(classes.includes(variant), false);
    const icon = renderToStaticMarkup(createElement(ToastIcon, { variant }));
    assert.match(icon, /text-popover-foreground/);
  }
});
