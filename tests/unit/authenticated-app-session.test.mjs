import assert from "node:assert/strict";
import {
  AuthenticationError,
  buildAuthConfig,
  buildAuthenticatedWebsiteBrief,
  ensureAuthenticatedSession,
  validateAuthConfig,
} from "../../agent/authenticated-app-session.mjs";

class FakeLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  first() {
    return this;
  }

  async count() {
    if (this.selector === "body") {
      return 1;
    }
    return this.page.hasElement(this.selector) ? 1 : 0;
  }

  async isVisible() {
    if (this.selector === "body") {
      return true;
    }
    const element = this.page.getElement(this.selector);
    return Boolean(element?.visible);
  }

  async fill(value) {
    this.page.fills.set(this.selector, value);
  }

  async press(key) {
    if (key === "Enter") {
      await this.page.submit();
    }
  }

  async click() {
    await this.page.click(this.selector);
  }

  async innerText() {
    if (this.selector === "body") {
      return this.page.scene.bodyText || "";
    }
    const element = this.page.getElement(this.selector);
    return element?.text || "";
  }
}

class FakePage {
  constructor({ loginUrl, websiteUrl, postLoginUrl, scenes, initialScene = "blank" }) {
    this.loginUrl = loginUrl;
    this.websiteUrl = websiteUrl;
    this.postLoginUrl = postLoginUrl;
    this.scenes = scenes;
    this.sceneName = initialScene;
    this.fills = new Map();
    this.gotoHistory = [];
  }

  get scene() {
    return this.scenes[this.sceneName];
  }

  hasElement(selector) {
    return Boolean(this.getElement(selector));
  }

  getElement(selector) {
    return this.scene?.elements?.[selector] || null;
  }

  locator(selector) {
    return new FakeLocator(this, selector);
  }

  async goto(url) {
    this.gotoHistory.push(url);

    if (url === this.loginUrl) {
      this.sceneName = "login";
      return { status: () => 200 };
    }

    if (url === this.postLoginUrl || url === this.websiteUrl) {
      const nextScene = this.scene?.onLandingGoto || this.scenes.login?.onLandingGoto || "authenticated";
      this.sceneName = nextScene;
      return { status: () => 200 };
    }

    this.sceneName = this.scene?.onUnknownGoto || this.sceneName;
    return { status: () => 200 };
  }

  async waitForLoadState() {}

  async waitForURL() {}

  async waitForTimeout() {
    if (this.scene?.onWait) {
      this.sceneName = this.scene.onWait;
    }
  }

  url() {
    return this.scene?.url || "about:blank";
  }

  async title() {
    return this.scene?.title || "";
  }

  async evaluate(fn, arg) {
    if (Array.isArray(arg)) {
      return this.scene?.redirectTexts || [];
    }

    const fnSource = String(fn);
    if (fnSource.includes("const selectors = [")) {
      return this.scene?.errorTexts || [];
    }

    return this.scene?.sidebarModules || [];
  }

  async click(selector) {
    const element = this.getElement(selector);
    if (element?.action === "submit") {
      await this.submit();
    }
  }

  async submit() {
    this.sceneName = this.scene?.afterSubmit || this.sceneName;
  }
}

function createAuthConfig() {
  return buildAuthConfig("https://example.com/app", {
    APP_REQUIRE_AUTH: "true",
    APP_LOGIN_URL: "https://example.com/login",
    APP_POST_LOGIN_URL: "https://example.com/app",
    APP_USERNAME: "hazem@example.com",
    APP_PASSWORD: "secret",
  });
}

const cases = [
  {
    name: "buildAuthConfig infers defaults and respects overrides",
    run() {
      const authConfig = buildAuthConfig("https://example.com/app", {
        APP_REQUIRE_AUTH: "yes",
        APP_USERNAME: "hazem@example.com",
        APP_PASSWORD: "secret",
        APP_USERNAME_SELECTOR: "input[data-qa='email']",
        APP_PASSWORD_SELECTOR: "input[data-qa='password']",
        APP_SUBMIT_SELECTOR: "button[data-qa='submit']",
        APP_SUCCESS_SELECTORS: "main nav",
        APP_DISCOVERY_MAX_PAGES: "0",
      });

      assert.equal(authConfig.requireAuth, true);
      assert.equal(authConfig.loginUrl, "https://example.com/login");
      assert.equal(authConfig.maxDiscoveryPages, 1);
      assert.equal(authConfig.redirectTimeoutMs, 45000);
      assert.equal(authConfig.forcedNavigationTimeoutMs, 22500);
      assert.equal(authConfig.usernameSelectors[0], "input[data-qa='email']");
      assert.equal(authConfig.passwordSelectors[0], "input[data-qa='password']");
      assert.equal(authConfig.submitSelectors[0], "button[data-qa='submit']");
      assert.equal(authConfig.successSelectors[0], "main nav");
    },
  },
  {
    name: "validateAuthConfig only requires credentials when auth is enabled",
    run() {
      assert.deepEqual(
        validateAuthConfig({
          websiteUrl: "https://example.com",
          loginUrl: "https://example.com/login",
          requireAuth: true,
          username: "",
          password: "",
        }),
        ["APP_USERNAME", "APP_PASSWORD"]
      );

      assert.deepEqual(
        validateAuthConfig({
          websiteUrl: "https://example.com",
          loginUrl: "https://example.com/login",
          requireAuth: false,
          username: "",
          password: "",
        }),
        []
      );
    },
  },
  {
    name: "buildAuthConfig accepts redirect timeout overrides",
    run() {
      const authConfig = buildAuthConfig("https://example.com/app", {
        APP_REQUIRE_AUTH: "true",
        APP_LOGIN_URL: "https://example.com/login",
        APP_USERNAME: "hazem@example.com",
        APP_PASSWORD: "secret",
        APP_AUTH_REDIRECT_TIMEOUT_MS: "60000",
        APP_AUTH_FORCED_NAVIGATION_TIMEOUT_MS: "15000",
      });

      assert.equal(authConfig.redirectTimeoutMs, 60000);
      assert.equal(authConfig.forcedNavigationTimeoutMs, 15000);
    },
  },
  {
    name: "buildAuthenticatedWebsiteBrief preserves authenticated discovery details",
    run() {
      const brief = buildAuthenticatedWebsiteBrief("https://example.com/app", {
        landingUrl: "https://example.com/app/dashboard",
        loginUrl: "https://example.com/login",
        sidebarModules: ["Dashboard", "Reports"],
        notablePaths: ["/app/dashboard", "/app/reports"],
        featureCandidates: [{ feature: "Dashboard", evidence: ["https://example.com/app/dashboard"] }],
        pages: [
          {
            url: "https://example.com/app/dashboard",
            title: "Dashboard",
            bodyPreview: "Main dashboard overview",
            headings: ["Dashboard"],
            buttons: ["Create report"],
            forms: [],
            cards: ["Revenue"],
            sidebarModules: ["Dashboard", "Reports"],
            links: [
              { text: "Reports", href: "/app/reports" },
              { text: "External", href: "https://other.example.com/out" },
            ],
          },
        ],
        discoveredAt: "2026-04-19T00:00:00.000Z",
      });

      assert.equal(brief.source, "authenticated-app-discovery");
      assert.equal(brief.entryUrl, "https://example.com/app/dashboard");
      assert.equal(brief.loginUrl, "https://example.com/login");
      assert.deepEqual(brief.sidebarModules, ["Dashboard", "Reports"]);
      assert.deepEqual(brief.pages[0].importantLinks, [
        { text: "Reports", href: "https://example.com/app/reports" },
      ]);
      assert.match(brief.summary, /Visible modules: Dashboard, Reports\./);
    },
  },
  {
    name: "ensureAuthenticatedSession skips login when the authenticated shell is already visible",
    async run() {
      const authConfig = createAuthConfig();
      const page = new FakePage({
        loginUrl: authConfig.loginUrl,
        websiteUrl: authConfig.websiteUrl,
        postLoginUrl: authConfig.postLoginUrl,
        initialScene: "authenticated",
        scenes: {
          authenticated: {
            url: "https://example.com/app",
            title: "Dashboard",
            sidebarModules: ["Dashboard", "Reports"],
            elements: {
              nav: { visible: true, text: "Dashboard Reports" },
            },
          },
        },
      });

      const session = await ensureAuthenticatedSession(page, authConfig, { skipNavigation: true });

      assert.equal(session.authenticated, true);
      assert.equal(session.loginAttempted, false);
      assert.deepEqual(session.sidebarModules, ["Dashboard", "Reports"]);
    },
  },
  {
    name: "ensureAuthenticatedSession forces navigation when login succeeds but redirect stalls on the login page",
    async run() {
      const authConfig = createAuthConfig();
      const page = new FakePage({
        loginUrl: authConfig.loginUrl,
        websiteUrl: authConfig.websiteUrl,
        postLoginUrl: authConfig.postLoginUrl,
        scenes: {
          blank: {
            url: "about:blank",
            title: "",
            elements: {},
          },
          login: {
            url: "https://example.com/login",
            title: "Sign in",
            afterSubmit: "redirecting",
            onLandingGoto: "authenticated",
            elements: {
              'input[type="email"]': { visible: true },
              'input[type="password"]': { visible: true },
              'button[type="submit"]': { visible: true, action: "submit" },
            },
          },
          redirecting: {
            url: "https://example.com/login",
            title: "Sign in",
            onLandingGoto: "authenticated",
            redirectTexts: ["Welcome back. Redirecting to dashboard."],
            elements: {
              'input[type="email"]': { visible: true },
              'input[type="password"]': { visible: true },
              'button[type="submit"]': { visible: true, action: "submit" },
            },
          },
          authenticated: {
            url: "https://example.com/app",
            title: "Dashboard",
            sidebarModules: ["Dashboard", "Reports"],
            elements: {
              nav: { visible: true, text: "Dashboard Reports" },
            },
          },
        },
      });

      const session = await ensureAuthenticatedSession(page, authConfig);

      assert.equal(session.authenticated, true);
      assert.equal(session.loginAttempted, true);
      assert.equal(page.gotoHistory.at(-1), "https://example.com/app");
      assert.deepEqual(session.sidebarModules, ["Dashboard", "Reports"]);
    },
  },
  {
    name: "ensureAuthenticatedSession forces navigation even when a loose success marker appears before leaving login",
    async run() {
      const authConfig = createAuthConfig();
      const page = new FakePage({
        loginUrl: authConfig.loginUrl,
        websiteUrl: authConfig.websiteUrl,
        postLoginUrl: authConfig.postLoginUrl,
        scenes: {
          blank: {
            url: "about:blank",
            title: "",
            elements: {},
          },
          login: {
            url: "https://example.com/login",
            title: "Sign in",
            afterSubmit: "redirecting-with-marker",
            onLandingGoto: "authenticated",
            elements: {
              'input[type="email"]': { visible: true },
              'input[type="password"]': { visible: true },
              'button[type="submit"]': { visible: true, action: "submit" },
            },
          },
          "redirecting-with-marker": {
            url: "https://example.com/login",
            title: "Sign in",
            onLandingGoto: "authenticated",
            redirectTexts: ["Welcome back. Redirecting to dashboard."],
            elements: {
              'input[type="email"]': { visible: true },
              'input[type="password"]': { visible: true },
              'button[type="submit"]': { visible: true, action: "submit" },
              nav: { visible: true, text: "Welcome back. Redirecting to dashboard." },
            },
          },
          authenticated: {
            url: "https://example.com/app",
            title: "Dashboard",
            sidebarModules: ["Dashboard", "Reports"],
            elements: {
              nav: { visible: true, text: "Dashboard Reports" },
            },
          },
        },
      });

      const session = await ensureAuthenticatedSession(page, authConfig);

      assert.equal(session.authenticated, true);
      assert.equal(page.gotoHistory.at(-1), "https://example.com/app");
      assert.deepEqual(session.sidebarModules, ["Dashboard", "Reports"]);
    },
  },
  {
    name: "ensureAuthenticatedSession surfaces redirect_stalled_on_login when forced navigation still cannot reach the app shell",
    async run() {
      const authConfig = createAuthConfig();
      const page = new FakePage({
        loginUrl: authConfig.loginUrl,
        websiteUrl: authConfig.websiteUrl,
        postLoginUrl: authConfig.postLoginUrl,
        scenes: {
          blank: {
            url: "about:blank",
            title: "",
            elements: {},
          },
          login: {
            url: "https://example.com/login",
            title: "Sign in",
            afterSubmit: "redirecting",
            onLandingGoto: "redirecting",
            elements: {
              'input[type="email"]': { visible: true },
              'input[type="password"]': { visible: true },
              'button[type="submit"]': { visible: true, action: "submit" },
            },
          },
          redirecting: {
            url: "https://example.com/login",
            title: "Sign in",
            onLandingGoto: "redirecting",
            redirectTexts: ["Redirecting to dashboard"],
            errorTexts: ["Your session is still being prepared."],
            bodyText: "Redirecting to dashboard. Please wait.",
            elements: {
              'input[type="email"]': { visible: true },
              'input[type="password"]': { visible: true },
              'button[type="submit"]': { visible: true, action: "submit" },
            },
          },
        },
      });

      await assert.rejects(
        ensureAuthenticatedSession(page, authConfig),
        (error) => {
          assert.ok(error instanceof AuthenticationError);
          assert.equal(error.details.transitionState, "redirect_stalled_on_login");
          assert.match(error.message, /STATE=redirect_stalled_on_login/);
          return true;
        }
      );
    },
  },
];

let failures = 0;

for (const entry of cases) {
  try {
    await entry.run();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error?.stack || error?.message || String(error));
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS ${cases.length} tests`);
}
