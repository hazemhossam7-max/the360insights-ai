function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseList(value) {
  return String(value || "")
    .split(/[\r\n,]+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function parseBoolean(value, defaultValue = false) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parsePositiveInteger(value, defaultValue) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  return defaultValue;
}

function unique(values) {
  return Array.from(new Set((values || []).map((item) => cleanText(item)).filter(Boolean)));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeInternalHref(href, baseUrl) {
  try {
    const target = new URL(href, baseUrl);
    const origin = new URL(baseUrl).origin;
    if (target.origin !== origin) {
      return "";
    }
    target.hash = "";
    return target.toString();
  } catch {
    return "";
  }
}

function inferLoginUrl(baseUrl, explicitLoginUrl) {
  if (cleanText(explicitLoginUrl)) {
    return explicitLoginUrl;
  }

  try {
    const url = new URL(baseUrl);
    url.pathname = "/login";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export class AuthenticationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AuthenticationError";
    this.classification = "authentication_access_issue";
    this.details = details;
  }
}

const DEFAULT_USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name*="email" i]',
  'input[id*="email" i]',
  'input[name*="user" i]',
  'input[id*="user" i]',
  'input[name*="login" i]',
  'input[id*="login" i]',
  'input[name*="identifier" i]',
  'input[id*="identifier" i]',
  'input[autocomplete="username"]',
  'input:not([type="hidden"]):not([type="password"])',
];

const DEFAULT_PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name*="password" i]',
  'input[id*="password" i]',
  'input[autocomplete="current-password"]',
];

const DEFAULT_SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Sign in")',
  'button:has-text("Continue")',
  'button:has-text("Get Started")',
  '[role="button"]:has-text("Log in")',
  '[role="button"]:has-text("Login")',
  '[role="button"]:has-text("Sign in")',
  '[role="button"]:has-text("Continue")',
];

const DEFAULT_SUCCESS_SELECTORS = [
  "aside",
  "nav",
  '[role="navigation"]',
  '[class*="sidebar"]',
  '[class*="drawer"]',
  'text=Dashboard',
];

const REDIRECT_PENDING_PHRASES = [
  "welcome back",
  "redirecting to dashboard",
  "redirecting",
];

export function buildAuthConfig(baseUrl, env = process.env) {
  const websiteUrl = cleanText(baseUrl);
  const requireAuth = parseBoolean(env.APP_REQUIRE_AUTH, true);
  const loginUrl = inferLoginUrl(websiteUrl, env.APP_LOGIN_URL);
  const postLoginUrl = cleanText(env.APP_POST_LOGIN_URL);
  const parsedMaxDiscoveryPages = Number(env.APP_DISCOVERY_MAX_PAGES);
  const maxDiscoveryPages = Number.isFinite(parsedMaxDiscoveryPages)
    ? Math.max(1, parsedMaxDiscoveryPages)
    : 8;
  const redirectTimeoutMs = parsePositiveInteger(env.APP_AUTH_REDIRECT_TIMEOUT_MS, 45000);
  const forcedNavigationTimeoutMs = parsePositiveInteger(
    env.APP_AUTH_FORCED_NAVIGATION_TIMEOUT_MS,
    Math.max(10000, Math.round(redirectTimeoutMs / 2))
  );

  return {
    requireAuth,
    websiteUrl,
    loginUrl,
    postLoginUrl,
    username: cleanText(env.APP_USERNAME || env.APP_EMAIL),
    password: cleanText(env.APP_PASSWORD),
    usernameSelectors: unique([
      ...parseList(env.APP_USERNAME_SELECTOR),
      ...DEFAULT_USERNAME_SELECTORS,
    ]),
    passwordSelectors: unique([
      ...parseList(env.APP_PASSWORD_SELECTOR),
      ...DEFAULT_PASSWORD_SELECTORS,
    ]),
    submitSelectors: unique([
      ...parseList(env.APP_SUBMIT_SELECTOR),
      ...DEFAULT_SUBMIT_SELECTORS,
    ]),
    successSelectors: unique([
      ...parseList(env.APP_SUCCESS_SELECTORS),
      ...DEFAULT_SUCCESS_SELECTORS,
    ]),
    maxDiscoveryPages,
    redirectTimeoutMs,
    forcedNavigationTimeoutMs,
  };
}

export function validateAuthConfig(authConfig) {
  const missing = [];
  if (!authConfig?.websiteUrl) {
    missing.push("websiteUrl");
  }
  if (!authConfig?.loginUrl) {
    missing.push("APP_LOGIN_URL");
  }
  if (authConfig?.requireAuth) {
    if (!authConfig?.username) {
      missing.push("APP_USERNAME");
    }
    if (!authConfig?.password) {
      missing.push("APP_PASSWORD");
    }
  }
  return missing;
}

async function firstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          return locator;
        }
      }
    } catch {
      // Ignore selector parsing failures and continue with the fallback list.
    }
  }
  return null;
}

async function collectVisibleMarkerTexts(page, selectors) {
  const seen = [];
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (!(await locator.count())) {
        continue;
      }
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      const text = cleanText(await locator.innerText().catch(() => ""));
      if (text) {
        seen.push(text);
      } else {
        seen.push(selector);
      }
    } catch {
      // Ignore invalid selectors and keep probing the remaining success markers.
    }
  }
  return unique(seen);
}

async function detectRedirectPendingSuccess(page) {
  const texts = await page
    .evaluate((phrases) => {
      const selectors = [
        '[role="alert"]',
        '[aria-live="assertive"]',
        '[aria-live="polite"]',
        '[data-testid*="toast"]',
        '[data-sonner-toast]',
        '[class*="toast"]',
        '[class*="notification"]',
      ];
      const values = [];

      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
          if (text) {
            values.push(text);
          }
        }
      }

      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      if (bodyText) {
        for (const phrase of phrases) {
          if (bodyText.toLowerCase().includes(String(phrase).toLowerCase())) {
            values.push(bodyText.slice(0, 600));
            break;
          }
        }
      }

      return Array.from(new Set(values)).slice(0, 10);
    }, REDIRECT_PENDING_PHRASES)
    .catch(() => []);

  const matchedTexts = unique(
    texts.filter((text) =>
      REDIRECT_PENDING_PHRASES.some((phrase) => cleanText(text).toLowerCase().includes(phrase))
    )
  ).slice(0, 5);

  return {
    active: matchedTexts.length > 0,
    texts: matchedTexts,
  };
}

async function pageLooksLikeLogin(page, authConfig, options = {}) {
  const passwordField = await firstVisibleLocator(page, authConfig.passwordSelectors);
  if (passwordField) {
    return true;
  }

  const currentUrl = cleanText(page.url()).toLowerCase();
  if (/\blogin\b|\bsignin\b|\bauth\b/.test(currentUrl)) {
    return true;
  }

  const title = cleanText(await page.title().catch(() => "")).toLowerCase();
  if (/\blogin\b|\bsign in\b|\bauthentication\b/.test(title)) {
    return true;
  }

  return false;
}

async function waitForAuthenticatedOutcome(page, authConfig, timeoutMs) {
  const startedAt = Date.now();
  let lastState = {
    authenticated: false,
    markerTexts: [],
    sidebarModules: [],
    redirectPending: false,
    redirectPendingTexts: [],
    currentUrl: page.url(),
    currentTitle: "",
    stillOnLogin: true,
  };

  while (Date.now() - startedAt < timeoutMs) {
    const authState = await captureAuthenticatedUiState(page, authConfig);
    const redirectPending = await detectRedirectPendingSuccess(page);
    const stillOnLogin = await pageLooksLikeLogin(page, authConfig);

    lastState = {
      ...authState,
      redirectPending: redirectPending.active,
      redirectPendingTexts: redirectPending.texts,
      stillOnLogin,
    };

    if (authState.authenticated && !stillOnLogin) {
      return lastState;
    }

    if (redirectPending.active) {
      return lastState;
    }

    await page.waitForTimeout(500).catch(() => {});
  }

  return lastState;
}

export async function captureAuthenticatedUiState(page, authConfig) {
  const markerTexts = await collectVisibleMarkerTexts(page, authConfig.successSelectors);
  const sidebarModules = await page.evaluate(() => {
    const roots = Array.from(
      document.querySelectorAll('aside, nav, [role="navigation"], [class*="sidebar"], [class*="drawer"], [class*="menu"]')
    );
    const values = [];

    for (const root of roots) {
      const nodes = root.querySelectorAll("a, button, [role='button'], li");
      for (const node of nodes) {
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        if (text && text.length <= 120) {
          values.push(text);
        }
      }
    }

    return Array.from(new Set(values)).slice(0, 30);
  }).catch(() => []);

  return {
    authenticated: markerTexts.length > 0 || sidebarModules.length > 0,
    markerTexts,
    sidebarModules,
    currentUrl: page.url(),
    currentTitle: cleanText(await page.title().catch(() => "")),
  };
}

async function submitLogin(page, authConfig) {
  const submit = await firstVisibleLocator(page, authConfig.submitSelectors);
  if (submit) {
    await Promise.allSettled([
      submit.click({ timeout: 5000 }),
      page.waitForLoadState("networkidle", { timeout: 15000 }),
    ]);
    return;
  }

  const passwordField = await firstVisibleLocator(page, authConfig.passwordSelectors);
  if (!passwordField) {
    throw new AuthenticationError("The password field was not visible when attempting to submit login.");
  }

  await Promise.allSettled([
    passwordField.press("Enter"),
    page.waitForLoadState("networkidle", { timeout: 15000 }),
  ]);
}

async function collectFailureDiagnostics(page, authConfig, transitionState = "") {
  const authState = await captureAuthenticatedUiState(page, authConfig).catch(() => ({
    authenticated: false,
    markerTexts: [],
    sidebarModules: [],
    currentUrl: page.url(),
    currentTitle: "",
  }));

  const errorTexts = await page
    .evaluate(() => {
      const selectors = [
        '[role="alert"]',
        '[aria-live="assertive"]',
        '[aria-live="polite"]',
        '[class*="error"]',
        '[class*="alert"]',
        '[class*="warning"]',
        '[data-testid*="error"]',
      ];
      const values = [];
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
          if (text) {
            values.push(text);
          }
        }
      }
      return Array.from(new Set(values)).slice(0, 10);
    })
    .catch(() => []);

  const redirectPending = await detectRedirectPendingSuccess(page).catch(() => ({
    active: false,
    texts: [],
  }));

  const bodyPreview = await page
    .locator("body")
    .innerText()
    .then((text) => cleanText(text).slice(0, 1200))
    .catch(() => "");

  return {
    currentUrl: page.url(),
    currentTitle: cleanText(await page.title().catch(() => "")),
    markerTexts: authState.markerTexts || [],
    sidebarModules: authState.sidebarModules || [],
    redirectPendingTexts: redirectPending.texts || [],
    errorTexts,
    bodyPreview,
    transitionState: cleanText(transitionState || "authenticated_shell_missing"),
  };
}

export async function ensureAuthenticatedSession(page, authConfig, options = {}) {
  const missing = validateAuthConfig(authConfig);
  if (missing.length) {
    throw new AuthenticationError(`Missing required authentication configuration: ${missing.join(", ")}`, {
      missing,
    });
  }

  if (!options.skipNavigation) {
    await page.goto(authConfig.loginUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  const alreadyAuthenticated = await captureAuthenticatedUiState(page, authConfig);
  if (alreadyAuthenticated.authenticated && !(await pageLooksLikeLogin(page, authConfig))) {
    return {
      ...alreadyAuthenticated,
      loginAttempted: false,
      loginUrl: authConfig.loginUrl,
      postLoginUrl: authConfig.postLoginUrl,
    };
  }

  if (options.allowFreshLogin === false) {
    const reuseTarget = cleanText(authConfig.postLoginUrl || authConfig.websiteUrl || "");
    if (reuseTarget && cleanText(page.url()) !== reuseTarget) {
      await page.goto(reuseTarget, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const recoveredSession = await captureAuthenticatedUiState(page, authConfig);
      if (recoveredSession.authenticated && !(await pageLooksLikeLogin(page, authConfig))) {
        return {
          ...recoveredSession,
          loginAttempted: false,
          loginUrl: authConfig.loginUrl,
          postLoginUrl: authConfig.postLoginUrl,
          recoveredByNavigation: true,
        };
      }
    }

    throw new AuthenticationError("The authenticated session is not available for reuse on the current page.", {
      currentUrl: page.url(),
      currentTitle: cleanText(await page.title().catch(() => "")),
      transitionState: "authenticated_session_missing",
    });
  }

  const usernameField = await firstVisibleLocator(page, authConfig.usernameSelectors);
  const passwordField = await firstVisibleLocator(page, authConfig.passwordSelectors);

  if (!usernameField || !passwordField) {
    throw new AuthenticationError(
      "The login form could not be found. Provide APP_USERNAME_SELECTOR / APP_PASSWORD_SELECTOR or verify the login page is reachable.",
      {
        currentUrl: page.url(),
        transitionState: "login_form_not_found",
      }
    );
  }

  await usernameField.fill(authConfig.username);
  await passwordField.fill(authConfig.password);
  await submitLogin(page, authConfig);

  if (authConfig.postLoginUrl) {
    await page.waitForURL(new RegExp(escapeRegExp(authConfig.postLoginUrl)), {
      timeout: authConfig.redirectTimeoutMs,
    }).catch(() => {});
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000).catch(() => {});

  let validated = await waitForAuthenticatedOutcome(page, authConfig, authConfig.redirectTimeoutMs);

  let forcedNavigationAttempted = false;
  if (validated.redirectPending && validated.stillOnLogin) {
    forcedNavigationAttempted = true;
    const landingUrl = cleanText(authConfig.postLoginUrl || authConfig.websiteUrl);
    if (landingUrl) {
      await page.goto(landingUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(3000).catch(() => {});
      validated = await waitForAuthenticatedOutcome(
        page,
        authConfig,
        authConfig.forcedNavigationTimeoutMs
      );
    }
  }

  if (!validated.authenticated || validated.stillOnLogin) {
    const transitionState = !validated.redirectPending
      ? "authenticated_shell_missing"
      : forcedNavigationAttempted
        ? "redirect_stalled_on_login"
        : "credentials_submitted_waiting_redirect";
    const diagnostics = await collectFailureDiagnostics(page, authConfig, transitionState);
    throw new AuthenticationError(
      `Login did not reach the authenticated application shell. STATE=${diagnostics.transitionState || "unknown"} URL=${diagnostics.currentUrl || "unknown"} TITLE=${diagnostics.currentTitle || "unknown"} ERRORS=${(diagnostics.errorTexts || []).join(" | ") || "none"} MARKERS=${(diagnostics.markerTexts || []).join(" | ") || "none"} REDIRECT=${(diagnostics.redirectPendingTexts || []).join(" | ") || "none"}`,
      diagnostics
    );
  }

  return {
    ...validated,
    loginAttempted: true,
    loginUrl: authConfig.loginUrl,
    postLoginUrl: authConfig.postLoginUrl,
  };
}

async function collectPageSnapshot(page, authConfig) {
  return page.evaluate(({ successSelectors }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const uniqueValues = (values) => Array.from(new Set(values.map((item) => clean(item)).filter(Boolean)));
    const textList = (selector, limit = 20) =>
      uniqueValues(
        Array.from(document.querySelectorAll(selector))
          .map((node) => node.innerText || node.textContent || "")
          .filter(Boolean)
      ).slice(0, limit);

    const links = uniqueValues(
      Array.from(document.querySelectorAll("a[href]"))
        .map((node) => ({
          text: clean(node.innerText || node.textContent || ""),
          href: node.getAttribute("href") || "",
        }))
        .filter((item) => item.href && item.text && !/^javascript:/i.test(item.href))
        .map((item) => JSON.stringify(item))
    ).map((item) => JSON.parse(item));

    const forms = Array.from(document.querySelectorAll("form"))
      .map((form) => {
        const fields = Array.from(form.querySelectorAll("input, textarea, select"))
          .map((field) => clean(field.getAttribute("name") || field.getAttribute("type") || field.tagName))
          .filter(Boolean);
        return {
          action: clean(form.getAttribute("action") || ""),
          method: clean(form.getAttribute("method") || "get").toLowerCase(),
          summary: clean(fields.join(", ") || "form"),
        };
      })
      .slice(0, 10);

    const sidebarModules = uniqueValues(
      Array.from(document.querySelectorAll('aside a, aside button, nav a, nav button, [role="navigation"] a, [role="navigation"] button, [class*="sidebar"] a, [class*="sidebar"] button'))
        .map((node) => node.innerText || node.textContent || "")
    ).slice(0, 30);

    const cards = uniqueValues(
      Array.from(document.querySelectorAll('article, section, [class*="card"], [class*="widget"]'))
        .map((node) => {
          const heading = node.querySelector("h1, h2, h3, h4, h5, h6");
          return heading ? heading.innerText || heading.textContent || "" : "";
        })
    ).slice(0, 20);

    const markerTexts = uniqueValues(
      successSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).map((node) => node.innerText || node.textContent || selector)
      )
    ).slice(0, 20);

    return {
      url: window.location.href,
      title: clean(document.title),
      headings: textList("h1, h2, h3", 20),
      buttons: textList("button, [role='button']", 20),
      sidebarModules,
      forms,
      cards,
      markerTexts,
      bodyPreview: clean(document.body?.innerText || "").slice(0, 1600),
      tables: document.querySelectorAll("table, [role='table']").length,
      links,
    };
  }, {
    successSelectors: authConfig.successSelectors.filter((selector) => !/^text=/i.test(selector)),
  });
}

function scoreDiscoveredLink(link, sidebarModules) {
  const haystack = cleanText(`${link?.text || ""} ${link?.href || ""}`).toLowerCase();
  let score = 0;
  if (!haystack) {
    return score;
  }

  if (/dashboard|analysis|insight|collection|competition|directory|planner|calculator|sponsor|athlete|technical|mental/.test(haystack)) {
    score += 15;
  }

  for (const moduleName of sidebarModules || []) {
    if (haystack.includes(cleanText(moduleName).toLowerCase())) {
      score += 10;
    }
  }

  if (/settings|profile|account/.test(haystack)) {
    score += 4;
  }

  return score;
}

export async function discoverAuthenticatedApp(page, authConfig) {
  const session = await ensureAuthenticatedSession(page, authConfig);
  const pages = [];
  const visited = new Set();
  const queue = [];

  const initialSnapshot = await collectPageSnapshot(page, authConfig);
  pages.push(initialSnapshot);
  visited.add(cleanText(initialSnapshot.url));

  for (const link of initialSnapshot.links || []) {
    const normalized = normalizeInternalHref(link.href, initialSnapshot.url);
    if (!normalized) {
      continue;
    }
    queue.push({
      url: normalized,
      text: link.text,
      score: scoreDiscoveredLink(link, initialSnapshot.sidebarModules),
    });
  }

  while (queue.length && pages.length < authConfig.maxDiscoveryPages) {
    queue.sort((a, b) => b.score - a.score);
    const next = queue.shift();
    if (!next || visited.has(cleanText(next.url))) {
      continue;
    }

    await page.goto(next.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const refreshedSession = await ensureAuthenticatedSession(page, authConfig, {
      skipNavigation: true,
      allowFreshLogin: false,
    });
    if (!refreshedSession.authenticated) {
      throw new AuthenticationError("Authenticated discovery lost the protected session while crawling internal pages.", {
        currentUrl: page.url(),
      });
    }

    const snapshot = await collectPageSnapshot(page, authConfig);
    pages.push(snapshot);
    visited.add(cleanText(snapshot.url));

    for (const link of snapshot.links || []) {
      const normalized = normalizeInternalHref(link.href, snapshot.url);
      if (!normalized || visited.has(cleanText(normalized))) {
        continue;
      }

      queue.push({
        url: normalized,
        text: link.text,
        score: scoreDiscoveredLink(link, snapshot.sidebarModules),
      });
    }
  }

  const modules = unique(
    pages.flatMap((item) => item.sidebarModules || []).filter((item) => cleanText(item).length >= 2)
  );
  const notablePaths = unique(
    pages.map((item) => {
      try {
        return new URL(item.url).pathname;
      } catch {
        return "";
      }
    })
  );
  const featureCandidates = unique([
    ...modules,
    ...pages.flatMap((item) => item.headings || []),
    ...pages.flatMap((item) => item.cards || []),
    ...pages.flatMap((item) => item.buttons || []),
  ])
    .filter((item) => cleanText(item).length >= 3)
    .slice(0, 40)
    .map((feature) => ({
      feature,
      evidence: pages.filter((pageItem) =>
        cleanText(`${pageItem.title} ${(pageItem.headings || []).join(" ")} ${(pageItem.buttons || []).join(" ")}`)
          .toLowerCase()
          .includes(cleanText(feature).toLowerCase())
      ).map((pageItem) => pageItem.url),
    }));

  return {
    authenticated: true,
    loginUrl: authConfig.loginUrl,
    landingUrl: session.currentUrl || initialSnapshot.url,
    markerTexts: session.markerTexts,
    sidebarModules: modules,
    notablePaths,
    pages,
    featureCandidates,
    discoveredAt: new Date().toISOString(),
  };
}

export function buildAuthenticatedWebsiteBrief(websiteUrl, discovery) {
  const landingPage = discovery?.pages?.[0] || {};
  const title = cleanText(landingPage.title || new URL(websiteUrl).host);
  const summary = cleanText(
    [
      `Authenticated application shell reached at ${cleanText(discovery?.landingUrl || websiteUrl)}.`,
      discovery?.sidebarModules?.length ? `Visible modules: ${discovery.sidebarModules.join(", ")}.` : "",
      landingPage.bodyPreview || "",
    ]
      .filter(Boolean)
      .join(" ")
  );

  return {
    source: "authenticated-app-discovery",
    url: websiteUrl,
    entryUrl: cleanText(discovery?.landingUrl || websiteUrl),
    loginUrl: cleanText(discovery?.loginUrl || ""),
    title,
    host: new URL(websiteUrl).host,
    authenticated: true,
    sidebarModules: discovery?.sidebarModules || [],
    summary,
    featureCandidates: discovery?.featureCandidates || [],
    notablePaths: discovery?.notablePaths || [],
    pages: (discovery?.pages || []).map((page) => ({
      url: page.url,
      title: page.title,
      description: page.bodyPreview,
      headings: page.headings || [],
      buttons: page.buttons || [],
      forms: page.forms || [],
      cards: page.cards || [],
      sidebarModules: page.sidebarModules || [],
      importantLinks: (page.links || []).map((link) => ({
        text: link.text,
        href: normalizeInternalHref(link.href, page.url),
      })).filter((link) => link.href),
    })),
    discoveredAt: discovery?.discoveredAt || new Date().toISOString(),
  };
}
