export type FindingCategory =
  | "bleeding"
  | "formatting"
  | "functional"
  | "source-issues";

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: "critical" | "major" | "normal" | "minor" | "trivial";
  confidence: number;
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  element: {
    selector: string;
    tag: string;
  };
  source: string;
  target: string;
  boundingBox?: BoundingBox;
}

export interface DOMNode {
  tag: string;
  attributes: Record<string, string>;
  selector: string;
  children: DOMNode[];
  textContent: string;
  directText: string;
  visible: boolean;
  boundingBox: BoundingBox | null;
  isClipped: boolean;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextNode {
  selector: string;
  tag: string;
  text: string;
  visible: boolean;
  boundingBox: BoundingBox | null;
  isLeaf: boolean;
}

export interface ComputedStyleInfo {
  selector: string;
  styles: Record<string, string>;
}

export interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

export interface AxeNode {
  target: string[];
  html: string;
  failureSummary: string;
}

export interface AxeResults {
  violations: AxeViolation[];
  passes: { id: string; nodes: AxeNode[] }[];
}

export interface PageCapture {
  url: string;
  lang: string;
  screenshot: Buffer;
  dom: DOMNode[];
  styles: ComputedStyleInfo[];
  accessibility: AxeResults;
  textNodes: TextNode[];
  timestamp: string;
  viewport: { width: number; height: number };
}

export interface ComparisonReport {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  sourceLocale?: string;
  targetLocale?: string;
  viewport: { width: number; height: number };
  timestamp: string;
  summary: {
    critical: number;
    major: number;
    normal: number;
    minor: number;
    trivial: number;
    total: number;
  };
  findings: Finding[];
  // Screenshots are saved as separate files: ${id}-{source,target,diff,annotated}.png
  // and served at /report-assets/${id}-{type}.png
}

export interface CompareRequest {
  sourceUrl: string;
  targetUrl: string;
  viewport?: { width: number; height: number };
}

export interface RawFinding {
  category: FindingCategory;
  title: string;
  description: string;
  element: Finding["element"];
  source: string;
  target: string;
  boundingBox?: BoundingBox;
  metadata?: Record<string, unknown>;
}
