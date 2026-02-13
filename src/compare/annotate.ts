import type { BoundingBox, FindingCategory } from "../types/index.js";

interface AnnotatableFinding {
  category: FindingCategory;
  boundingBox?: BoundingBox;
}

// RGB colors by category (matching CSS vars in report)
const CATEGORY_COLORS: Record<FindingCategory, [number, number, number]> = {
  bleeding: [225, 29, 72],         // --cat-bleeding (#e11d48)
  formatting: [124, 58, 237],      // --cat-formatting (#7c3aed)
  functional: [8, 145, 178],       // --cat-functional (#0891b2)
  "source-issues": [217, 119, 6],  // --cat-source-issues (#d97706)
};

const BORDER_WIDTH = 3;
const FILL_ALPHA = 30; // 0-255, very low for transparency

export async function annotateScreenshot(
  screenshot: Buffer,
  findings: AnnotatableFinding[]
): Promise<Buffer> {
  const { PNG } = await import("pngjs");

  const png = PNG.sync.read(screenshot);
  const { width, height, data } = png;

  for (const finding of findings) {
    if (!finding.boundingBox) continue;

    const box = finding.boundingBox;
    const [r, g, b] = CATEGORY_COLORS[finding.category] || [255, 0, 0];

    // Clamp box coordinates to image bounds
    const x1 = Math.max(0, Math.round(box.x));
    const y1 = Math.max(0, Math.round(box.y));
    const x2 = Math.min(width, Math.round(box.x + box.width));
    const y2 = Math.min(height, Math.round(box.y + box.height));

    if (x2 <= x1 || y2 <= y1) continue;

    // Draw semi-transparent fill
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = (y * width + x) * 4;
        // Alpha blend: result = src * alpha + dst * (1 - alpha)
        const a = FILL_ALPHA / 255;
        data[idx] = Math.round(r * a + data[idx] * (1 - a));
        data[idx + 1] = Math.round(g * a + data[idx + 1] * (1 - a));
        data[idx + 2] = Math.round(b * a + data[idx + 2] * (1 - a));
      }
    }

    // Draw border (opaque)
    drawRect(data, width, height, x1, y1, x2, y2, r, g, b, BORDER_WIDTH);
  }

  return PNG.sync.write(png);
}

function drawRect(
  data: Buffer,
  imgWidth: number,
  imgHeight: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number,
  lineWidth: number
): void {
  // Top edge
  fillRegion(data, imgWidth, imgHeight, x1, y1, x2, Math.min(y1 + lineWidth, y2), r, g, b);
  // Bottom edge
  fillRegion(data, imgWidth, imgHeight, x1, Math.max(y2 - lineWidth, y1), x2, y2, r, g, b);
  // Left edge
  fillRegion(data, imgWidth, imgHeight, x1, y1, Math.min(x1 + lineWidth, x2), y2, r, g, b);
  // Right edge
  fillRegion(data, imgWidth, imgHeight, Math.max(x2 - lineWidth, x1), y1, x2, y2, r, g, b);
}

function fillRegion(
  data: Buffer,
  imgWidth: number,
  imgHeight: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number
): void {
  for (let y = y1; y < y2 && y < imgHeight; y++) {
    for (let x = x1; x < x2 && x < imgWidth; x++) {
      const idx = (y * imgWidth + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
}
