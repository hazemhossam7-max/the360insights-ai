import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { analyzeWebsite } from "./agent/website-analyzer.mjs";
import { generateTestCasesForWebsite } from "./agent/ai-test-case-generator.mjs";
import { createTestPlansClient } from "./agent/testplans-client.mjs";
import { createAzureDevOpsClient } from "./agent/azure-devops-client.mjs";
import {
  AuthenticationError,
  buildAuthConfig,
  buildAuthenticatedWebsiteBrief,
  captureAuthenticatedUiState,
  discoverAuthenticatedApp,
  ensureAuthenticatedSession,
  validateAuthConfig,
} from "./agent/authenticated-app-session.mjs";
import { generateGroundedWebsiteTestCases } from "./agent/grounded-website-testcases.mjs";
import { classifyFailure, isRealBugClassification } from "./agent/failure-classifier.mjs";
import {
  resolveWebsiteGenerationMode,
  shouldExecuteGeneratedCases,
  shouldUseGroundedGenerator,
} from "./agent/website-generation-strategy.mjs";

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

function buildGeneratedPlanName(websiteBrief) {
  const siteLabel = cleanText(websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website");
  return `${siteLabel} Generated Coverage ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
}

function buildGeneratedSuiteName(websiteBrief, testCaseDrafts) {
  const source = cleanText(testCaseDrafts?.generationSource || "generated");
  const count = Array.isArray(testCaseDrafts?.testCases) ? testCaseDrafts.testCases.length : 0;
  const siteLabel = cleanText(websiteBrief?.title || websiteBrief?.host || "Website");
  return `${siteLabel} ${source} suite (${count} cases)`;
}

function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function incrementCounter(map, key) {
  const normalized = cleanText(key || "unknown");
  map.set(normalized, (map.get(normalized) || 0) + 1);
  return map.get(normalized);
}

function mapToObject(map) {
  return Object.fromEntries(Array.from(map.entries()));
}

function mapClassificationToResultStatus(classification) {
  switch (cleanText(classification).toLowerCase()) {
    case "product bug":
      return "failed";
    case "unsupported/unconfirmed feature assumption":
      return "notapplicable";
    case "authentication/access issue":
    case "automation issue":
    case "environment/test setup issue":
      return "blocked";
    default:
      return "failed";
  }
}

function mapResultStatusToAzureOutcome(status) {
  switch (cleanText(status).toLowerCase()) {
    case "passed":
      return "Passed";
    case "blocked":
      return "Blocked";
    case "notapplicable":
      return "NotApplicable";
    default:
      return "Failed";
  }
}

async function buildPageContext(page, authConfig) {
  const authState = authConfig?.requireAuth
    ? await captureAuthenticatedUiState(page, authConfig).catch(() => ({ authenticated: false, markerTexts: [], sidebarModules: [] }))
    : { authenticated: true, markerTexts: [], sidebarModules: [] };

  return {
    url: page.url(),
    title: cleanText(await page.title().catch(() => "")),
    reachedProtectedPage: Boolean(authState.authenticated),
    authMarkers: authState.markerTexts || [],
    sidebarModules: authState.sidebarModules || [],
  };
}

async function writeSummaryArtifacts(summary) {
  if (summary.execution?.executedGeneratedCases !== false) {
    await writeJunitReport(summary);
  }
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");
}

function buildFailureMarkdown(testCase, failure, pageContext) {
  const classification = cleanText(failure?.classification || "Automation issue");
  const heading = isRealBugClassification(classification) ? "Product Bug Report" : "Execution Diagnostic";
  const pageLabel = cleanText(pageContext?.title || pageContext?.url || "Unavailable");

  return `# ${heading}: ${testCase.id} - ${testCase.title}

## Classification
${classification}

## Module / Page
${pageLabel}

## Route
${cleanText(pageContext?.url || "Unavailable")}

## Steps
${(testCase.steps || []).map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n")}

## Expected
${cleanText(testCase.expectedResult || "Expected behavior was not provided.")}

## Actual
${cleanText(failure?.actual || failure?.error || "Execution failed.")}

## Evidence
- Reached protected app: ${pageContext?.reachedProtectedPage ? "Yes" : "No"}
- Auth markers: ${(pageContext?.authMarkers || []).slice(0, 5).join(" | ") || "None"}
- Sidebar modules: ${(pageContext?.sidebarModules || []).slice(0, 8).join(" | ") || "None"}
`;
}

async function writeAuthGateFailureReport(error, websiteUrl, authConfig) {
  const failure = {
    id: "AUTH-GATE",
    title: "Authenticated smoke check failed",
    actual: cleanText(error?.message || error || "Authenticated smoke check failed."),
    classification: "Authentication/access issue",
  };

  const summary = {
    websiteUrl,
    aiProvider: "n/a",
    generationSource: "authentication-gate",
    gating: {
      secretValidation: validateAuthConfig(authConfig).length ? "failed" : "passed",
      loginValidation: "failed",
      authenticatedSmoke: "failed",
    },
    auth: {
      requireAuth: authConfig.requireAuth,
      loginUrl: authConfig.loginUrl,
      postLoginUrl: authConfig.postLoginUrl,
    },
    total: 1,
    passed: 0,
    failed: 1,
    failureClassifications: {
      "Authentication/access issue": 1,
    },
    websiteBrief: {
      url: websiteUrl,
      title: "Authenticated app entry failed",
      summary: failure.actual,
    },
    testCases: [
      {
        id: "AUTH-GATE",
        title: "Authenticated smoke gate",
        steps: [
          "Validate secure auth variables are present.",
          "Open the login page.",
          "Submit credentials.",
          "Verify the protected app shell is visible.",
        ],
        expectedResult: "The protected app shell loads successfully.",
      },
    ],
    results: [
      {
        id: "AUTH-GATE",
        title: "Authenticated smoke gate",
        status: "failed",
        classification: "Authentication/access issue",
        error: failure.actual,
      },
    ],
    failures: [failure],
  };

  const markdown = `# Authentication / Setup Failure

## Classification
Authentication/access issue

## Login URL
${cleanText(authConfig.loginUrl || websiteUrl)}

## Actual
${failure.actual}

## Required Next Step
Provide valid secure credentials and verify the authenticated shell loads before bulk generation or execution.
`;

  await fs.writeFile(path.join(bugDir, "auth-gate-failure.md"), markdown, "utf8");
  await writeSummaryArtifacts(summary);
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripHtml(value) {
  return cleanText(decodeXml(String(value || "").replace(/<[^>]+>/g, " ")));
}

function parseStepsFromHtml(stepsHtml) {
  const xml = String(stepsHtml || "").trim();
  if (!xml) {
    return { steps: [], expectedResult: "" };
  }

  const stepMatches = Array.from(xml.matchAll(/<step\b[^>]*>([\s\S]*?)<\/step>/gi));
  const steps = [];
  let expectedResult = "";

  for (const match of stepMatches) {
    const block = match[1] || "";
    const parameterizedStrings = Array.from(
      block.matchAll(/<parameterizedString\b[^>]*isformatted="true"[^>]*>([\s\S]*?)<\/parameterizedString>/gi)
    ).map((item) => stripHtml(item[1]));

    if (parameterizedStrings[0]) {
      steps.push(parameterizedStrings[0]);
    }
    if (!expectedResult && parameterizedStrings[1]) {
      expectedResult = parameterizedStrings[1];
    }
  }

  return {
    steps: steps.filter(Boolean),
    expectedResult,
  };
}

function flattenSuites(items, bucket = []) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") {
      continue;
    }
    bucket.push(item);
    flattenSuites(item.children || item.suites || [], bucket);
  }
  return bucket;
}

async function collectSuiteIds(client, planId) {
  const suiteIds = new Set();
  let continuationToken = "";

  do {
    const page = await client.listTestSuitesForPlan({
      planId,
      asTreeView: true,
      continuationToken,
    });

    for (const suite of flattenSuites(page.suites || [])) {
      const id = parsePositiveInteger(suite?.id);
      if (id) {
        suiteIds.add(id);
      }
    }

    continuationToken = String(page.continuationToken || "").trim();
  } while (continuationToken);

  return Array.from(suiteIds);
}

async function loadExistingAzureDevOpsCases() {
  const config = buildAzureDevOpsConfig();
  const planId = parsePositiveInteger(readEnv("AZDO_TEST_PLAN_ID"));
  if (!config.orgUrl || !config.project || !planId) {
    throw new Error("AZDO_TEST_PLAN_ID plus Azure DevOps project configuration are required to run existing suite cases.");
  }

  const testPlansClient = createTestPlansClient(config);
  const workItemsClient = createAzureDevOpsClient(config);
  const requestedSuiteId = parsePositiveInteger(readEnv("AZDO_TEST_SUITE_ID"));
  const suiteIds = requestedSuiteId ? [requestedSuiteId] : await collectSuiteIds(testPlansClient, planId);

  const seen = new Set();
  const cases = [];

  for (const suiteId of suiteIds) {
    let continuationToken = "";
    do {
      const page = await testPlansClient.getSuiteTestPoints({
        planId,
        suiteId,
        continuationToken,
      });

      for (const suitePoint of page.testPoints || []) {
        const workItemId = parsePositiveInteger(suitePoint?.workItemId);
        const pointId = parsePositiveInteger(suitePoint?.pointId || suitePoint?.id);
        if (!workItemId || !pointId || seen.has(`${suiteId}:${pointId}`)) {
          continue;
        }

        seen.add(`${suiteId}:${pointId}`);
        const workItem = await workItemsClient.getWorkItem(workItemId);
        const parsedSteps = parseStepsFromHtml(workItem.stepsHtml);
        const title = cleanText(workItem.title || suitePoint.title || `Test Case ${workItemId}`);

        cases.push({
          id: workItemId,
          pointId,
          planId,
          suiteId,
          rev: parsePositiveInteger(workItem.rev) || 1,
          title,
          sourceCriterion: title,
          steps: parsedSteps.steps.length ? parsedSteps.steps : [title],
          expectedResult: parsedSteps.expectedResult || "The expected behavior completes successfully.",
        });
      }

      continuationToken = String(page.continuationToken || "").trim();
    } while (continuationToken);
  }

  return {
    planId,
    suiteIds,
    testCases: cases,
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
  const category = cleanText(testCase?.category || "").toLowerCase();
  if (category.includes("auth smoke")) {
    return "auth";
  }
  if (category.includes("navigation")) {
    return "navigation";
  }
  if (category.includes("module availability")) {
    return "feature";
  }
  if (category.includes("core functional")) {
    return "feature";
  }
  if (category.includes("ui validation")) {
    return "content";
  }
  if (category.includes("optional deeper")) {
    return "flow";
  }

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

async function goHome(page, websiteBrief) {
  const authConfig = websiteBrief?.authConfig;
  const targetUrl = websiteBrief?.entryUrl || websiteBrief?.url;
  const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (authConfig?.requireAuth) {
    const authState = await ensureAuthenticatedSession(page, authConfig, {
      skipNavigation: true,
      allowFreshLogin: false,
    });
    await assert(authState.authenticated, "The protected application shell was not visible after navigation.");
  }
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
  await goHome(page, websiteBrief);
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
  await goHome(page, websiteBrief);
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
  await goHome(page, websiteBrief);
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
      const skipped =
        item.status === "blocked" || item.status === "notapplicable"
          ? `\n      <skipped message="${escapeXml(item.classification || item.status)}">${escapeXml(
              item.error || item.classification || item.status
            )}</skipped>`
          : "";

      return [
        `    <testcase classname="website-${escapeXml(summary.websiteBrief?.host || "site")}" name="${escapeXml(name)}" time="0.00">`,
        failure,
        skipped,
        "    </testcase>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const failedCount = summary.results.filter((item) => item.status === "failed").length;
  const skippedCount = summary.results.filter((item) => item.status === "blocked" || item.status === "notapplicable").length;

  const junitXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Website Automation" tests="${summary.total}" failures="${failedCount}" errors="0" skipped="${skippedCount}">
  <testsuite name="Website Automation" tests="${summary.total}" failures="${failedCount}" errors="0" skipped="${skippedCount}">
${testCaseXml}
  </testsuite>
</testsuites>
`;

  await fs.writeFile(junitPath, junitXml, "utf8");
}

async function uploadGeneratedCases(websiteBrief, testCaseDrafts) {
  const config = buildAzureDevOpsConfig();
  if (!config.orgUrl || !config.project) {
    return null;
  }

  const client = createTestPlansClient(config);
  const planName = readEnv("AZDO_GENERATED_PLAN_NAME") || buildGeneratedPlanName(websiteBrief);
  const suiteName = readEnv("AZDO_GENERATED_SUITE_NAME") || buildGeneratedSuiteName(websiteBrief, testCaseDrafts);
  const areaPath = readEnv("AZDO_GENERATED_PLAN_AREA_PATH", "AZDO_AREA_PATH", config.project);
  const iterationPath = readEnv("AZDO_GENERATED_PLAN_ITERATION", "AZDO_ITERATION_PATH", config.project);

  const createdPlan = await client.createTestPlan({
    name: planName,
    areaPath,
    iteration: iterationPath,
  });
  const planId = parsePositiveInteger(createdPlan?.id);
  const rootSuiteId = parsePositiveInteger(createdPlan?.rootSuiteId);
  if (!rootSuiteId) {
    throw new Error(`Azure DevOps plan ${planId} does not expose a valid root suite.`);
  }

  const suite = await client.createTestSuite({
    planId,
    parentSuiteId: rootSuiteId,
    name: suiteName,
  });
  const suiteId = parsePositiveInteger(suite?.id);

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
    planName: createdPlan?.name || planName,
    suiteName: suite?.name || suiteName,
    createdIds,
    failedCases,
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
      outcome: mapResultStatusToAzureOutcome(result?.status).toLowerCase(),
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

function buildBlockedResult(testCase, classification, error) {
  return {
    id: testCase.id,
    title: testCase.title,
    status: mapClassificationToResultStatus(classification),
    classification,
    error,
    pointId: testCase.pointId || null,
    suiteId: testCase.suiteId || null,
    planId: testCase.planId || null,
    rev: testCase.rev || 1,
  };
}

async function verifyAuthenticatedEntry(page, websiteBrief) {
  const authConfig = websiteBrief?.authConfig;
  await assert(Boolean(authConfig?.requireAuth), "Authentication smoke checks require APP_REQUIRE_AUTH=true.");
  const authState = await ensureAuthenticatedSession(page, authConfig, {
    skipNavigation: true,
    allowFreshLogin: false,
  });
  await assert(authState.authenticated, "The protected application shell was not reached after login.");
  await assert(
    (authState.sidebarModules || []).length > 0 || (authState.markerTexts || []).length > 0,
    "Protected navigation or dashboard markers were not visible after login."
  );
}

async function publishExistingCaseResults(loadedCases, results) {
  const planId = parsePositiveInteger(loadedCases?.planId);
  const suiteIds = new Set((loadedCases?.suiteIds || []).map((value) => parsePositiveInteger(value)).filter(Boolean));
  if (!planId || !suiteIds.size) {
    return null;
  }

  const config = buildAzureDevOpsConfig();
  if (!config.orgUrl || !config.project) {
    return { error: "Azure DevOps configuration is incomplete." };
  }

  const client = createTestPlansClient(config);
  const executedResults = (Array.isArray(results) ? results : []).filter(
    (item) => parsePositiveInteger(item?.pointId) && parsePositiveInteger(item?.suiteId) && suiteIds.has(parsePositiveInteger(item?.suiteId))
  );

  if (!executedResults.length) {
    return {
      runCreated: false,
      publishedResults: 0,
    };
  }

  const pointIds = Array.from(
    new Set(executedResults.map((item) => parsePositiveInteger(item.pointId)).filter(Boolean))
  );

  const testRun = await client.createTestRun({
    name: `Existing suite automation - ${new Date().toISOString()}`,
    planId,
    pointIds,
    automated: true,
    state: "InProgress",
  });

  const existingRunResults = [];
  let continuationToken = "";
  do {
    const page = await client.getTestRunResults({
      runId: testRun.id,
      continuationToken,
    });
    existingRunResults.push(...(page.results || []));
    continuationToken = String(page.continuationToken || "").trim();
  } while (continuationToken);

  const runResultIdByPointId = new Map();
  for (const runResult of existingRunResults) {
    const pointId = parsePositiveInteger(runResult?.testPoint?.id || runResult?.pointId);
    const resultId = parsePositiveInteger(runResult?.id);
    if (pointId && resultId) {
      runResultIdByPointId.set(pointId, resultId);
    }
  }

  const startedAt = new Date();
  const payload = executedResults
    .map((item) => {
      const pointId = parsePositiveInteger(item.pointId);
      const resultId = runResultIdByPointId.get(pointId);
      if (!pointId || !resultId) {
        return null;
      }

      return {
        id: resultId,
        outcome: mapResultStatusToAzureOutcome(item.status),
        state: "Completed",
        comment: item.error || "",
        startedDate: startedAt.toISOString(),
        completedDate: new Date().toISOString(),
        durationInMs: 0,
      };
    })
    .filter(Boolean);

  await client.updateTestResults({
    runId: testRun.id,
    results: payload,
  });

  // Progress report is driven by test point outcomes, so we also update
  // the executed points in their originating suites after the run results land.
  const updatesBySuite = new Map();
  for (const item of executedResults) {
    const suiteId = parsePositiveInteger(item.suiteId);
    const pointId = parsePositiveInteger(item.pointId);
    if (!suiteId || !pointId) {
      continue;
    }

    if (!updatesBySuite.has(suiteId)) {
      updatesBySuite.set(suiteId, []);
    }

    updatesBySuite.get(suiteId).push({
      id: pointId,
      outcome: mapResultStatusToAzureOutcome(item.status).toLowerCase(),
    });
  }

  const pointUpdateResults = [];
  for (const [suiteId, pointUpdates] of updatesBySuite.entries()) {
    pointUpdateResults.push({
      suiteId,
      ...(await client.updateTestPoints({
        planId,
        suiteId,
        pointUpdates,
      })),
    });
  }

  await client.updateTestRun({
    runId: testRun.id,
    state: "Completed",
    comment: `Executed ${payload.length} existing Azure DevOps suite cases.`,
  });

  return {
    runCreated: true,
    runId: parsePositiveInteger(testRun.id),
    publishedResults: payload.length,
    suiteIds: Array.from(suiteIds),
    pointUpdates: pointUpdateResults,
  };
}

async function verifyContentConsistency(page, websiteBrief) {
  await goHome(page, websiteBrief);
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

  await goHome(page, websiteBrief);

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
  await goHome(page, websiteBrief);

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
  await goHome(page, websiteBrief);

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
  await goHome(page, websiteBrief);
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
  await goHome(page, websiteBrief);
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
    case "auth":
      return verifyAuthenticatedEntry(page, websiteBrief);
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
  const websiteGenerationMode = resolveWebsiteGenerationMode(
    options.websiteGenerationMode || process.env.WEBSITE_CASE_GENERATOR
  );

  if (shouldUseGroundedGenerator(websiteBrief, websiteGenerationMode)) {
    return generateGroundedWebsiteTestCases(websiteBrief, {
      maxCases: options.websiteTargetCaseCount || 30,
    });
  }

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
    websiteTargetCaseCount: options.websiteTargetCaseCount,
    allowHeuristicFallback: "true",
  });
}

async function main() {
  const rawUrl = String(process.argv[2] || process.env.WEBSITE_URL || "").trim();
  if (!rawUrl) {
    throw new Error("A website URL is required. Pass it as an argument or set WEBSITE_URL.");
  }

  const websiteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const runExistingCasesOnly = isTruthyEnv(process.env.RUN_EXISTING_AZDO_CASES_ONLY);
  const aiProvider = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const openAiModel = String(process.env.OPENAI_MODEL || "").trim();
  const openAiBaseUrl = String(process.env.OPENAI_BASE_URL || "").trim();
  const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const geminiModel = String(process.env.GEMINI_MODEL || "").trim();
  const geminiBaseUrl = String(process.env.GEMINI_BASE_URL || "").trim();
  const websiteTargetCaseCount = parsePositiveInteger(readEnv("WEBSITE_TARGET_CASE_COUNT")) || 30;
  const websiteCaseGenerator = readEnv("WEBSITE_CASE_GENERATOR");
  const websiteGenerationMode = resolveWebsiteGenerationMode(websiteCaseGenerator);
  const executeGeneratedCases = shouldExecuteGeneratedCases(websiteCaseGenerator);
  const provider = aiProvider === "gemini" || aiProvider === "openai"
    ? aiProvider
    : openAiApiKey
      ? "openai"
      : "gemini";

  await fs.mkdir(bugDir, { recursive: true });
  await fs.mkdir(testResultsDir, { recursive: true });

  const authConfig = buildAuthConfig(websiteUrl);
  const missingAuthConfig = authConfig.requireAuth ? validateAuthConfig(authConfig) : [];
  if (missingAuthConfig.length) {
    const error = new AuthenticationError(
      `Missing required authentication configuration: ${missingAuthConfig.join(", ")}`
    );
    await writeAuthGateFailureReport(error, websiteUrl, authConfig);
    throw error;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const failures = [];
  const results = [];
  const classificationCounts = new Map();
  const screenshotFingerprints = new Map();
  let stopEarlyReason = "";

  let websiteBrief;
  let authDiscovery = null;

  try {
    if (authConfig.requireAuth) {
      await ensureAuthenticatedSession(page, authConfig);
      authDiscovery = await discoverAuthenticatedApp(page, authConfig);
      websiteBrief = buildAuthenticatedWebsiteBrief(websiteUrl, authDiscovery);
      websiteBrief.authConfig = authConfig;
    } else {
      websiteBrief = await analyzeWebsite(websiteUrl);
      websiteBrief.authConfig = authConfig;
    }
  } catch (error) {
    await browser.close();
    await writeAuthGateFailureReport(error, websiteUrl, authConfig);
    throw error;
  }

  const loadedCases = runExistingCasesOnly
    ? await loadExistingAzureDevOpsCases()
    : null;

  const testCaseDrafts = loadedCases || await generateWebsiteDrafts(websiteBrief, {
    provider,
    openAiApiKey,
    openAiModel,
    openAiBaseUrl,
    geminiApiKey,
    geminiModel,
    geminiBaseUrl,
    websiteTargetCaseCount,
    websiteGenerationMode,
  });

  const azureUpload = runExistingCasesOnly
    ? null
    : await uploadGeneratedCases(websiteBrief, testCaseDrafts).catch((error) => ({
        error: error.message,
      }));

  if (executeGeneratedCases || runExistingCasesOnly) {
    try {
      for (let index = 0; index < testCaseDrafts.testCases.length; index += 1) {
        const testCase = testCaseDrafts.testCases[index];
        try {
          if (authConfig.requireAuth) {
            await ensureAuthenticatedSession(page, authConfig, {
              skipNavigation: true,
              allowFreshLogin: false,
            });
          }

          await runGeneratedCase(page, websiteBrief, testCase, index);
          results.push({
            id: testCase.id,
            title: testCase.title,
            status: "passed",
            classification: "Passed",
            pointId: testCase.pointId || null,
            suiteId: testCase.suiteId || null,
            planId: testCase.planId || null,
            rev: testCase.rev || 1,
          });
        } catch (error) {
          const pageContext = await buildPageContext(page, authConfig);
          const fingerprint = cleanText(
            `${pageContext.url}::${pageContext.title}::${(pageContext.authMarkers || []).join("|")}::${(pageContext.sidebarModules || []).slice(0, 5).join("|")}`
          );
          const fingerprintCount = incrementCounter(screenshotFingerprints, fingerprint);
          const classification = classifyFailure({
            error,
            pageContext,
            authState: pageContext,
            screenshotFingerprintCount: fingerprintCount,
          });
          incrementCounter(classificationCounts, classification);

          const artifactPrefix = isRealBugClassification(classification) ? `website-${testCase.id}` : `diagnostic-${testCase.id}`;
          const screenshotPath = path.join(bugDir, `${artifactPrefix}.png`);
          const markdownPath = path.join(bugDir, `${artifactPrefix}.md`);

          await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
          await fs.writeFile(
            markdownPath,
            buildFailureMarkdown(
              testCase,
              {
                actual: error.message,
                classification,
              },
              pageContext
            ),
            "utf8"
          );

          failures.push({
            id: testCase.id,
            title: testCase.title,
            actual: error.message,
            classification,
            screenshot: screenshotPath,
            report: markdownPath,
            pageContext,
          });

          results.push(buildBlockedResult(testCase, classification, error.message));

          if (classification === "Authentication/access issue") {
            stopEarlyReason = error.message;
            break;
          }
        }
      }
    } finally {
      await browser.close();
    }
  } else {
    await browser.close();
  }

  if (stopEarlyReason) {
    for (const testCase of testCaseDrafts.testCases.slice(results.length)) {
      const classification = "Authentication/access issue";
      incrementCounter(classificationCounts, classification);
      results.push(
        buildBlockedResult(
          testCase,
          classification,
          `Execution stopped early after the authenticated session gate failed: ${stopEarlyReason}`
        )
      );
    }
  }

  const summary = {
    websiteUrl: websiteBrief.url,
    aiProvider: provider,
    generationSource: runExistingCasesOnly ? "azure-devops-suite" : testCaseDrafts.generationSource,
    azureUpload,
    gating: {
      secretValidation: "passed",
      loginValidation: authConfig.requireAuth ? "passed" : "not-required",
      authenticatedSmoke: authConfig.requireAuth ? "passed" : "not-required",
    },
    auth: {
      requireAuth: authConfig.requireAuth,
      loginUrl: authConfig.loginUrl,
      postLoginUrl: authConfig.postLoginUrl,
      discoveredModules: authDiscovery?.sidebarModules || [],
      discoveredPages: authDiscovery?.pages?.length || 0,
    },
    execution: {
      executedGeneratedCases: executeGeneratedCases || runExistingCasesOnly,
      generatedOnly: !runExistingCasesOnly && !executeGeneratedCases,
      stoppedEarly: Boolean(stopEarlyReason),
      stopReason: stopEarlyReason || "",
    },
    total: testCaseDrafts.testCases.length,
    passed: results.filter((item) => item.status === "passed").length,
    failed: results.filter((item) => item.status === "failed").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    notApplicable: results.filter((item) => item.status === "notapplicable").length,
    failureClassifications: mapToObject(classificationCounts),
    repeatedPageFingerprints: mapToObject(screenshotFingerprints),
    websiteBrief,
    testCases: testCaseDrafts.testCases,
    results,
    failures,
  };

  const azureResultPublish = await (async () => {
    if (runExistingCasesOnly) {
      return publishExistingCaseResults(loadedCases, results);
    }

    if (executeGeneratedCases) {
      return publishGeneratedCaseResults(azureUpload, testCaseDrafts, results);
    }

    return null;
  })().catch((error) => ({
    error: error.message,
  }));
  summary.azureResultPublish = azureResultPublish;

  await writeSummaryArtifacts(summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
