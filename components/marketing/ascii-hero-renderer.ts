// ASCII hero layout and rendering utilities.
// Extracted from ascii-hero.tsx for module size compliance.

import { ALIEN_MASK, MOGPLEX_SWIRL_TEXT } from "./mogplex-ascii";

export const SWIRL_ROWS = MOGPLEX_SWIRL_TEXT.split("\n").map((r) =>
  r.replace(/\t/g, "    ")
);

export const STATIC_ALIEN = ALIEN_MASK.map((row) =>
  row.replaceAll(".", " ").replaceAll("X", "@")
).join("\n");

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export type AlienPlacement = {
  rowStart: number;
  colStart: number;
  rows: number;
  cols: number;
};

// Vertical bias for the alien within the hero canvas. The headline lives
// below the canvas in the DOM, so we keep the alien in the upper-middle
// band rather than dead-center to leave breathing room beneath it.
const ALIEN_ROW_BIAS = 0.18;
// Share of grid height the alien is allowed to occupy. Tuned so the alien
// reads as a poster element without dominating tall viewports.
const ALIEN_ROW_BUDGET = 0.62;
const ALIEN_COL_BUDGET = 0.58;

// Dense fill chars substituted when the text sample is a space — keeps the
// silhouette solid without washing out the readable content. Wider palette,
// heavier on mid-density glyphs so the body reads as fabric, not confetti.
const FILL_CHARS = "▒░▒·▓·▒░·▒▓░";

// Sample the charset as a straight scrolling wall of text. Each grid row
// maps to one charset line; a slow vertical offset ticks the whole block up
// over time, and a gentle horizontal drift keeps cells from locking into a
// pattern. No rotation.
function sampleStraightChar(
  row: number,
  col: number,
  timeOffset: number
): string {
  const charsetRowCount = SWIRL_ROWS.length;
  const rowIdx =
    (((row + Math.floor(timeOffset)) % charsetRowCount) + charsetRowCount) %
    charsetRowCount;
  const charsetRow = SWIRL_ROWS[rowIdx];
  const maxCol = charsetRow.length;
  if (maxCol === 0) return " ";
  const colIdx =
    (((col + Math.floor(timeOffset * 0.4)) % maxCol) + maxCol) % maxCol;
  return charsetRow[colIdx] ?? " ";
}

// Map (col, row) in the character grid to the native alien mask; return true
// if that grid cell lands on a solid pixel. Grid coverage is ~90% vertical
// with the alien's native 11x8 aspect preserved (11/8 = 1.375 wide).
function isInsideAlien(
  col: number,
  row: number,
  placement: AlienPlacement
): boolean {
  const relRow = row - placement.rowStart;
  const relCol = col - placement.colStart;
  if (relRow < 0 || relRow >= placement.rows) return false;
  if (relCol < 0 || relCol >= placement.cols) return false;
  const maskRow = Math.floor((relRow / placement.rows) * ALIEN_MASK.length);
  const maskCol = Math.floor((relCol / placement.cols) * ALIEN_MASK[0].length);
  const row0 = ALIEN_MASK[maskRow] ?? "";
  return row0[maskCol] === "X";
}

function buildRowLines(
  row: number,
  cols: number,
  timeOffset: number,
  placement: AlienPlacement
): { alienLine: string; alienStartCol: number } {
  let alienLine = "";
  let alienStartCol = -1;
  let trailingSpaces = 0;

  for (let col = 0; col < cols; col++) {
    if (!isInsideAlien(col, row, placement)) {
      if (alienStartCol >= 0) trailingSpaces += 1;
      continue;
    }
    let ch = sampleStraightChar(row, col, timeOffset);
    if (ch === " ") {
      const idx = (row * 31 + col * 17) % FILL_CHARS.length;
      ch = FILL_CHARS[(idx + FILL_CHARS.length) % FILL_CHARS.length];
    }
    if (alienStartCol < 0) alienStartCol = col;
    if (trailingSpaces > 0) {
      alienLine += " ".repeat(trailingSpaces);
      trailingSpaces = 0;
    }
    alienLine += ch;
  }

  return { alienLine, alienStartCol };
}

// Size the alien silhouette to occupy a comfortable share of the canvas
// without crowding the headline that sits below it in the DOM. The native
// 11x8 mask aspect is preserved by accounting for the character cell being
// taller than wide.
function computeLayout(
  gridCols: number,
  gridRows: number,
  charAspect: number
): { alien: AlienPlacement } {
  const maskCols = ALIEN_MASK[0].length;
  const maskRows = ALIEN_MASK.length;
  const ratio = (maskCols / maskRows) * charAspect;

  const budgetCols = Math.floor(gridCols * ALIEN_COL_BUDGET);
  const budgetRows = Math.max(
    maskRows,
    Math.floor(gridRows * ALIEN_ROW_BUDGET)
  );

  let alienCols = Math.floor(budgetRows * ratio);
  let alienRows = budgetRows;
  if (alienCols > budgetCols) {
    alienCols = budgetCols;
    alienRows = Math.max(maskRows, Math.floor(alienCols / ratio));
  }

  const rowStart = Math.max(1, Math.floor(gridRows * ALIEN_ROW_BIAS));

  return {
    alien: {
      rowStart,
      colStart: Math.max(0, Math.floor((gridCols - alienCols) / 2)),
      rows: alienRows,
      cols: alienCols,
    },
  };
}

// Paint a single frame of the ASCII scene to the offscreen 2D canvas.
// (cssW,cssH) are CSS pixels; dpr scales the actual backing store.
export function drawAsciiFrame(
  canvas: HTMLCanvasElement,
  dpr: number,
  cssW: number,
  cssH: number,
  elapsed: number,
  backgroundColor: string,
  foregroundColor: string
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Slow vertical tick of the text — one line every ~2 seconds.
  const timeOffset = elapsed * 0.0005;
  const fadeIn = easeOutCubic(clamp(elapsed * 0.0008, 0, 1));

  const w = cssW * dpr;
  const h = cssH * dpr;
  // Avoid the implicit context-state reset that `canvas.width = ...` triggers
  // unless the backing store actually needs to change size.
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, w, h);

  const rowsInCharset = SWIRL_ROWS.length;
  const rawRowHeight = Math.floor(h / rowsInCharset);
  const fontSize = Math.max(1, Math.round(rawRowHeight * 1.3));
  const yOffset = Math.round((h - rowsInCharset * fontSize) / 2);

  const fontStack = `${fontSize}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
  ctx.font = fontStack;
  ctx.textBaseline = "top";
  const charWidth = ctx.measureText("M").width;
  const cols = Math.floor(w / charWidth);
  const charAspect = fontSize / charWidth;

  const { alien } = computeLayout(cols, rowsInCharset, charAspect);

  ctx.fillStyle = foregroundColor;
  ctx.globalAlpha = fadeIn;
  ctx.font = `bold ${fontStack}`;

  for (let row = 0; row < rowsInCharset; row++) {
    const { alienLine, alienStartCol } = buildRowLines(
      row,
      cols,
      timeOffset,
      alien
    );
    if (alienStartCol < 0) continue;
    const y = yOffset + row * fontSize;
    ctx.fillText(alienLine, alienStartCol * charWidth, y);
  }
  ctx.globalAlpha = 1;
}
