import { cn } from "@/lib/utils";

/** Up to two initials for a team or account without an icon. */
export function scopeInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Square team (or account) icon: the uploaded image when there is one,
 * otherwise initials. Size and text size come from `className`.
 */
export function ScopeIcon({
  name,
  iconUrl,
  className,
}: {
  name: string;
  iconUrl?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-accent text-foreground/80 flex shrink-0 items-center justify-center overflow-hidden rounded-sm font-medium",
        className
      )}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        scopeInitials(name)
      )}
    </span>
  );
}
