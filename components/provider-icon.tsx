"use client";

import { useState } from "react";
import {
  getProviderIconUrl,
  getProviderInitial,
} from "@/lib/models/provider-icon";
import { useProviderIconAvailability } from "@/hooks/use-provider-icons";
import { cn } from "@/lib/utils";

type ProviderIconProps = {
  provider: string;
  className?: string;
  testId?: string;
};

function ProviderInitial({ provider }: { provider: string }) {
  return (
    <span
      aria-hidden="true"
      className="text-[10px] font-semibold text-foreground"
    >
      {getProviderInitial(provider)}
    </span>
  );
}

function ProviderImage({ provider, src }: { provider: string; src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) return <ProviderInitial provider={provider} />;

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className="size-full object-contain"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

export function ProviderIcon({
  provider,
  className,
  testId,
}: ProviderIconProps) {
  const { available, loading } = useProviderIconAvailability(provider);
  const iconUrl = available ? getProviderIconUrl(provider) : null;

  return (
    <span
      data-testid={testId}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-background",
        className
      )}
    >
      {loading ? null : iconUrl ? (
        <ProviderImage key={iconUrl} provider={provider} src={iconUrl} />
      ) : (
        <ProviderInitial provider={provider} />
      )}
    </span>
  );
}
