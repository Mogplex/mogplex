type CatalogVisibilityRow = {
  is_hidden?: boolean | null;
};

export function isCatalogModelVisible(model: CatalogVisibilityRow) {
  return model.is_hidden !== true;
}

export function isHiddenCatalogModelRow(
  model: CatalogVisibilityRow | null | undefined
) {
  return model?.is_hidden === true;
}

export function isHiddenCatalogModelId(
  modelId: string | null | undefined,
  hiddenIds: ReadonlySet<string>
): modelId is string {
  return typeof modelId === "string" && hiddenIds.has(modelId);
}

export function filterVisibleModelCatalog<
  T extends { id: string; is_hidden?: boolean | null },
>(catalog: T[]) {
  return catalog.filter(isCatalogModelVisible);
}
