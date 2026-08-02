import assert from "node:assert/strict";
import test from "node:test";
import { getMinimapSize } from "../../lib/flows/minimap-size";

test("getMinimapSize shrinks with the canvas height on short viewports", () => {
  const tall = getMinimapSize(1600, 800);
  const short = getMinimapSize(1600, 420);
  assert.ok(
    short.height < tall.height,
    `expected ${short.height} to be shorter than ${tall.height}`
  );
});

test("getMinimapSize keeps the 4:3 ratio React Flow's default assumes", () => {
  for (const [width, height] of [
    [1600, 900],
    [2400, 1400],
    [1280, 600],
  ]) {
    const size = getMinimapSize(width, height);
    assert.ok(
      Math.abs(size.width / size.height - 4 / 3) < 0.02,
      `${size.width}x${size.height} is not ~4:3`
    );
  }
});

test("getMinimapSize clamps to a legible minimum on tiny canvases", () => {
  const size = getMinimapSize(300, 120);
  assert.equal(size.width, 120);
  assert.equal(size.height, 90);
});

test("getMinimapSize caps growth so huge canvases do not get a huge minimap", () => {
  const size = getMinimapSize(6000, 4000);
  assert.equal(size.width, 220);
});

test("getMinimapSize falls back to the minimum before the canvas is measured", () => {
  assert.deepEqual(getMinimapSize(0, 0), { width: 120, height: 90 });
});

test("getMinimapSize returns whole pixels so the svg box does not straddle a subpixel", () => {
  const size = getMinimapSize(1437, 811);
  assert.equal(size.width, Math.round(size.width));
  assert.equal(size.height, Math.round(size.height));
});
