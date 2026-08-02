import assert from "node:assert/strict";
import test from "node:test";
import { Position } from "@xyflow/react";

import {
  cubicBezierPoint,
  getOrganicEdgePath,
} from "@/lib/flows/organic-edge-path";

function assertNear(
  actual: number,
  expected: number,
  message: string,
  tolerance = 0.000001
) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${message}: expected ${expected} ± ${tolerance} but got ${actual}`
  );
}

function parsePathNumbers(path: string) {
  return [...path.matchAll(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)].map(
    (match) => Number(match[0])
  );
}

function parseOrganicPath(path: string) {
  const numbers = parsePathNumbers(path);

  assert.equal(
    numbers.length,
    8,
    `expected exactly 8 coordinates in organic path, got ${numbers.length}: ${path}`
  );

  return {
    sourceX: numbers[0],
    sourceY: numbers[1],
    sourceControlX: numbers[2],
    sourceControlY: numbers[3],
    targetControlX: numbers[4],
    targetControlY: numbers[5],
    targetX: numbers[6],
    targetY: numbers[7],
  };
}

test("cubicBezierPoint returns the midpoint on a symmetric cubic", () => {
  const [x, y] = cubicBezierPoint(0, 0, 0, 100, 100, 100, 100, 0, 0.5);

  assertNear(x, 50, "midpoint x");
  assertNear(y, 75, "midpoint y");
});

test("cubicBezierPoint returns source and target at progress boundaries", () => {
  const [sourceX, sourceY] = cubicBezierPoint(
    0,
    0,
    0,
    100,
    100,
    100,
    100,
    0,
    0
  );
  const [targetX, targetY] = cubicBezierPoint(
    0,
    0,
    0,
    100,
    100,
    100,
    100,
    0,
    1
  );

  assertNear(sourceX, 0, "source boundary x");
  assertNear(sourceY, 0, "source boundary y");
  assertNear(targetX, 100, "target boundary x");
  assertNear(targetY, 0, "target boundary y");
});

test("parsePathNumbers reads decimal and exponent path values", () => {
  assert.deepEqual(
    parsePathNumbers("M 1e-3,-2.5e+2 C .5,0 10,20 30,40"),
    [0.001, -250, 0.5, 0, 10, 20, 30, 40]
  );
});

test("getOrganicEdgePath handles overlapping endpoints without invalid numbers", () => {
  const [path, labelX, labelY] = getOrganicEdgePath({
    sourceX: 100,
    sourceY: 100,
    targetX: 100,
    targetY: 100,
  });
  const controls = parseOrganicPath(path);
  const [expectedLabelX, expectedLabelY] = cubicBezierPoint(
    controls.sourceX,
    controls.sourceY,
    controls.sourceControlX,
    controls.sourceControlY,
    controls.targetControlX,
    controls.targetControlY,
    controls.targetX,
    controls.targetY,
    0.5
  );

  assert.equal(controls.sourceX, 100);
  assert.equal(controls.sourceY, 100);
  assert.equal(controls.targetX, 100);
  assert.equal(controls.targetY, 100);
  assert.ok(Object.values(controls).every(Number.isFinite));
  assertNear(labelX, expectedLabelX, "labelX");
  assertNear(labelY, expectedLabelY, "labelY");
});

test("getOrganicEdgePath uses each handle direction for control points", () => {
  const cases = [
    {
      name: "right to left",
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      assertControls: (path: ReturnType<typeof parseOrganicPath>) => {
        assert.ok(path.sourceControlX > path.sourceX);
        assert.ok(path.targetControlX < path.targetX);
      },
    },
    {
      name: "left to right",
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      assertControls: (path: ReturnType<typeof parseOrganicPath>) => {
        assert.ok(path.sourceControlX < path.sourceX);
        assert.ok(path.targetControlX > path.targetX);
      },
    },
    {
      name: "top to bottom",
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
      assertControls: (path: ReturnType<typeof parseOrganicPath>) => {
        assert.ok(path.sourceControlY < path.sourceY);
        assert.ok(path.targetControlY > path.targetY);
      },
    },
    {
      name: "bottom to top",
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      assertControls: (path: ReturnType<typeof parseOrganicPath>) => {
        assert.ok(path.sourceControlY > path.sourceY);
        assert.ok(path.targetControlY < path.targetY);
      },
    },
  ];

  for (const entry of cases) {
    const [path] = getOrganicEdgePath({
      sourceX: 0,
      sourceY: 0,
      sourcePosition: entry.sourcePosition,
      targetX: 200,
      targetY: 120,
      targetPosition: entry.targetPosition,
    });

    entry.assertControls(parseOrganicPath(path));
  }
});

test("getOrganicEdgePath clamps bend radii for extreme coordinates", () => {
  const [path] = getOrganicEdgePath({
    sourceX: 0,
    sourceY: 0,
    sourcePosition: Position.Right,
    targetX: 10_000,
    targetY: 10_000,
    targetPosition: Position.Left,
  });
  const controls = parseOrganicPath(path);
  const maxSourceBend = 420;
  const maxTargetBend = 360;
  const maxVerticalDrift = 130;
  const maxHorizontalDrift = 72;

  assertNear(
    controls.sourceControlX,
    maxSourceBend + maxHorizontalDrift,
    "sourceControlX uses clamped source bend and horizontal drift",
    0.01
  );
  assertNear(
    controls.sourceControlY,
    maxVerticalDrift * 0.28,
    "sourceControlY uses clamped vertical drift",
    0.01
  );
  assertNear(
    controls.targetControlX,
    10_000 - maxTargetBend - maxHorizontalDrift * 0.42,
    "targetControlX uses clamped target bend and horizontal drift",
    0.01
  );
  assertNear(
    controls.targetControlY,
    10_000 - maxVerticalDrift * 0.22,
    "targetControlY uses clamped vertical drift",
    0.01
  );
});

test("getOrganicEdgePath falls back to finite coordinates for invalid layout values", () => {
  const [path, labelX, labelY] = getOrganicEdgePath({
    sourceX: Number.NaN,
    sourceY: 42,
    sourcePosition: Position.Right,
    targetX: Number.POSITIVE_INFINITY,
    targetY: 84,
    targetPosition: Position.Left,
  });
  const controls = parseOrganicPath(path);

  assert.equal(path.includes("NaN"), false);
  assert.equal(path.includes("Infinity"), false);
  assert.ok(Object.values(controls).every(Number.isFinite));
  assert.equal(controls.sourceX, 0);
  assert.equal(controls.sourceY, 42);
  assert.equal(controls.targetX, 0);
  assert.equal(controls.targetY, 42);
  assert.equal(labelX, 0);
  assert.equal(labelY, 42);
});

test("getOrganicEdgePath snaps to source when target layout is partially invalid", () => {
  const [path, labelX, labelY] = getOrganicEdgePath({
    sourceX: 10,
    sourceY: 20,
    sourcePosition: Position.Right,
    targetX: Number.POSITIVE_INFINITY,
    targetY: 50,
    targetPosition: Position.Left,
  });
  const controls = parseOrganicPath(path);

  assert.equal(path.includes("NaN"), false);
  assert.equal(path.includes("Infinity"), false);
  assert.equal(controls.sourceX, 10);
  assert.equal(controls.sourceY, 20);
  assert.equal(controls.targetX, 10);
  assert.equal(controls.targetY, 20);
  assert.equal(labelX, 10);
  assert.equal(labelY, 20);
});

test("getOrganicEdgePath keeps partial fallback axes on one endpoint", () => {
  const [path, labelX, labelY] = getOrganicEdgePath({
    sourceX: 12,
    sourceY: Number.NaN,
    sourcePosition: Position.Right,
    targetX: Number.POSITIVE_INFINITY,
    targetY: 144,
    targetPosition: Position.Left,
  });
  const controls = parseOrganicPath(path);

  assert.equal(path.includes("NaN"), false);
  assert.equal(path.includes("Infinity"), false);
  assert.equal(controls.sourceX, 12);
  assert.equal(controls.sourceY, 144);
  assert.equal(controls.targetX, 12);
  assert.equal(controls.targetY, 144);
  assert.equal(labelX, 12);
  assert.equal(labelY, 144);
});
