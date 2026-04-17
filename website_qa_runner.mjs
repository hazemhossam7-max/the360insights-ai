import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { analyzeWebsite } from "./agent/website-analyzer.mjs";
import { generateTestCasesForWebsite } from "./agent/ai-test-case-generator.mjs";
import { createAzureDevOpsClient } from "./agent/azure-devops-client.mjs";
import { createTestPlansClient } from "./agent/testplans-client.mjs";

const root = process.cwd();
const bugDir = path.join(root, "bug_reports");
const testResultsDir = path.join(root, "test-results");
const reportPath = path.join(bugDir, "latest_website_automation.json");
const junitPath = path.join(testResultsDir, "junit.xml");

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      if (/^\$\([^)]+\)$/.test(trimmed) || /^\$\{[^}]+\}$/.test(trimmed)) {
        continue;
      }
      return trimmed;
    }
  }
  return "";
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)) {
    return parsed;
  }
  return null;
}

function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function parseAzureDevOpsProjectUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { orgUrl: "", project: "" };
  }

  try {
    const url = new URL(raw);
    const segments = url.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const orgName = segments[0] || "";
    const project = segments[1] || "";
    const orgUrl = orgName ? `${url.origin}/${orgName}` : url.origin;
    return { orgUrl, project };
  } catch {
    return { orgUrl: "", project: "" };
  }
}

function buildAzureDevOpsConfig() {
  const projectUrl = readEnv("AZDO_PROJECT_URL");
  const parsedProjectUrl = parseAzureDevOpsProjectUrl(projectUrl);

  return {
    orgUrl: readEnv(
      "AZDO_ORG_URL",
      "SYSTEM_TEAMFOUNDATIONCOLLECTIONURI",
      "SYSTEM_COLLECTIONURI",
      parsedProjectUrl.orgUrl
    ),
    project: readEnv("AZDO_PROJECT", "SYSTEM_TEAMPROJECT", parsedProjectUrl.project),
    pat: readEnv("AZDO_PAT"),
    accessToken: readEnv("SYSTEM_ACCESSTOKEN"),
    projectUrl,
  };
}

const FOCUS_STOPWORDS = new Set([
  "verify",
  "display",
  "displayed",
  "displaying",
  "show",
  "shown",
  "shows",
  "check",
  "ensure",
  "confirm",
  "validate",
  "data",
  "information",
  "details",
  "section",
  "area",
  "panel",
  "page",
  "view",
  "visible",
  "clearly",
  "legibly",
  "successfully",
  "indicating",
  "successful",
  "retrieval",
  "rendering",
  "loaded",
  "loads",
  "within",
  "its",
  "their",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "on",
  "in",
  "by",
  "with",
  "is",
  "are",
  "be",
  "was",
  "were",
  "e.g",
  "eg",
]);

function normalizeFocusText(value) {
  return cleanText(String(value || ""))
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(e\.g\.|for example)\b/gi, " ")
    .replace(/\b(is|are|was|were|be|been|being)\s+(displayed|shown|rendered|presented|visible)\b/gi, " ")
    .replace(/\bwithin its designated section\b/gi, " ")
    .replace(/\bindicating\b.*$/i, " ")
    .replace(/\bthat\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFocusAliases(testCase) {
  const rawCandidates = [
    cleanText(testCase?.title || ""),
    cleanText(testCase?.sourceCriterion || ""),
    cleanText(testCase?.expectedResult || ""),
  ].filter(Boolean);

  const aliases = new Set();

  for (const raw of rawCandidates) {
    let text = normalizeFocusText(raw)
      .replace(/^[Vv]erify\s+/g, "")
      .replace(/^[Dd]isplay\s+of\s+/g, "")
      .replace(/^[Dd]isplay\s+/g, "")
      .replace(/^[Vv]erify\s+[Dd]isplay\s+of\s+/g, "")
      .replace(/\b(under|within|less than|more than|no more than)\b.*$/i, "")
      .trim();

    if (!text) {
      continue;
    }

    const words = text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((word) => word.trim())
      .filter((word) => word && !FOCUS_STOPWORDS.has(word));

    if (!words.length) {
      continue;
    }

    const joined = words.join(" ");
    aliases.add(joined);

    for (let size = Math.min(5, words.length); size >= 2; size -= 1) {
      aliases.add(words.slice(0, size).join(" "));
    }

    if (joined.endsWith(" data")) {
      aliases.add(joined.replace(/\s+data$/i, ""));
    }
    if (joined.endsWith(" information")) {
      aliases.add(joined.replace(/\s+information$/i, ""));
    }
  }

  return Array.from(aliases).filter(Boolean);
}

function textIncludesAny(text, aliases) {
  const haystack = cleanText(text).toLowerCase();
  return aliases.some((alias) => haystack.includes(alias.toLowerCase()));
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
  if (/typical user flow|user flow|workflow|works for a typical/.test(text)) {
    return "flow";
  }
  if (/call to action|call-to-action|cta|navigation elements|essential navigation|menu|links/.test(text)) {
    return "cta";
  }
  if (/content accuracy|content consistency|summary|consistency with summary|accuracy/.test(text)) {
    return "content";
  }
  if (/content|branding|headline|hero/.test(text)) {
    return "branding";
  }
  if (/navigation|route|page|path/.test(text)) {
    return "navigation";
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

function parseStepsFromHtml(stepsHtml) {
  const html = String(stepsHtml || "");
  if (!html) {
    return [];
  }

  const stepMatches = Array.from(
    html.matchAll(/<step\b[\s\S]*?<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/gi)
  );

  return stepMatches
    .map((match) =>
      cleanText(
        String(match?.[1] || "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/<[^>]+>/g, " ")
      )
    )
    .filter(Boolean);
}

async function collectSuiteIds(client, planId) {
  const ids = new Set();
  let continuationToken = "";

  do {
    const page = await client.listTestSuitesForPlan({
      planId,
      asTreeView: true,
      continuationToken,
    });

    const stack = Array.isArray(page.suites) ? [...page.suites] : [];
    while (stack.length) {
      const suite = stack.pop();
      const suiteId = parsePositiveInteger(suite?.id);
      if (suiteId) {
        ids.add(suiteId);
      }
      const children = Array.isArray(suite?.children) ? suite.children : [];
      for (const child of children) {
        stack.push(child);
      }
    }

    continuationToken = String(page.continuationToken || "").trim();
  } while (continuationToken);

  return Array.from(ids);
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

async function verifyCtaPresence(page, websiteBrief) {
  await goHome(page, websiteBrief.url);
  const linkCount = await page.locator("a").count();
  const buttonCount = await page.locator("button,[role='button']").count();
  await assert(linkCount + buttonCount > 0, "No navigation or call-to-action elements were found.");
  await assert(Boolean(cleanText(await page.title()) || (await bodyText(page))), "The page content is empty.");
}

function summarizeContentFocus(websiteBrief) {
  const parts = [websiteBrief?.summary, ...(websiteBrief?.featureCandidates || []).map((item) => item?.feature)];
  return Array.from(
    new Set(
      parts
        .map((value) => cleanText(value).toLowerCase())
        .filter(Boolean)
    )
  );
}

async function writeJunitReport(summary) {
  const testCaseXml = summary.results
    .map((item) => {
      const name = `${item.id} - ${item.title}`;
      const failure =
        item.status === "failed"
          ? `\n      <failure message="${escapeXml(item.error || "Test failed")}">${escapeXml(
              item.error || "Test failed"
            )}</failure>`
          : "";

      return [
        `    <testcase classname="website-${escapeXml(summary.websiteBrief?.host || "site")}" name="${escapeXml(name)}" time="0.00">`,
        failure,
        "    </testcase>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const junitXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Website Automation" tests="${summary.total}" failures="${summary.failed}" errors="0" skipped="0">
  <testsuite name="Website Automation" tests="${summary.total}" failures="${summary.failed}" errors="0" skipped="0">
${testCaseXml}
  </testsuite>
</testsuites>
`;

  await fs.writeFile(junitPath, junitXml, "utf8");
}

async function uploadGeneratedCases(websiteBrief, testCaseDrafts) {
  const config = buildAzureDevOpsConfig();
  const planId = parsePositiveInteger(readEnv("AZDO_TEST_PLAN_ID"));
  if (!config.orgUrl || !config.project || !planId) {
    return null;
  }

  const client = createTestPlansClient(config);
  const plan = await client.getTestPlan(planId);
  const rootSuiteId = parsePositiveInteger(plan?.rootSuite?.id);
  if (!rootSuiteId) {
    throw new Error(`Azure DevOps plan ${planId} does not expose a valid root suite.`);
  }

  let suiteId = parsePositiveInteger(readEnv("AZDO_TEST_SUITE_ID"));
  if (!suiteId) {
    const suiteName = `${cleanText(websiteBrief?.title || websiteBrief?.host || "Website")} (${new Date().toISOString().slice(0, 10)})`;
    const suite = await client.createTestSuite({
      planId,
      parentSuiteId: rootSuiteId,
      name: suiteName,
    });
    suiteId = parsePositiveInteger(suite?.id);
  }

  if (!suiteId) {
    throw new Error("A valid Azure DevOps suite id could not be resolved.");
  }

  const createdIds = [];
  const failedCases = [];
  for (const testCase of testCaseDrafts.testCases || []) {
    try {
      const created = await client.createTestCaseWorkItem({
        title: testCase.title,
        steps: testCase.steps || [],
        expectedResult: testCase.expectedResult || "",
      });
      if (created?.id) {
        createdIds.push(created.id);
      }
    } catch (error) {
      failedCases.push({
        title: testCase?.title || "",
        error: error.message,
      });
    }
  }

  if (createdIds.length) {
    await client.addTestCasesToSuite({
      planId,
      suiteId,
      testCaseIds: createdIds,
    });
  }

  return {
    planId,
    suiteId,
    createdIds,
    failedCases,
  };
}

async function loadExistingAzureDevOpsCases() {
  const config = buildAzureDevOpsConfig();
  const planId = parsePositiveInteger(readEnv("AZDO_TEST_PLAN_ID"));
  if (!config.orgUrl || !config.project || !planId) {
    throw new Error("AZDO_TEST_PLAN_ID plus Azure DevOps project configuration are required to run existing suite cases.");
  }

  const testPlansClient = createTestPlansClient(config);
  const azureDevOpsClient = createAzureDevOpsClient(config);
  const explicitSuiteId = parsePositiveInteger(readEnv("AZDO_TEST_SUITE_ID"));
  const suiteIds = explicitSuiteId ? [explicitSuiteId] : await collectSuiteIds(testPlansClient, planId);
  const seenPointIds = new Set();
  const testCases = [];

  for (const suiteId of suiteIds) {
    let continuationToken = "";
    do {
      const page = await testPlansClient.getSuiteTestCases({
        planId,
        suiteId,
        isRecursive: false,
        continuationToken,
      });

      for (const suiteCase of page.testCases) {
        const pointId = Number(suiteCase?.pointId || 0);
        const workItemId = Number(suiteCase?.workItemId || suiteCase?.id || 0);
        if (!Number.isFinite(pointId) || pointId <= 0 || seenPointIds.has(pointId)) {
          continue;
        }
        if (!Number.isFinite(workItemId) || workItemId <= 0) {
          continue;
        }

        seenPointIds.add(pointId);
        const workItem = await azureDevOpsClient.getWorkItem(workItemId);
        const steps = parseStepsFromHtml(workItem.stepsHtml);
        testCases.push({
          id: workItem.id,
          pointId,
          planId,
          suiteId,
          title: workItem.title,
          sourceCriterion: cleanText(workItem.acceptanceCriteria || workItem.description || workItem.title),
          steps,
          expectedResult: "",
        });
      }

      continuationToken = String(page.continuationToken || "").trim();
    } while (continuationToken);
  }

  return {
    planId,
    suiteIds,
    testCases,
  };
}

async function publishGeneratedCaseResults(azureUpload, testCaseDrafts, results) {
  const planId = parsePositiveInteger(azureUpload?.planId);
  const suiteId = parsePositiveInteger(azureUpload?.suiteId);
  if (!planId || !suiteId) {
    return null;
  }

  const createdIds = new Set(
    (Array.isArray(azureUpload?.createdIds) ? azureUpload.createdIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  if (!createdIds.size) {
    return { updated: [], skipped: 0 };
  }

  const config = buildAzureDevOpsConfig();
  if (!config.orgUrl || !config.project) {
    return { updated: [], skipped: createdIds.size, error: "Azure DevOps configuration is incomplete." };
  }

  const client = createTestPlansClient(config);
  const suiteCases = [];
  let continuationToken = "";
  do {
    const page = await client.getSuiteTestCases({
      planId,
      suiteId,
      isRecursive: true,
      continuationToken,
    });
    suiteCases.push(...page.testCases);
    continuationToken = String(page.continuationToken || "").trim();
  } while (continuationToken);

  const pointByWorkItemId = new Map();
  for (const suiteCase of suiteCases) {
    const workItemId = Number(suiteCase?.workItemId || suiteCase?.id);
    const pointId = Number(suiteCase?.pointId);
    if (Number.isFinite(workItemId) && workItemId > 0 && Number.isFinite(pointId) && pointId > 0) {
      pointByWorkItemId.set(workItemId, pointId);
    }
  }

  const pointUpdates = [];
  for (const result of Array.isArray(results) ? results : []) {
    const workItemId = Number(result?.id);
    if (!createdIds.has(workItemId)) {
      continue;
    }
    const pointId = pointByWorkItemId.get(workItemId);
    if (!pointId) {
      continue;
    }

    pointUpdates.push({
      id: pointId,
      outcome: result?.status === "passed" ? "passed" : "failed",
    });
  }

  if (!pointUpdates.length) {
    return {
      updated: [],
      skipped: createdIds.size,
      suiteCases: suiteCases.length,
    };
  }

  const updated = await client.updateTestPoints({
    planId,
    suiteId,
    pointUpdates,
  });

  return {
    updated,
    updatedCount: pointUpdates.length,
    suiteCases: suiteCases.length,
  };
}

async function publishExistingCaseResults(loadedCases, results) {
  const pointUpdatesBySuite = new Map();

  for (const result of Array.isArray(results) ? results : []) {
    const suiteId = parsePositiveInteger(result?.suiteId);
    const pointId = parsePositiveInteger(result?.pointId);
    if (!suiteId || !pointId) {
      continue;
    }

    if (!pointUpdatesBySuite.has(suiteId)) {
      pointUpdatesBySuite.set(suiteId, []);
    }
    pointUpdatesBySuite.get(suiteId).push({
      id: pointId,
      outcome: result?.status === "passed" ? "passed" : "failed",
    });
  }

  const config = buildAzureDevOpsConfig();
  if (!config.orgUrl || !config.project) {
    return { updatedSuites: [], error: "Azure DevOps configuration is incomplete." };
  }

  const client = createTestPlansClient(config);
  const updates = [];
  for (const [suiteId, pointUpdates] of pointUpdatesBySuite.entries()) {
    const response = await client.updateTestPoints({
      planId: loadedCases.planId,
      suiteId,
      pointUpdates,
    });
    updates.push({
      suiteId,
      pointCount: pointUpdates.length,
      response,
    });
  }

  return {
    updatedSuites: updates,
    updatedCount: updates.reduce((sum, item) => sum + item.pointCount, 0),
  };
}

async function verifyContentConsistency(page, websiteBrief) {
  await goHome(page, websiteBrief.url);
  const title = cleanText(await page.title()).toLowerCase();
  const body = (await bodyText(page)).toLowerCase();
  const keywords = summarizeContentFocus(websiteBrief);

  await assert(Boolean(title) || Boolean(body), "The page content is empty.");

  if (keywords.length && keywords.some((keyword) => title.includes(keyword) || body.includes(keyword))) {
    return;
  }

  await assert((await page.locator("h1, h2, h3").count()) > 0, "No visible headings were found.");
}

async function verifyNavigation(page, websiteBrief, testCase) {
  const aliases = extractFocusAliases(testCase);
  const paths = candidatePaths(websiteBrief);
  const match =
    paths.find((item) => aliases.some((alias) => item.toLowerCase().includes(alias.toLowerCase()))) || paths[0];

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
    .filter({ hasText: new RegExp(escapeRegExp(aliases[0] || cleanText(testCase?.title || "")), "i") })
    .first();

  if (await link.count()) {
    await link.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await assert(Boolean(cleanText(await page.title())), `The navigated page for ${aliases[0] || "navigation target"} has no title.`);
    return;
  }

  throw new Error(`Could not find a navigation target for "${aliases[0] || cleanText(testCase?.title || "target")}".`);
}

async function verifyFeature(page, websiteBrief, testCase) {
  const aliases = extractFocusAliases(testCase);
  await goHome(page, websiteBrief.url);

  const title = cleanText(await page.title());
  const body = await bodyText(page);
  const pageText = `${title}\n${body}`;
  if (aliases.length && textIncludesAny(pageText, aliases)) {
    return;
  }

  const interactive = page
    .locator("a,button,[role='button']")
    .filter({ hasText: new RegExp(escapeRegExp(aliases[0] || cleanText(testCase?.title || "")), "i") })
    .first();

  if (await interactive.count()) {
    await interactive.click().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const updatedBody = await bodyText(page);
    await assert(
      textIncludesAny(`${cleanText(await page.title())}\n${updatedBody}`, aliases) || cleanText(await page.title()),
      `The feature flow for "${aliases[0] || cleanText(testCase?.title || "target")}" did not become visible after interaction.`
    );
    return;
  }

  const paths = candidatePaths(websiteBrief);
  const pathMatch = paths.find((item) => aliases.some((alias) => item.toLowerCase().includes(alias.toLowerCase())));
  if (pathMatch) {
    const response = await page.goto(new URL(pathMatch, websiteBrief.url).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await assert(!response || response.status() < 500, `Feature page returned HTTP ${response?.status() || "unknown"}.`);
    return;
  }

  throw new Error(`Could not validate the "${aliases[0] || cleanText(testCase?.title || "target")}" feature on the site.`);
}

async function verifyFlow(page, websiteBrief, testCase) {
  const aliases = extractFocusAliases(testCase);
  await goHome(page, websiteBrief.url);

  const title = cleanText(await page.title());
  const body = await bodyText(page);
  const interactiveCount = await page.locator("a,button,[role='button']").count();

  await assert(Boolean(title), "The page title is empty.");
  await assert(Boolean(body), "The page body is empty.");
  await assert(interactiveCount > 0, "No interactive elements were found for the user flow check.");

  const meaningfulAlias = aliases.find((alias) => alias.length >= 4) || "";
  if (meaningfulAlias) {
    const interactive = page
      .locator("a,button,[role='button']")
      .filter({ hasText: new RegExp(escapeRegExp(meaningfulAlias), "i") })
      .first();

    if (await interactive.count()) {
      await interactive.click().catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await assert(Boolean(cleanText(await page.title()) || (await bodyText(page))), "The clicked flow target led to an empty page.");
      return;
    }
  }

  const paths = candidatePaths(websiteBrief);
  if (paths.length) {
    const response = await page.goto(new URL(paths[0], websiteBrief.url).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await assert(!response || response.status() < 500, `User flow page returned HTTP ${response?.status() || "unknown"}.`);
    await assert(Boolean(cleanText(await page.title()) || (await bodyText(page))), "The flow destination page was empty.");
  }
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
    case "cta":
      return verifyCtaPresence(page, websiteBrief);
    case "content":
      return verifyContentConsistency(page, websiteBrief);
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
    case "flow":
      return verifyFlow(page, websiteBrief, testCase);
    default:
      return verifyFeature(page, websiteBrief, testCase);
  }
}

async function generateWebsiteDrafts(websiteBrief, options) {
  const sharedOptions = {
    provider: options.provider || "openai",
    apiKey: options.openAiApiKey,
    model: options.openAiModel || "gpt-4o-mini",
    baseUrl: options.openAiBaseUrl || "",
    geminiApiKey: options.geminiApiKey || "",
    geminiModel: options.geminiModel || "",
    geminiBaseUrl: options.geminiBaseUrl || "",
  };

  return generateTestCasesForWebsite(websiteBrief, {
    ...sharedOptions,
    allowHeuristicFallback: "true",
  });
}

async function main() {
  const rawUrl = String(process.argv[2] || process.env.WEBSITE_URL || "").trim();
  if (!rawUrl) {
    throw new Error("A website URL is required. Pass it as an argument or set WEBSITE_URL.");
  }

  const websiteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const aiProvider = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const openAiModel = String(process.env.OPENAI_MODEL || "").trim();
  const openAiBaseUrl = String(process.env.OPENAI_BASE_URL || "").trim();
  const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const geminiModel = String(process.env.GEMINI_MODEL || "").trim();
  const geminiBaseUrl = String(process.env.GEMINI_BASE_URL || "").trim();
  const websiteTargetCaseCount = parsePositiveInteger(readEnv("WEBSITE_TARGET_CASE_COUNT")) || 1000;
  const runExistingSuiteCasesOnly = isTruthyEnv(readEnv("RUN_EXISTING_AZDO_CASES_ONLY"));
  const provider = aiProvider === "gemini" || aiProvider === "openai"
    ? aiProvider
    : openAiApiKey
      ? "openai"
      : "gemini";

  if (!runExistingSuiteCasesOnly && provider === "openai" && !openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for automated website generation.");
  }
  if (!runExistingSuiteCasesOnly && provider === "gemini" && !geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required for automated website generation.");
  }

  await fs.mkdir(bugDir, { recursive: true });
  await fs.mkdir(testResultsDir, { recursive: true });

  const websiteBrief = await analyzeWebsite(websiteUrl);
  const loadedCases = runExistingSuiteCasesOnly ? await loadExistingAzureDevOpsCases() : null;
  const testCaseDrafts = runExistingSuiteCasesOnly
    ? {
        generationSource: "azure-devops-suite",
        testCases: loadedCases?.testCases || [],
      }
    : await generateWebsiteDrafts(websiteBrief, {
        provider,
        openAiApiKey,
        openAiModel,
        openAiBaseUrl,
        geminiApiKey,
        geminiModel,
        geminiBaseUrl,
        websiteTargetCaseCount,
      });
  const azureUpload = runExistingSuiteCasesOnly
    ? {
        planId: loadedCases?.planId || null,
        suiteIds: loadedCases?.suiteIds || [],
        existingCaseCount: loadedCases?.testCases?.length || 0,
      }
    : await uploadGeneratedCases(websiteBrief, testCaseDrafts).catch((error) => ({
        error: error.message,
      }));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const failures = [];
  const results = [];

  try {
    for (let index = 0; index < testCaseDrafts.testCases.length; index += 1) {
      const testCase = testCaseDrafts.testCases[index];
      try {
        await runGeneratedCase(page, websiteBrief, testCase, index);
        results.push({
          id: testCase.id,
          pointId: testCase.pointId || null,
          suiteId: testCase.suiteId || null,
          title: testCase.title,
          status: "passed",
        });
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
          pointId: testCase.pointId || null,
          suiteId: testCase.suiteId || null,
          title: testCase.title,
          actual: error.message,
          screenshot: screenshotPath,
          bugReport: markdownPath,
        });
        results.push({
          id: testCase.id,
          pointId: testCase.pointId || null,
          suiteId: testCase.suiteId || null,
          title: testCase.title,
          status: "failed",
          error: error.message,
        });
      }
    }
  } finally {
    await browser.close();
  }

  const summary = {
    websiteUrl: websiteBrief.url,
    aiProvider: provider,
    generationSource: testCaseDrafts.generationSource,
    azureUpload,
    total: testCaseDrafts.testCases.length,
    passed: results.filter((item) => item.status === "passed").length,
    failed: failures.length,
    websiteBrief,
    testCases: testCaseDrafts.testCases,
    results,
    failures,
  };

  const azureResultPublish = await (
    runExistingSuiteCasesOnly
      ? publishExistingCaseResults(loadedCases, results)
      : publishGeneratedCaseResults(azureUpload, testCaseDrafts, results)
  ).catch((error) => ({
    error: error.message,
  }));
  summary.azureResultPublish = azureResultPublish;

  await writeJunitReport(summary);
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");

  if (failures.length > 0) {
    console.error(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
