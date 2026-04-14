import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { analyzeWebsite } from "./agent/website-analyzer.mjs";
import { generateTestCasesForWebsite } from "./agent/ai-test-case-generator.mjs";

const root = process.cwd();
const bugDir = path.join(root, "bug_reports");
const reportPath = path.join(bugDir, "latest_website_automation.json");

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferCaseKind(testCase, index) {
  const text = cleanText(
    [testCase?.title, testCase?.sourceCriterion, ...(testCase?.steps || []), testCase?.expectedResult]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  if (index === 0 || /home page|landing page|home loads|branding/.test(text)) {
    return "home";
  }
  if (/responsive|viewport|mobile|desktop/.test(text)) {
    return "responsive";
  }
  if (/accessibility|keyboard|aria|label|readable/.test(text)) {
    return "accessibility";
  }
  if (/error|invalid|empty state|unavailable|not found|graceful/.test(text)) {
    return "error";
  }
  if (/navigation|route|page|path/.test(text)) {
    return "navigation";
  }
  if (/content|branding|headline|hero/.test(text)) {
    return "branding";
  }
  if (/performance|load time|page load|response time|latency|speed|fast|slow/.test(text)) {
    return "performance";
  }

  return "feature";
}

function parsePerformanceBudgetMs(testCase) {
  const text = cleanText(
    [testCase?.title, testCase?.sourceCriterion, ...(testCase?.steps || []), testCase?.expectedResult]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  const rangeMatch = text.match(/(?:under|within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*seconds?/i);
  if (rangeMatch) {
    return Math.round(Number(rangeMatch[2]) * 1000);
  }

  const singleMatch = text.match(/(?:under|within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*seconds?/i);
  if (singleMatch) {
    return Math.round(Number(singleMatch[1]) * 1000);
  }

  const msMatch = text.match(/(?:under|within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*ms\b/i);
  if (msMatch) {
    return Math.round(Number(msMatch[1]));
  }

  return 5000;
}

async function bodyText(page) {
  return cleanText((await page.locator("body").innerText().catch(() => "")) || "");
}

async function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function goHome(page, websiteUrl) {
  const response = await page.goto(websiteUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await assert(!response || response.status() < 500, `Home page returned HTTP ${response?.status() || "unknown"}.`);
  return response;
}

function candidatePaths(websiteBrief) {
  return Array.from(
    new Set(
      (websiteBrief?.notablePaths || [])
        .map((value) => cleanText(value))
        .filter(Boolean)
    )
  );
}

async function verifyHomePage(page, websiteBrief) {
  await goHome(page, websiteBrief.url);
  const title = cleanText(await page.title());
  const body = await bodyText(page);

  await assert(Boolean(title), "The page title is empty.");
  await assert(Boolean(body), "The home page body is empty.");
  await assert((await page.locator("h1, h2, h3").count()) > 0, "No headings were found on the home page.");
  await assert(
    (await page.locator("a,button,[role='button']").count()) > 0,
    "No obvious interactive elements were found on the home page."
  );
}

async function verifyBranding(page, websiteBrief) {
  await goHome(page, websiteBrief.url);
  const title = cleanText(await page.title()).toLowerCase();
  const body = (await bodyText(page)).toLowerCase();
  const host = cleanText(websiteBrief.host || new URL(websiteBrief.url).host).toLowerCase();
  const siteTitle = cleanText(websiteBrief.title || "").toLowerCase();

  await assert(Boolean(title), "The site title is empty.");
  await assert(
    title.includes(host) || title.includes(siteTitle) || body.includes(host) || body.includes(siteTitle),
    "The landing page does not clearly reflect the site identity."
  );
}

async function verifyNavigation(page, websiteBrief, testCase) {
  const feature = cleanText(testCase?.sourceCriterion || testCase?.title || "");
  const paths = candidatePaths(websiteBrief);
  const match = paths.find((item) => item.toLowerCase().includes(feature.toLowerCase())) || paths[0];

  await goHome(page, websiteBrief.url);

  if (match) {
    const targetUrl = new URL(match, websiteBrief.url).toString();
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await assert(
      !response || response.status() < 500,
      `Navigation to ${match} returned HTTP ${response?.status() || "unknown"}.`
    );
    await assert(Boolean(cleanText(await page.title())), `The destination page for ${match} has no title.`);
    return;
  }

  const link = page
    .locator("a")
    .filter({ hasText: new RegExp(escapeRegExp(feature), "i") })
    .first();

  if (await link.count()) {
    await link.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await assert(Boolean(cleanText(await page.title())), `The navigated page for ${feature} has no title.`);
    return;
  }

  throw new Error(`Could not find a navigation target for "${feature}".`);
}

async function verifyFeature(page, websiteBrief, testCase) {
  const feature = cleanText(testCase?.sourceCriterion || testCase?.title || "").toLowerCase();
  await goHome(page, websiteBrief.url);

  const body = await bodyText(page);
  if (feature && body.toLowerCase().includes(feature)) {
    return;
  }

  const interactive = page
    .locator("a,button,[role='button']")
    .filter({ hasText: new RegExp(escapeRegExp(feature), "i") })
    .first();

  if (await interactive.count()) {
    await interactive.click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const updatedBody = await bodyText(page);
    await assert(
      updatedBody.toLowerCase().includes(feature) || cleanText(await page.title()),
      `The feature flow for "${feature}" did not become visible after interaction.`
    );
    return;
  }

  const paths = candidatePaths(websiteBrief);
  const pathMatch = paths.find((item) => item.toLowerCase().includes(feature));
  if (pathMatch) {
    const response = await page.goto(new URL(pathMatch, websiteBrief.url).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await assert(!response || response.status() < 500, `Feature page returned HTTP ${response?.status() || "unknown"}.`);
    return;
  }

  throw new Error(`Could not validate the "${feature}" feature on the site.`);
}

async function verifyResponsive(page, websiteBrief) {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await goHome(page, websiteBrief.url);
  await assert((await page.locator("h1, h2, h3").count()) > 0, "No visible heading found in desktop view.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await assert((await page.locator("h1, h2, h3").count()) > 0, "No visible heading found in mobile view.");
  await assert(
    (await page.locator("a,button,[role='button']").count()) > 0,
    "No obvious controls were visible in mobile view."
  );
}

async function verifyAccessibility(page, websiteBrief) {
  await goHome(page, websiteBrief.url);
  const headingCount = await page.locator("h1, h2, h3").count();
  const linkCount = await page.locator("a").count();
  const buttonCount = await page.locator("button").count();
  const labelCount = await page.locator("label").count();

  await assert(headingCount > 0, "No headings were found.");
  await assert(linkCount > 0 || buttonCount > 0, "No interactive controls were found.");
  await assert(labelCount > 0 || (linkCount > 0 && buttonCount > 0), "No obvious accessible labels or controls were found.");
}

async function verifyErrorHandling(page, websiteBrief) {
  const invalidUrl = new URL(`/__codex_invalid_${Date.now()}`, websiteBrief.url).toString();
  const response = await page.goto(invalidUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await assert(
    !response || response.status() < 500,
    `Invalid path produced HTTP ${response?.status() || "unknown"} instead of a graceful response.`
  );
  await assert(Boolean(cleanText(await page.title()) || (await bodyText(page))), "Invalid-path response was empty.");
}

async function verifyPerformance(page, websiteBrief, testCase) {
  const budgetMs = parsePerformanceBudgetMs(testCase);
  const start = performance.now();
  const response = await page.goto(websiteBrief.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const elapsedMs = Math.round(performance.now() - start);
  const title = cleanText(await page.title());
  const body = await bodyText(page);

  await assert(!response || response.status() < 500, `Performance page returned HTTP ${response?.status() || "unknown"}.`);
  await assert(Boolean(title), "The page title is empty during the performance check.");
  await assert(Boolean(body), "The page body is empty during the performance check.");
  await assert(
    elapsedMs <= budgetMs,
    `Page load took ${elapsedMs}ms, which exceeds the ${budgetMs}ms performance budget.`
  );
}

async function runGeneratedCase(page, websiteBrief, testCase, index) {
  const kind = inferCaseKind(testCase, index);

  switch (kind) {
    case "home":
      return verifyHomePage(page, websiteBrief);
    case "branding":
      return verifyBranding(page, websiteBrief);
    case "navigation":
      return verifyNavigation(page, websiteBrief, testCase);
    case "responsive":
      return verifyResponsive(page, websiteBrief);
    case "accessibility":
      return verifyAccessibility(page, websiteBrief);
    case "error":
      return verifyErrorHandling(page, websiteBrief);
    case "performance":
      return verifyPerformance(page, websiteBrief, testCase);
    default:
      return verifyFeature(page, websiteBrief, testCase);
  }
}

async function main() {
  const rawUrl = String(process.argv[2] || process.env.WEBSITE_URL || "").trim();
  if (!rawUrl) {
    throw new Error("A website URL is required. Pass it as an argument or set WEBSITE_URL.");
  }

  const websiteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const aiProvider = String(process.env.AI_PROVIDER || "gemini").trim().toLowerCase();
  const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();

  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required for automated website generation.");
  }

  await fs.mkdir(bugDir, { recursive: true });

  const websiteBrief = await analyzeWebsite(websiteUrl);
  const testCaseDrafts = await generateTestCasesForWebsite(websiteBrief, {
    provider: aiProvider || "gemini",
    geminiApiKey,
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    geminiBaseUrl: process.env.GEMINI_BASE_URL || "",
    allowHeuristicFallback: process.env.ALLOW_HEURISTIC_FALLBACK || "false",
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const failures = [];
  const results = [];

  try {
    for (let index = 0; index < testCaseDrafts.testCases.length; index += 1) {
      const testCase = testCaseDrafts.testCases[index];
      try {
        await runGeneratedCase(page, websiteBrief, testCase, index);
        results.push({ id: testCase.id, title: testCase.title, status: "passed" });
      } catch (error) {
        const screenshotPath = path.join(bugDir, `website-${testCase.id}.png`);
        const markdownPath = path.join(bugDir, `website-${testCase.id}.md`);

        await page.screenshot({ path: screenshotPath, fullPage: true });
        const bugReport = `# ${testCase.id} - ${testCase.title}

## Steps
${testCase.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n")}

## Expected
${testCase.expectedResult}

## Actual
${error.message}
`;
        await fs.writeFile(markdownPath, bugReport, "utf8");

        failures.push({
          id: testCase.id,
          title: testCase.title,
          actual: error.message,
          screenshot: screenshotPath,
          bugReport: markdownPath,
        });
        results.push({ id: testCase.id, title: testCase.title, status: "failed", error: error.message });
      }
    }
  } finally {
    await browser.close();
  }

  const summary = {
    websiteUrl: websiteBrief.url,
    aiProvider: aiProvider || "gemini",
    generationSource: testCaseDrafts.generationSource,
    total: testCaseDrafts.testCases.length,
    passed: results.filter((item) => item.status === "passed").length,
    failed: failures.length,
    websiteBrief,
    testCases: testCaseDrafts.testCases,
    results,
    failures,
  };

  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");

  if (failures.length > 0) {
    console.error(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
