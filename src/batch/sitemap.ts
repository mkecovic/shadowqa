import { XMLParser } from "fast-xml-parser";

export interface SitemapEntry {
  loc: string;
  alternates: { hreflang: string; href: string }[];
}

export interface DiscoveredPair {
  sourceUrl: string;
  targetUrl: string;
  sourceLocale: string;
  targetLocale: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) =>
    ["url", "sitemap", "xhtml:link"].includes(name),
});

async function fetchXml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "ShadowQA/1.0 Sitemap Crawler" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export async function parseSitemap(url: string): Promise<SitemapEntry[]> {
  const xml = await fetchXml(url);
  const parsed = parser.parse(xml);

  // Handle sitemap index (recursive)
  if (parsed.sitemapindex?.sitemap) {
    const sitemaps = parsed.sitemapindex.sitemap as any[];
    const entries: SitemapEntry[] = [];
    for (const sm of sitemaps) {
      const loc = sm.loc;
      if (loc) {
        try {
          const sub = await parseSitemap(loc);
          entries.push(...sub);
        } catch (err) {
          console.error(`Failed to parse sub-sitemap ${loc}:`, err);
        }
      }
    }
    return entries;
  }

  // Handle regular sitemap
  if (parsed.urlset?.url) {
    const urls = parsed.urlset.url as any[];
    return urls.map((u) => {
      const entry: SitemapEntry = {
        loc: u.loc || "",
        alternates: [],
      };

      // Parse xhtml:link alternate entries
      const links = u["xhtml:link"];
      if (links && Array.isArray(links)) {
        for (const link of links) {
          const rel = link["@_rel"];
          const hreflang = link["@_hreflang"];
          const href = link["@_href"];
          if (rel === "alternate" && hreflang && href) {
            entry.alternates.push({ hreflang, href });
          }
        }
      }

      return entry;
    });
  }

  return [];
}

export function discoverByHreflang(
  entries: SitemapEntry[],
  sourceLocale: string,
  targetLocale: string
): DiscoveredPair[] {
  const pairs: DiscoveredPair[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.alternates.length === 0) continue;

    // Find source and target alternates
    const sourceAlt = entry.alternates.find(
      (a) => a.hreflang === sourceLocale || a.hreflang.startsWith(sourceLocale + "-")
    );
    const targetAlt = entry.alternates.find(
      (a) => a.hreflang === targetLocale || a.hreflang.startsWith(targetLocale + "-")
    );

    if (sourceAlt && targetAlt) {
      const key = `${sourceAlt.href}|${targetAlt.href}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({
          sourceUrl: sourceAlt.href,
          targetUrl: targetAlt.href,
          sourceLocale,
          targetLocale,
        });
      }
    }
  }

  return pairs;
}

export function discoverByPattern(
  entries: SitemapEntry[],
  sourceLocale: string,
  targetLocale: string
): DiscoveredPair[] {
  const allUrls = entries.map((e) => e.loc).filter(Boolean);
  const pairs: DiscoveredPair[] = [];

  // Strategy 1: Path segment pattern (/en/page → /de/page)
  const sourceByPath = new Map<string, string>();
  const targetByPath = new Map<string, string>();

  for (const url of allUrls) {
    try {
      const u = new URL(url);
      const segments = u.pathname.split("/").filter(Boolean);

      if (segments.length > 0) {
        const firstSeg = segments[0].toLowerCase();

        if (firstSeg === sourceLocale.toLowerCase()) {
          const rest = "/" + segments.slice(1).join("/");
          const key = u.origin + rest;
          sourceByPath.set(key, url);
        } else if (firstSeg === targetLocale.toLowerCase()) {
          const rest = "/" + segments.slice(1).join("/");
          const key = u.origin + rest;
          targetByPath.set(key, url);
        }
      }

      // Strategy 2: Subdomain pattern (en.example.com → de.example.com)
      const hostParts = u.hostname.split(".");
      if (hostParts.length >= 2) {
        if (hostParts[0].toLowerCase() === sourceLocale.toLowerCase()) {
          const rest = hostParts.slice(1).join(".") + u.pathname;
          sourceByPath.set("subdomain:" + rest, url);
        } else if (hostParts[0].toLowerCase() === targetLocale.toLowerCase()) {
          const rest = hostParts.slice(1).join(".") + u.pathname;
          targetByPath.set("subdomain:" + rest, url);
        }
      }

      // Strategy 3: Query param pattern (?lang=en → ?lang=de)
      const lang = u.searchParams.get("lang") || u.searchParams.get("locale");
      if (lang) {
        const cleanUrl = new URL(url);
        cleanUrl.searchParams.delete("lang");
        cleanUrl.searchParams.delete("locale");
        const key = "query:" + cleanUrl.toString();

        if (lang.toLowerCase() === sourceLocale.toLowerCase()) {
          sourceByPath.set(key, url);
        } else if (lang.toLowerCase() === targetLocale.toLowerCase()) {
          targetByPath.set(key, url);
        }
      }
    } catch {
      continue;
    }
  }

  // Match source/target by normalized path
  for (const [key, sourceUrl] of sourceByPath) {
    const targetUrl = targetByPath.get(key);
    if (targetUrl) {
      pairs.push({
        sourceUrl,
        targetUrl,
        sourceLocale,
        targetLocale,
      });
    }
  }

  return pairs;
}

export async function discoverPairs(
  sitemapUrl: string,
  sourceLocale: string,
  targetLocale: string
): Promise<DiscoveredPair[]> {
  const entries = await parseSitemap(sitemapUrl);

  if (entries.length === 0) {
    throw new Error("No URLs found in sitemap");
  }

  // Try hreflang first
  const hreflangPairs = discoverByHreflang(entries, sourceLocale, targetLocale);
  if (hreflangPairs.length > 0) {
    return hreflangPairs;
  }

  // Fall back to URL pattern matching
  const patternPairs = discoverByPattern(entries, sourceLocale, targetLocale);
  if (patternPairs.length > 0) {
    return patternPairs;
  }

  throw new Error(
    `No localized page pairs found for ${sourceLocale} → ${targetLocale}. ` +
    `Checked ${entries.length} URLs using hreflang tags and URL pattern matching.`
  );
}
