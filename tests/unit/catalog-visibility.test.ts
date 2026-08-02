import assert from "node:assert/strict";
import test from "node:test";
import {
  filterVisibleModelCatalog,
  isCatalogModelVisible,
  isHiddenCatalogModelId,
  isHiddenCatalogModelRow,
} from "../../lib/models/catalog-visibility";

test("catalog visibility helpers read the row-level is_hidden flag", () => {
  assert.equal(isHiddenCatalogModelRow({ is_hidden: true }), true);
  assert.equal(isHiddenCatalogModelRow({ is_hidden: false }), false);
  assert.equal(isHiddenCatalogModelRow({}), false);
  assert.equal(isHiddenCatalogModelRow(null), false);

  assert.equal(isCatalogModelVisible({ is_hidden: true }), false);
  assert.equal(isCatalogModelVisible({ is_hidden: false }), true);
  assert.equal(isCatalogModelVisible({}), true);
});

test("visible catalog filtering drops only rows marked hidden", () => {
  const catalog = [
    { id: "visible", is_hidden: false },
    { id: "hidden", is_hidden: true },
    { id: "implicit-visible" },
  ];

  assert.deepEqual(
    filterVisibleModelCatalog(catalog).map((model) => model.id),
    ["visible", "implicit-visible"]
  );
});

test("id-only helper checks caller-provided hidden id set", () => {
  const hiddenIds = new Set(["legacy/hidden-model"]);

  assert.equal(isHiddenCatalogModelId("legacy/hidden-model", hiddenIds), true);
  assert.equal(
    isHiddenCatalogModelId("minimax/minimax-m2.7", hiddenIds),
    false
  );
  assert.equal(isHiddenCatalogModelId(null, hiddenIds), false);
});
