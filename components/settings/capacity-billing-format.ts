export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatBytes(raw: string | number): string {
  const bytes = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const gb = bytes / 1_000_000_000;
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: gb < 10 ? 2 : 1,
  }).format(gb)} GB`;
}

export function formatDate(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function clampPercent(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
