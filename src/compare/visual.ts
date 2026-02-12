import type { PageCapture } from "../types/index.js";

/**
 * Visual comparison — simplified for localization pivot.
 * Only generates the diff image (pixelmatch). Finding generation
 * has moved to layout.ts (bounding-box based detection).
 */
export async function compareVisual(
  source: PageCapture,
  target: PageCapture
): Promise<{ diffImage: Buffer }> {
  const { default: pixelmatch } = await import("pixelmatch");
  const { PNG } = await import("pngjs");

  const sourcePng = PNG.sync.read(source.screenshot);
  const targetPng = PNG.sync.read(target.screenshot);

  const width = Math.max(sourcePng.width, targetPng.width);
  const height = Math.max(sourcePng.height, targetPng.height);

  const sourceData = padImage(sourcePng, width, height);
  const targetData = padImage(targetPng, width, height);
  const diffData = new Uint8Array(width * height * 4);

  pixelmatch(sourceData, targetData, diffData, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  const diffPng = new PNG({ width, height });
  diffPng.data = Buffer.from(diffData);
  const diffImage = PNG.sync.write(diffPng);

  return { diffImage };
}

function padImage(
  png: { width: number; height: number; data: Buffer },
  targetWidth: number,
  targetHeight: number
): Uint8Array {
  if (png.width === targetWidth && png.height === targetHeight) {
    return new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
  }

  const padded = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      padded[dstIdx] = png.data[srcIdx];
      padded[dstIdx + 1] = png.data[srcIdx + 1];
      padded[dstIdx + 2] = png.data[srcIdx + 2];
      padded[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return padded;
}
