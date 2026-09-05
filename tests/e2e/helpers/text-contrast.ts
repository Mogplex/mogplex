import type { Locator } from "@playwright/test";

/** Resolve browser-supported colors and alpha against the rendered ancestors. */
export async function textContrast(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white";
    context.fillRect(0, 0, 1, 1);
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement)
      ancestors.unshift(node);
    for (const node of ancestors) {
      context.fillStyle = getComputedStyle(node).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const luminance = (values: Uint8ClampedArray) => {
      const rgb = Array.from(values)
        .slice(0, 3)
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const background = luminance(context.getImageData(0, 0, 1, 1).data);
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    const foreground = luminance(context.getImageData(0, 0, 1, 1).data);
    return (
      (Math.max(background, foreground) + 0.05) /
      (Math.min(background, foreground) + 0.05)
    );
  });
}
