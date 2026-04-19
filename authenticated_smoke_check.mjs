import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  AuthenticationError,
  buildAuthConfig,
  captureAuthenticatedUiState,
  ensureAuthenticatedSession,
  validateAuthConfig,
} from "./agent/authenticated-app-session.mjs";

const root = process.cwd();
const testResultsDir = path.join(root, "test-results");
const outputPath = path.join(testResultsDir, "auth-smoke.json");

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const rawUrl = cleanText(process.argv[2] || process.env.WEBSITE_URL || "");
  if (!rawUrl) {
    throw new Error("A website URL is required for the authenticated smoke check.");
  }

  const websiteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const authConfig = buildAuthConfig(websiteUrl);
  const missing = authConfig.requireAuth ? validateAuthConfig(authConfig) : [];

  await fs.mkdir(testResultsDir, { recursive: true });

  if (missing.length) {
    throw new AuthenticationError(`Missing required authentication configuration: ${missing.join(", ")}`, {
      missing,
    });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    const session = await ensureAuthenticatedSession(page, authConfig);
    const uiState = await captureAuthenticatedUiState(page, authConfig);
    const result = {
      status: "passed",
      websiteUrl,
      loginUrl: authConfig.loginUrl,
      postLoginUrl: authConfig.postLoginUrl,
      authenticated: session.authenticated,
      currentUrl: uiState.currentUrl,
      title: uiState.currentTitle,
      authMarkers: uiState.markerTexts || [],
      sidebarModules: uiState.sidebarModules || [],
      checkedAt: new Date().toISOString(),
    };
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failure = {
      status: "failed",
      websiteUrl,
      loginUrl: authConfig.loginUrl,
      postLoginUrl: authConfig.postLoginUrl,
      classification: error?.classification || "authentication_access_issue",
      error: cleanText(error?.message || error),
      checkedAt: new Date().toISOString(),
    };
    await fs.writeFile(outputPath, JSON.stringify(failure, null, 2), "utf8");
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
