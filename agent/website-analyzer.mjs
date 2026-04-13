const FEATURE_KEYWORDS = [
  { name: "Billing", terms: ["billing", "invoice", "invoices", "payment", "payments", "subscription", "subscriptions", "plan", "plans", "pricing"] },
  { name: "Authentication", terms: ["login", "log in", "sign in", "register", "sign up", "password", "authentication", "auth"] },
  { name: "Account Management", terms: ["account", "profile", "settings", "security", "preferences", "personal details"] },
  { name: "Checkout", terms: ["checkout", "cart", "purchase", "order", "orders", "pay now"] },
  { name: "Support", terms: ["help", "support", "contact", "faq", "documentation", "docs"] },
  { name: "Search", terms: ["search", "filter", "sort", "results"] },
  { name: "Dashboard", terms: ["dashboard", "overview", "analytics", "reports", "insights"] },
];

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("A website URL is required.");
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Website URL must use http or https.");
  }
  parsed.hash = "";
  return parsed;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function matchFirst(html, regex) {
  const match = String(html || "").match(regex);
  return match?.[1] ? decodeEntities(match[1]).trim() : "";
}

function extractMetaDescription(html) {
  return matchFirst(
    html,
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
}

function extractTitle(html) {
  return matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
}

function extractHeadings(html) {
  const headings = [];
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingRegex.exec(String(html || "")))) {
    const text = stripTags(match[2]);
    if (text) {
      headings.push(text);
    }
    if (headings.length >= 12) {
      break;
    }
  }
  return headings;
}

function extractButtons(html) {
  const buttons = [];
  const buttonRegex = /<button\b[^>]*>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = buttonRegex.exec(String(html || "")))) {
    const text = stripTags(match[1]);
    if (text) {
      buttons.push(text);
    }
    if (buttons.length >= 12) {
      break;
    }
  }

  const inputRegex = /<input\b[^>]*type=["']?(submit|button|reset)["']?[^>]*>/gi;
  while ((match = inputRegex.exec(String(html || "")))) {
    const valueMatch = match[0].match(/\bvalue=["']([^"']+)["']/i);
    const ariaLabelMatch = match[0].match(/\baria-label=["']([^"']+)["']/i);
    const titleMatch = match[0].match(/\btitle=["']([^"']+)["']/i);
    const text = decodeEntities(valueMatch?.[1] || ariaLabelMatch?.[1] || titleMatch?.[1] || match[1]);
    if (text) {
      buttons.push(text);
    }
    if (buttons.length >= 12) {
      break;
    }
  }

  return buttons;
}

function extractForms(html) {
  const forms = [];
  const formRegex = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  let match;
  while ((match = formRegex.exec(String(html || "")))) {
    const formHtml = match[0];
    const action = matchFirst(formHtml, /<form\b[^>]*action=["']([^"']+)["'][^>]*>/i);
    const method = matchFirst(formHtml, /<form\b[^>]*method=["']([^"']+)["'][^>]*>/i) || "get";
    const fields = [];
    const inputRegex = /<input\b[^>]*type=["']?([^"'\s>]+)["']?[^>]*>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(formHtml))) {
      fields.push(String(inputMatch[1] || "text").toLowerCase());
    }
    const textareaCount = (formHtml.match(/<textarea\b/gi) || []).length;
    const selectCount = (formHtml.match(/<select\b/gi) || []).length;
    const summary = [fields.length ? `${fields.join(", ")}` : "", textareaCount ? `${textareaCount} textarea` : "", selectCount ? `${selectCount} select` : ""]
      .filter(Boolean)
      .join("; ");

    forms.push({
      action: action || "",
      method: String(method || "get").toLowerCase(),
      summary: summary || "form",
    });

    if (forms.length >= 10) {
      break;
    }
  }
  return forms;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(String(html || "")))) {
    const href = String(match[1] || "").trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)) {
      continue;
    }

    let absoluteHref;
    try {
      absoluteHref = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const text = stripTags(match[2]);
    links.push({
      text,
      href,
      absoluteHref,
      internal: new URL(absoluteHref).origin === new URL(baseUrl).origin,
    });

    if (links.length >= 50) {
      break;
    }
  }

  return links;
}

function scoreLink(link) {
  const haystack = `${link.text || ""} ${link.href || ""}`.toLowerCase();
  let score = link.internal ? 1 : 0;
  for (const feature of FEATURE_KEYWORDS) {
    if (feature.terms.some((term) => haystack.includes(term))) {
      score += 10;
    }
  }
  return score;
}

function summarizePage(page) {
  return {
    url: page.url,
    title: page.title,
    description: page.description,
    headings: page.headings.slice(0, 6),
    buttons: page.buttons.slice(0, 6),
    forms: page.forms.slice(0, 4),
    importantLinks: page.links
      .filter((link) => link.internal)
      .slice(0, 12)
      .map((link) => ({
        text: link.text,
        href: link.absoluteHref,
      })),
  };
}

function deriveFeatureCandidates(pages) {
  const candidates = new Map();

  for (const page of pages) {
    const text = `${page.title || ""} ${page.description || ""} ${(page.headings || []).join(" ")} ${(page.buttons || []).join(" ")} ${(page.links || []).map((link) => `${link.text || ""} ${link.href || ""}`).join(" ")}`.toLowerCase();
    for (const feature of FEATURE_KEYWORDS) {
      const matches = feature.terms.filter((term) => text.includes(term));
      if (matches.length) {
        candidates.set(feature.name, {
          feature: feature.name,
          evidence: Array.from(new Set([...(candidates.get(feature.name)?.evidence || []), page.title || page.url].filter(Boolean))),
        });
      }
    }
  }

  return Array.from(candidates.values());
}

async function fetchPage(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out.")), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TripBudgetAgent/1.0 (+https://github.com/hazemhossam7-max/trip-budget-planner)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const html = await response.text();

    if (!response.ok) {
      throw new Error(`Website request failed (${response.status}): ${response.statusText || "Request failed"}`);
    }

    return { html, finalUrl: response.url || url, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeWebsite(rawUrl, options = {}) {
  const rootUrl = normalizeUrl(rawUrl);
  const timeoutMs = Number(options.timeoutMs || 15000);
  const maxPages = Number(options.maxPages || 5);
  const visited = new Set();
  const pages = [];

  async function crawl(url, depth = 0) {
    const normalized = trimTrailingSlash(url.toString());
    if (visited.has(normalized) || pages.length >= maxPages) {
      return;
    }

    visited.add(normalized);

    const { html, finalUrl, contentType } = await fetchPage(url.toString(), timeoutMs);
    const pageUrl = new URL(finalUrl);
    const page = {
      url: pageUrl.toString(),
      contentType,
      title: extractTitle(html),
      description: extractMetaDescription(html),
      headings: extractHeadings(html),
      buttons: extractButtons(html),
      forms: extractForms(html),
      links: extractLinks(html, pageUrl.toString()),
    };

    pages.push(page);

    if (depth >= 1) {
      return;
    }

    const nextLinks = page.links
      .filter((link) => link.internal)
      .sort((a, b) => scoreLink(b) - scoreLink(a))
      .slice(0, Math.max(0, maxPages - pages.length));

    for (const link of nextLinks) {
      if (pages.length >= maxPages) {
        break;
      }
      try {
        await crawl(new URL(link.absoluteHref), depth + 1);
      } catch {
        // Ignore single-page failures and keep the crawl moving.
      }
    }
  }

  await crawl(rootUrl, 0);

  const rootPage = pages[0] || {
    url: rootUrl.toString(),
    title: rootUrl.hostname,
    description: "",
    headings: [],
    buttons: [],
    forms: [],
    links: [],
  };

  const featureCandidates = deriveFeatureCandidates(pages);
  const observedPages = pages.map(summarizePage);
  const notablePaths = Array.from(
    new Set(
      pages
        .flatMap((page) => page.links || [])
        .filter((link) => link.internal)
        .map((link) => {
          try {
            return new URL(link.absoluteHref).pathname;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
        .slice(0, 20)
    )
  );

  return {
    source: "website-url",
    url: rootUrl.toString(),
    host: rootUrl.host,
    title: rootPage.title || rootUrl.hostname,
    summary: rootPage.description || rootPage.headings[0] || `Website at ${rootUrl.hostname}`,
    featureCandidates,
    notablePaths,
    pages: observedPages,
    crawledAt: new Date().toISOString(),
  };
}
