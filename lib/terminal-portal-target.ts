type AnchorLike = Pick<HTMLElement, "isConnected"> | null;

function isConnectedAnchor(
  anchor: AnchorLike
): anchor is NonNullable<AnchorLike> {
  return Boolean(anchor?.isConnected);
}

export function resolveTerminalPortalTarget<T extends AnchorLike>(input: {
  anchor: T;
  lastAnchor: T;
  fallback: T;
}) {
  if (isConnectedAnchor(input.anchor)) {
    return input.anchor;
  }

  if (isConnectedAnchor(input.lastAnchor)) {
    return input.lastAnchor;
  }

  return input.fallback;
}
