import { scopeInitials } from "@/lib/scope-initials";
import { cn } from "@/lib/utils";

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
