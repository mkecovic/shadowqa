import { chromium, type Browser, type Page } from "playwright";
import type {
  PageCapture,
  DOMNode,
  ComputedStyleInfo,
  AxeResults,
  TextNode,
} from "../types/index.js";

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function capturePage(
  url: string,
  viewport?: { width: number; height: number }
): Promise<PageCapture> {
  const resolvedViewport = viewport || DEFAULT_VIEWPORT;
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: resolvedViewport });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Scroll through the page to trigger lazy-loaded images, then scroll back
    // Cap scroll time to 15s for very tall pages
    await Promise.race([
      page.evaluate(`(async () => {
        var step = window.innerHeight;
        var maxScroll = Math.min(document.body.scrollHeight, step * 20);
        for (var y = 0; y < maxScroll; y += step) {
          window.scrollTo(0, y);
          await new Promise(function(r) { setTimeout(r, 100); });
        }
        window.scrollTo(0, 0);
      })()`),
      new Promise((resolve) => setTimeout(resolve, 15000)),
    ]);

    // Wait for images to finish loading (5s timeout to avoid infinite hang)
    await Promise.race([
      page.evaluate(`Promise.all(
        Array.from(document.images)
          .filter(function(img) { return !img.complete; })
          .map(function(img) {
            return new Promise(function(resolve) {
              img.addEventListener('load', resolve);
              img.addEventListener('error', resolve);
            });
          })
      )`),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);

    await page.waitForTimeout(500);

    const [screenshot, dom, styles, accessibility, textNodes, lang] = await Promise.all([
      captureScreenshot(page),
      captureDOM(page),
      captureStyles(page),
      captureAccessibility(page),
      captureTextNodes(page),
      page.evaluate(`document.documentElement.lang || ''`) as Promise<string>,
    ]);

    return {
      url,
      lang,
      screenshot,
      dom,
      styles,
      accessibility,
      textNodes,
      timestamp: new Date().toISOString(),
      viewport: resolvedViewport,
    };
  } finally {
    await context.close();
  }
}

async function captureScreenshot(page: Page): Promise<Buffer> {
  return (await page.screenshot({ fullPage: true, type: "png" })) as Buffer;
}

// Use string-based evaluate to prevent tsx/esbuild from injecting __name helper
const CAPTURE_DOM_SCRIPT = `(() => {
  var getSelector = function(el) {
    if (el.id) return '#' + el.id;
    var tag = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (!parent) return tag;
    var siblings = Array.from(parent.children).filter(function(c) {
      return c.tagName === el.tagName;
    });
    if (siblings.length === 1) return getSelector(parent) + ' > ' + tag;
    var index = siblings.indexOf(el) + 1;
    return getSelector(parent) + ' > ' + tag + ':nth-child(' + index + ')';
  };

  var isVisible = function(el) {
    var style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  };

  var getDirectText = function(el) {
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) {
        text += el.childNodes[i].textContent;
      }
    }
    return text.trim().slice(0, 200);
  };

  var serializeNode = function(el, depth) {
    if (depth > 15) return null;
    var tag = el.tagName.toLowerCase();
    if (['script', 'noscript', 'style', 'link', 'meta'].indexOf(tag) !== -1)
      return null;

    var rect = el.getBoundingClientRect();
    var attributes = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      if (attr.name.indexOf('data-reactid') === 0 || attr.name.indexOf('data-gtm') === 0)
        continue;
      attributes[attr.name] = attr.value;
    }

    var children = [];
    for (var j = 0; j < el.children.length; j++) {
      var serialized = serializeNode(el.children[j], depth + 1);
      if (serialized) children.push(serialized);
    }

    var isClipped = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;

    return {
      tag: tag,
      attributes: attributes,
      selector: getSelector(el),
      children: children,
      textContent: (el.textContent || '').trim().slice(0, 200),
      directText: getDirectText(el),
      visible: isVisible(el),
      boundingBox:
        rect.width > 0 && rect.height > 0
          ? {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null,
      isClipped: isClipped,
    };
  };

  var body = document.body;
  if (!body) return [];
  var root = serializeNode(body, 0);
  return root ? [root] : [];
})()`;

const CAPTURE_STYLES_SCRIPT = `(() => {
  var importantProps = [
    'display', 'visibility', 'opacity', 'position', 'z-index',
    'color', 'background-color', 'font-size', 'font-weight',
    'width', 'height', 'margin', 'padding', 'border', 'overflow'
  ];

  var getSelector = function(el) {
    if (el.id) return '#' + el.id;
    var tag = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (!parent) return tag;
    var siblings = Array.from(parent.children).filter(function(c) {
      return c.tagName === el.tagName;
    });
    if (siblings.length === 1) return getSelector(parent) + ' > ' + tag;
    var index = siblings.indexOf(el) + 1;
    return getSelector(parent) + ' > ' + tag + ':nth-child(' + index + ')';
  };

  var results = [];
  var elements = document.querySelectorAll(
    'a, button, input, select, textarea, img, h1, h2, h3, h4, h5, h6, nav, main, header, footer, [role]'
  );

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var computed = window.getComputedStyle(el);
    var styles = {};
    for (var j = 0; j < importantProps.length; j++) {
      styles[importantProps[j]] = computed.getPropertyValue(importantProps[j]);
    }
    results.push({ selector: getSelector(el), styles: styles });
  }
  return results;
})()`;

const CAPTURE_A11Y_SCRIPT = `(async () => {
  var axe = window.axe;
  var result = await axe.run();
  return {
    violations: result.violations.map(function(v) {
      return {
        id: v.id,
        impact: v.impact || 'minor',
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map(function(n) {
          return {
            target: n.target,
            html: n.html,
            failureSummary: n.failureSummary || ''
          };
        })
      };
    }),
    passes: result.passes.map(function(p) {
      return {
        id: p.id,
        nodes: p.nodes.map(function(n) {
          return {
            target: n.target,
            html: n.html,
            failureSummary: ''
          };
        })
      };
    })
  };
})()`;

const CAPTURE_TEXT_NODES_SCRIPT = `(() => {
  var getSelector = function(el) {
    if (el.id) return '#' + el.id;
    var tag = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (!parent) return tag;
    var siblings = Array.from(parent.children).filter(function(c) {
      return c.tagName === el.tagName;
    });
    if (siblings.length === 1) return getSelector(parent) + ' > ' + tag;
    var index = siblings.indexOf(el) + 1;
    return getSelector(parent) + ' > ' + tag + ':nth-child(' + index + ')';
  };

  var isVisible = function(el) {
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  var skipTags = ['script', 'noscript', 'style', 'link', 'meta', 'br', 'hr'];
  var results = [];

  var walk = function(el) {
    var tag = el.tagName.toLowerCase();
    if (skipTags.indexOf(tag) !== -1) return;

    // Get direct text (text from immediate TEXT_NODE children only)
    var directText = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) {
        directText += el.childNodes[i].textContent;
      }
    }
    directText = directText.trim();

    if (directText.length > 0 && isVisible(el)) {
      var rect = el.getBoundingClientRect();
      var isLeaf = el.children.length === 0;
      results.push({
        selector: getSelector(el),
        tag: tag,
        text: directText.slice(0, 500),
        visible: true,
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        isLeaf: isLeaf,
      });
    }

    for (var j = 0; j < el.children.length; j++) {
      walk(el.children[j]);
    }
  };

  if (document.body) walk(document.body);
  return results;
})()`;

async function captureDOM(page: Page): Promise<DOMNode[]> {
  return page.evaluate(CAPTURE_DOM_SCRIPT) as Promise<DOMNode[]>;
}

async function captureStyles(page: Page): Promise<ComputedStyleInfo[]> {
  return page.evaluate(CAPTURE_STYLES_SCRIPT) as Promise<ComputedStyleInfo[]>;
}

async function captureAccessibility(page: Page): Promise<AxeResults> {
  const emptyResults: AxeResults = { violations: [], passes: [] };
  try {
    const axeSource = require("axe-core").source;
    await page.evaluate(axeSource);
    const result = await Promise.race([
      page.evaluate(CAPTURE_A11Y_SCRIPT) as Promise<AxeResults>,
      new Promise<AxeResults>((resolve) => setTimeout(() => resolve(emptyResults), 30000)),
    ]);
    return result;
  } catch {
    return emptyResults;
  }
}

async function captureTextNodes(page: Page): Promise<TextNode[]> {
  return page.evaluate(CAPTURE_TEXT_NODES_SCRIPT) as Promise<TextNode[]>;
}
