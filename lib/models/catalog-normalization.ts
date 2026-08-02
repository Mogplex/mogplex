type CatalogModelNameOverride = {
  id: string;
  name: string;
};

const CATALOG_MODEL_NAME_OVERRIDES: CatalogModelNameOverride[] = [
  {
    id: "anthropic/claude-fable-5",
    name: "Claude Fable 5",
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
  },
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
  },
];

export function normalizeCatalogModelName(id: string, name: string) {
  const override = CATALOG_MODEL_NAME_OVERRIDES.find(
    (entry) => entry.id === id
  );

  return override?.name ?? name;
}

export function normalizeCatalogModel<T extends { id: string; name: string }>(
  model: T
) {
  const normalizedName = normalizeCatalogModelName(model.id, model.name);
  return normalizedName === model.name
    ? model
    : {
        ...model,
        name: normalizedName,
      };
}
