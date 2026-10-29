export function isValidRunAt(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    ) &&
    Number.isFinite(Date.parse(value)) &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  );
}

export function assertFutureRunAt(value: string, now = Date.now()) {
  if (!isValidRunAt(value) || Date.parse(value) <= now) {
    throw new Error(
      "Run once must use a future ISO timestamp with an explicit timezone offset."
    );
  }
}
