import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const findAnchor = (html: string, href: string) =>
  html.match(/<a\b[^>]*>/g)?.find((tag) => tag.includes(`href="${href}"`)) ??
  null;

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
  const settingsAnchor = findAnchor(html, "/acme/settings");

  assert.ok(dividerIndex !== -1, "divider is rendered between the groups");
  assert.ok(settingsIndex > dividerIndex, "settings renders after the divider");
  assert.ok(settingsAnchor);
  assert.ok(settingsAnchor.includes('aria-current="page"'));
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
  const controlAnchor = findAnchor(html, "/acme/control");
  assert.ok(controlAnchor);
  assert.ok(controlAnchor.includes('aria-current="page"'));
});
