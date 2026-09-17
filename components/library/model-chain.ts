import { ACCOUNT_FALLBACK_MODEL_MAX_COUNT } from "@/lib/models/fallback-limits";

export type ModelChain = { primary: string; fallbacks: string[] };

export function chainIncludes(chain: ModelChain, id: string) {
  return chain.primary === id || chain.fallbacks.includes(id);
}

export function setChainPrimary(
  chain: ModelChain,
  primary: string
): ModelChain {
  return { primary, fallbacks: chain.fallbacks.filter((id) => id !== primary) };
}

export function addFallback(chain: ModelChain, id: string): ModelChain {
  if (
    chainIncludes(chain, id) ||
    chain.fallbacks.length >= ACCOUNT_FALLBACK_MODEL_MAX_COUNT
  )
    return chain;
  return { ...chain, fallbacks: [...chain.fallbacks, id] };
}

export function replaceFallback(
  chain: ModelChain,
  index: number,
  id: string
): ModelChain {
  if (chainIncludes(chain, id)) return chain;
  return {
    ...chain,
    fallbacks: chain.fallbacks.map((current, at) =>
      at === index ? id : current
    ),
  };
}

export function moveFallback(
  chain: ModelChain,
  index: number,
  direction: -1 | 1
): ModelChain {
  const target = index + direction;
  if (
    index < 0 ||
    index >= chain.fallbacks.length ||
    target < 0 ||
    target >= chain.fallbacks.length
  )
    return chain;
  const fallbacks = [...chain.fallbacks];
  [fallbacks[index], fallbacks[target]] = [fallbacks[target], fallbacks[index]];
  return { ...chain, fallbacks };
}

export function removeFallback(chain: ModelChain, index: number): ModelChain {
  return {
    ...chain,
    fallbacks: chain.fallbacks.filter((_, at) => at !== index),
  };
}

export function chainsEqual(left: ModelChain, right: ModelChain) {
  return (
    left.primary === right.primary &&
    left.fallbacks.length === right.fallbacks.length &&
    left.fallbacks.every((id, index) => id === right.fallbacks[index])
  );
}
