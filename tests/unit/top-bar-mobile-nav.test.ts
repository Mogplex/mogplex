import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("mobile sheet nav renders admin items after a divider and marks the active link", async () => {
  const { MobileSheetNav } = await import("../../components/top-bar");
  const { buildAppNavItems } = await import("../../lib/app-navigation");
  const items = buildAppNavItems("acme");
  const html = renderToStaticMarkup(
    createElement(MobileSheetNav, {
      primaryItems: items.filter((item) => item.section === "primary"),
      adminItems: items.filter((item) => item.section === "admin"),
      pathname: "/acme/settings",
    })
  );

  const dividerIndex = html.indexOf("border-t");
  const settingsIndex = html.indexOf("/acme/settings");

  assert.ok(dividerIndex !== -1, "divider is rendered between the groups");
  assert.ok(settingsIndex > dividerIndex, "settings renders after the divider");
  assert.match(html, /<a aria-current="page"[^>]*href="\/acme\/settings"/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
});

test("mobile sheet nav omits the divider when the admin group is empty", async () => {
  const { MobileSheetNav } = await import("../../components/top-bar");
  const { buildAppNavItems } = await import("../../lib/app-navigation");
  const items = buildAppNavItems("acme");
  const html = renderToStaticMarkup(
    createElement(MobileSheetNav, {
      primaryItems: items.filter((item) => item.section === "primary"),
      adminItems: [],
      pathname: "/acme/control",
    })
  );

  assert.ok(
    !html.includes("border-t"),
    "no dangling divider without admin items"
  );
  assert.ok(html.includes("/acme/projects/repositories"));
  assert.match(html, /<a aria-current="page"[^>]*href="\/acme\/control"/);
});
