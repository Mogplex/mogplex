import { Position } from "@xyflow/react";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function positionVector(position: Position | undefined, fallback: Position) {
  switch (position ?? fallback) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Right:
    default:
      return { x: 1, y: 0 };
  }
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function fallbackPoint({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}) {
  const sourceXIsFinite = Number.isFinite(sourceX);
  const sourceYIsFinite = Number.isFinite(sourceY);
  const targetXIsFinite = Number.isFinite(targetX);
  const targetYIsFinite = Number.isFinite(targetY);

  if (sourceXIsFinite && sourceYIsFinite) {
    // "Settled" means both source axes are finite. Partial source or target
    // coordinates fall through to the per-axis fallback below.
    return { x: sourceX, y: sourceY };
  }

  if (targetXIsFinite && targetYIsFinite) {
    return { x: targetX, y: targetY };
  }

  // Preserve the best finite coordinate for each axis; if an axis has no
  // finite value on either endpoint, pin only that axis to zero.
  return {
    x: finiteOr(sourceX, finiteOr(targetX, 0)),
    y: finiteOr(sourceY, finiteOr(targetY, 0)),
  };
}

export function cubicBezierPoint(
  sourceX: number,
  sourceY: number,
  sourceControlX: number,
  sourceControlY: number,
  targetControlX: number,
  targetControlY: number,
  targetX: number,
  targetY: number,
  progress: number
) {
  const inverse = 1 - progress;
  const sourceWeight = inverse ** 3;
  const sourceControlWeight = 3 * inverse ** 2 * progress;
  const targetControlWeight = 3 * inverse * progress ** 2;
  const targetWeight = progress ** 3;

  return [
    sourceWeight * sourceX +
      sourceControlWeight * sourceControlX +
      targetControlWeight * targetControlX +
      targetWeight * targetX,
    sourceWeight * sourceY +
      sourceControlWeight * sourceControlY +
      targetControlWeight * targetControlY +
      targetWeight * targetY,
  ] as const;
}

export function getOrganicEdgePath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition?: Position;
  targetX: number;
  targetY: number;
  targetPosition?: Position;
}): readonly [string, number, number] {
  if (
    !Number.isFinite(sourceX) ||
    !Number.isFinite(sourceY) ||
    !Number.isFinite(targetX) ||
    !Number.isFinite(targetY)
  ) {
    const fallback = fallbackPoint({ sourceX, sourceY, targetX, targetY });

    return [
      `M ${fallback.x},${fallback.y} C ${fallback.x},${fallback.y} ${fallback.x},${fallback.y} ${fallback.x},${fallback.y}`,
      fallback.x,
      fallback.y,
    ] as const;
  }

  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const distance = Math.hypot(deltaX, deltaY);
  const horizontalSpan = Math.abs(deltaX);
  const verticalSpan = Math.abs(deltaY);
  const sourceDirection = positionVector(sourcePosition, Position.Right);
  const targetDirection = positionVector(targetPosition, Position.Left);
  // These bend and drift factors are tuned for the visual feel of flow links.
  const sourceBend = clamp(distance * 0.38 + verticalSpan * 0.18, 96, 420);
  const targetBend = clamp(distance * 0.3 + horizontalSpan * 0.08, 88, 360);
  // Perfectly horizontal links drift downward instead of rendering flat.
  const verticalDrift =
    Math.sign(deltaY || 1) * clamp(distance * 0.13, 18, 130);
  // Perfectly vertical links drift rightward instead of rendering flat.
  const horizontalDrift =
    Math.sign(deltaX || 1) * clamp(verticalSpan * 0.08, 0, 72);
  const sourceControlX =
    sourceX + sourceDirection.x * sourceBend + horizontalDrift;
  const sourceControlY =
    sourceY + sourceDirection.y * sourceBend + verticalDrift * 0.28;
  const targetControlX =
    targetX + targetDirection.x * targetBend - horizontalDrift * 0.42;
  const targetControlY =
    targetY + targetDirection.y * targetBend - verticalDrift * 0.22;
  const [labelX, labelY] = cubicBezierPoint(
    sourceX,
    sourceY,
    sourceControlX,
    sourceControlY,
    targetControlX,
    targetControlY,
    targetX,
    targetY,
    0.5
  );

  return [
    `M ${sourceX},${sourceY} C ${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
    labelX,
    labelY,
  ] as const;
}
