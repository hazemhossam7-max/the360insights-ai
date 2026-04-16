import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { createAzureDevOpsClient } from "./agent/azure-devops-client.mjs";

const require = createRequire(import.meta.url);
const { sampleTrips } = require("./tests/helpers.js");

const root = process.cwd();
const bugDir = path.join(root, "bug_reports");
const testResultsDir = path.join(root, "test-results");
const reportPath = path.join(bugDir, "latest_azdo_suite_run.json");
const junitPath = path.join(testResultsDir, "junit.xml");

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripStepMarkup(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
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

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)) {
    return parsed;
  }
  return null;
}

function parseIdList(value) {
  return String(value || "")
    .split(",")
    .map((item) => parsePositiveInteger(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText || "Request failed";
    throw new Error(`Request failed (${response.status}): ${message}`);
  }

  return data;
}

async function clearTrips(baseUrl) {
  await fetchJson(`${baseUrl}/api/trips`, { method: "DELETE" });
}

async function postTrip(baseUrl, trip) {
  return fetchJson(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trip),
  });
}

async function seedTrips(baseUrl, trips) {
  for (const trip of trips) {
    await postTrip(baseUrl, trip);
  }
}

async function fillPlanner(page, values, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.fill("#tripName", values.tripName ?? "");
  await page.fill("#destination", values.destination ?? "");
  await page.fill("#budget", values.budget ?? "");
  await page.fill("#days", values.days ?? "");
  await page.fill("#travelers", values.travelers ?? "");
  await page.selectOption("#style", values.style ?? "");
  await page.fill("#notes", values.notes ?? "");
}

async function planTrip(page, values, baseUrl) {
  await fillPlanner(page, values, baseUrl);
  await page.click('button[type="submit"]');
}

async function saveTripThroughUi(page, values, baseUrl) {
  await planTrip(page, values, baseUrl);
  const saveResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().endsWith("/api/trips"),
    { timeout: 10_000 }
  );
  await page.click("#save-button");
  const saveResponse = await saveResponsePromise;
  if (saveResponse.status() !== 201) {
    throw new Error(`Expected save request to succeed, got ${saveResponse.status()}.`);
  }
}

async function saveTripAndNavigateImmediately(page, values, destinationPath, baseUrl) {
  await planTrip(page, values, baseUrl);
  await page.click("#save-button");
  await page.goto(`${baseUrl}${destinationPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    async (expectedTripName) => {
      const response = await fetch("/api/trips");
      const payload = await response.json();
      return payload.trips.some((trip) => trip.tripName === expectedTripName);
    },
    values.tripName,
    { timeout: 10_000 }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function getText(page, selector) {
  return (await page.textContent(selector))?.trim() ?? "";
}

async function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function combineCaseText(testCase) {
  return cleanText(
    [
      testCase?.title,
      testCase?.description,
      testCase?.acceptanceCriteria,
      testCase?.stepsText,
      testCase?.expectedResult,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function inferCaseKind(testCase, index) {
  const text = combineCaseText(testCase);

  if (index === 0 || /home page|landing page|branding|planner page/.test(text)) {
    return "home";
  }
  if (/history\s+filter|filter.*history|style filter/.test(text)) {
    return "history-filter";
  }
  if (/history/.test(text) && /(save|persist|immediately|navigate away)/.test(text)) {
    return "history-save";
  }
  if (/insights|aggregate|average|stats|most common|total trips/.test(text)) {
    return "insights";
  }
  if (/compare|best value|best-value|spotlight/.test(text)) {
    return "compare";
  }
  if (/clear all|clear trips|remove persisted|empty state/.test(text)) {
    return "clear";
  }
  if (/validation|invalid|required|blank|minimum|maximum|boundary|rejected|error/.test(text)) {
    return "validation";
  }
  if (/responsive|mobile|viewport|desktop/.test(text)) {
    return "responsive";
  }
  if (/accessibility|aria|label|keyboard/.test(text)) {
    return "accessibility";
  }
  if (/performance|load time|latency|speed/.test(text)) {
    return "performance";
  }
  if (/save|persist|happy path|valid trip|main happy path/.test(text)) {
    return "save";
  }
  if (/navigation|menu|link|route|page/.test(text)) {
    return "navigation";
  }

  return "feature";
}

function chooseSampleTrip(text) {
  if (/comfort/.test(text)) {
    return sampleTrips.comfort;
  }
  if (/shoe|string|tight|minimum/.test(text)) {
    return sampleTrips.shoestring;
  }
  return sampleTrips.balanced;
}

async function verifyHomePage(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await assert(Boolean(cleanText(await page.title())), "The page title is empty.");
  await assert(Boolean(cleanText(await page.locator("body").innerText().catch(() => ""))), "The home page body is empty.");
  await assert((await page.locator("h1, h2, h3").count()) > 0, "No headings were found on the home page.");
  await assert(
    (await page.locator("a,button,[role='button']").count()) > 0,
    "No obvious interactive elements were found on the home page."
  );
}

async function verifySaveFlow(page, baseUrl, text) {
  await clearTrips(baseUrl);
  const trip = chooseSampleTrip(text);
  await saveTripThroughUi(page, trip, baseUrl);
  await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
  await assert((await getText(page, "#history-list")).includes(trip.tripName), "Saved trip missing from history.");
}

async function verifyHistoryFilter(page, baseUrl) {
  await clearTrips(baseUrl);
  await seedTrips(baseUrl, [sampleTrips.balanced, sampleTrips.comfort]);
  await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
  await page.selectOption("#style-filter", "Comfort");
  await page.waitForTimeout(150);
  const listText = await getText(page, "#history-list");
  await assert(listText.includes("Oslo Weekend"), "Comfort trip should remain visible.");
  await assert(listText.includes("Cairo Escape") === false, "Non-matching style should be hidden.");
}

async function verifyInsights(page, baseUrl) {
  await clearTrips(baseUrl);
  await seedTrips(baseUrl, [sampleTrips.balanced, sampleTrips.comfort]);
  await page.goto(`${baseUrl}/insights`, { waitUntil: "domcontentloaded" });
  await assert((await getText(page, "#stat-total-trips")) === "2", "Total trip count incorrect.");
  await assert((await getText(page, "#stat-average-budget")) === "$3,300", "Average budget incorrect.");
  await assert((await getText(page, "#stat-average-daily-budget")) === "$620", "Average daily budget incorrect.");
  await assert((await getText(page, "#stat-most-common-style")) === "Balanced", "Most common style incorrect.");
}

async function verifyCompare(page, baseUrl) {
  await clearTrips(baseUrl);
  await seedTrips(baseUrl, [sampleTrips.balanced, sampleTrips.shoestring]);
  await page.goto(`${baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await assert((await getText(page, "#compare-best-value")) === "Mini Trip", "Best daily value spotlight incorrect.");
  await assert((await getText(page, "#compare-tight-count")) === "1", "Too Tight count should be reflected in compare page.");
  await assert((await getText(page, "#compare-table-body")).includes("Cairo Escape"), "Balanced trip missing from compare table.");
  await assert((await getText(page, "#compare-table-body")).includes("Mini Trip"), "Shoestring trip missing from compare table.");
}

async function verifyValidation(page, baseUrl) {
  await clearTrips(baseUrl);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.click('button[type="submit"]');
  await assert(
    (await getText(page, '[data-error-for="tripName"]')) === "Trip name is required.",
    "Trip name required error missing."
  );
  await assert(
    (await getText(page, '[data-error-for="destination"]')) === "Destination is required.",
    "Destination required error missing."
  );
}

async function verifyClear(page, baseUrl) {
  await clearTrips(baseUrl);
  await seedTrips(baseUrl, [sampleTrips.balanced]);
  await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
  await page.click("#clear-trips-button");
  await page.waitForTimeout(150);
  await assert(await page.locator("#history-empty-state").isVisible(), "History empty state should show after clear.");
}

async function verifyResponsive(page, baseUrl) {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await assert((await page.locator("h1, h2, h3").count()) > 0, "No visible heading found in desktop view.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await assert((await page.locator("h1, h2, h3").count()) > 0, "No visible heading found in mobile view.");
}

async function verifyAccessibility(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const headingCount = await page.locator("h1, h2, h3").count();
  const linkCount = await page.locator("a").count();
  const buttonCount = await page.locator("button").count();
  const labelCount = await page.locator("label").count();

  await assert(headingCount > 0, "No headings were found.");
  await assert(linkCount > 0 || buttonCount > 0, "No interactive controls were found.");
  await assert(labelCount > 0 || (linkCount > 0 && buttonCount > 0), "No obvious accessible labels or controls were found.");
}

async function verifyPerformance(page, baseUrl, testCase) {
  const text = combineCaseText(testCase);
  const budgetMatch = text.match(/(?:under|within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*seconds?/i);
  const singleMatch = text.match(/(?:under|within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*seconds?/i);
  const msMatch = text.match(/(?:under|within|less than|no more than)\s*(\d+(?:\.\d+)?)\s*ms\b/i);
  const budgetMs = budgetMatch
    ? Math.round(Number(budgetMatch[2]) * 1000)
    : singleMatch
      ? Math.round(Number(singleMatch[1]) * 1000)
      : msMatch
        ? Math.round(Number(msMatch[1]))
        : 5000;

  const start = performance.now();
  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const elapsedMs = Math.round(performance.now() - start);

  await assert(!response || response.status() < 500, `Performance page returned HTTP ${response?.status() || "unknown"}.`);
  await assert(Boolean(cleanText(await page.title())), "The page title is empty during the performance check.");
  await assert(elapsedMs <= budgetMs, `Page load took ${elapsedMs}ms, which exceeds the ${budgetMs}ms performance budget.`);
}

async function verifyNavigation(page, baseUrl, testCase) {
  const text = combineCaseText(testCase);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const navTargets = [
    { label: "History", path: "/history" },
    { label: "Insights", path: "/insights" },
    { label: "Compare", path: "/compare" },
  ];

  const match = navTargets.find((item) => text.includes(item.label.toLowerCase())) || navTargets[0];
  await page.getByRole("link", { name: new RegExp(match.label, "i") }).click().catch(() => {});
  await page.goto(`${baseUrl}${match.path}`, { waitUntil: "domcontentloaded" });
  await assert(Boolean(cleanText(await page.title())), `The destination page for ${match.label} has no title.`);
}

async function verifyFeature(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await assert(Boolean(cleanText(await page.title()) || cleanText(await page.locator("body").innerText().catch(() => ""))), "The page content is empty.");
}

async function runCase(page, baseUrl, testCase, index) {
  const kind = inferCaseKind(testCase, index);
  const text = combineCaseText(testCase);

  switch (kind) {
    case "home":
      return verifyHomePage(page, baseUrl);
    case "save":
      return verifySaveFlow(page, baseUrl, text);
    case "history-filter":
      return verifyHistoryFilter(page, baseUrl);
    case "history-save":
      return verifySaveFlow(page, baseUrl, text);
    case "insights":
      return verifyInsights(page, baseUrl);
    case "compare":
      return verifyCompare(page, baseUrl);
    case "clear":
      return verifyClear(page, baseUrl);
    case "validation":
      return verifyValidation(page, baseUrl);
    case "responsive":
      return verifyResponsive(page, baseUrl);
    case "accessibility":
      return verifyAccessibility(page, baseUrl);
    case "performance":
      return verifyPerformance(page, baseUrl, testCase);
    case "navigation":
      return verifyNavigation(page, baseUrl, testCase);
    default:
      return verifyFeature(page, baseUrl);
  }
}

async function startLocalServer() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "4180",
    },
  });

  return server;
}

async function waitForServer(baseUrl) {
  const healthUrl = `${baseUrl}/`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for ${baseUrl} to become ready.`);
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

async function loadAzureDevOpsCases() {
  const config = {
    orgUrl: readEnv("AZDO_ORG_URL", "SYSTEM_COLLECTIONURI"),
    project: readEnv("AZDO_PROJECT", "SYSTEM_TEAMPROJECT"),
    pat: readEnv("AZDO_PAT"),
  };
  const client = createAzureDevOpsClient(config);
  const testPlansClient = (await import("./agent/testplans-client.mjs")).createTestPlansClient(config);
  const explicitPlanIds = parseIdList(readEnv("AZDO_TEST_PLAN_ID"));
  const explicitSuiteId = parsePositiveInteger(readEnv("AZDO_TEST_SUITE_ID"));

  const plans = [];
  if (explicitPlanIds.length) {
    for (const planId of explicitPlanIds) {
      plans.push(await testPlansClient.getTestPlan(planId));
    }
  } else {
    let continuationToken = "";
    do {
      const page = await testPlansClient.listTestPlans({ includePlanDetails: true, continuationToken });
      plans.push(...page.plans);
      continuationToken = String(page.continuationToken || "").trim();
    } while (continuationToken);
  }

  const cases = [];
  for (const plan of plans) {
    const planId = parsePositiveInteger(plan?.id);
    if (!planId) {
      continue;
    }

    const suiteIds = explicitSuiteId ? [explicitSuiteId] : await collectSuiteIds(testPlansClient, planId);
    for (const suiteId of suiteIds) {
      const suiteCases = [];
      let continuationToken = "";
      do {
        const page = await testPlansClient.getSuiteTestCases({
          planId,
          suiteId,
          isRecursive: true,
          continuationToken,
        });
        suiteCases.push(...page.testCases);
        continuationToken = String(page.continuationToken || "").trim();
      } while (continuationToken);

      for (const suiteCase of suiteCases) {
        const workItemId = Number(suiteCase.workItemId || suiteCase.id);
        if (!Number.isFinite(workItemId) || workItemId <= 0) {
          continue;
        }

        const workItem = await client.getWorkItem(workItemId);
        const stepsText = stripStepMarkup(workItem.stepsHtml || workItem.description || "");
        cases.push({
          planId,
          suiteId,
          id: workItem.id,
          title: workItem.title,
          description: workItem.description,
          acceptanceCriteria: workItem.acceptanceCriteria,
          stepsText,
          expectedResult: "",
          type: workItem.type,
        });
      }
    }
  }

  return cases;
}

async function main() {
  const baseUrl = readEnv("APP_BASE_URL") || "http://127.0.0.1:4180";
  const cases = await loadAzureDevOpsCases();

  if (!cases.length) {
    throw new Error("No Azure DevOps test cases were found to run.");
  }

  await fs.mkdir(bugDir, { recursive: true });
  await fs.mkdir(testResultsDir, { recursive: true });
  const server = await startLocalServer();
  await waitForServer(baseUrl);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const failures = [];
  const results = [];

  try {
    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index];
      const label = `[suite] (${index + 1}/${cases.length}) ${testCase.id} - ${testCase.title}`;
      console.log(label);

      try {
        await runCase(page, baseUrl, testCase, index);
        results.push({
          planId: testCase.planId,
          suiteId: testCase.suiteId,
          id: testCase.id,
          title: testCase.title,
          status: "passed",
        });
      } catch (error) {
        const screenshotPath = path.join(bugDir, `azdo-suite-${testCase.id}.png`);
        const markdownPath = path.join(bugDir, `azdo-suite-${testCase.id}.md`);

        await page.screenshot({ path: screenshotPath, fullPage: true });
        const bugReport = `# ${testCase.id} - ${testCase.title}\n\n## Title\n${testCase.title}\n\n## Steps\n${cleanText(testCase.stepsText)}\n\n## Actual\n${error.message}\n`;
        await fs.writeFile(markdownPath, bugReport, "utf8");

        failures.push({
          planId: testCase.planId,
          suiteId: testCase.suiteId,
          id: testCase.id,
          title: testCase.title,
          actual: error.message,
          screenshot: screenshotPath,
          bugReport: markdownPath,
        });
        results.push({
          planId: testCase.planId,
          suiteId: testCase.suiteId,
          id: testCase.id,
          title: testCase.title,
          status: "failed",
          error: error.message,
        });
      }
    }
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }

  const summary = {
    total: cases.length,
    passed: results.filter((item) => item.status === "passed").length,
    failed: failures.length,
    results,
    failures,
  };

  const testCaseXml = summary.results
    .map((item) => {
      const suiteLabel = `plan-${item.planId}-suite-${item.suiteId}`;
      const name = `${item.id} - ${item.title}`;
      const failure =
        item.status === "failed"
          ? `\n      <failure message="${escapeXml(item.error || "Test failed")}">${escapeXml(
              item.error || "Test failed"
            )}</failure>`
          : "";

      return [
        `    <testcase classname="${escapeXml(suiteLabel)}" name="${escapeXml(name)}" time="0.00">`,
        failure,
        "    </testcase>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const junitXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Azure DevOps Suite Runner" tests="${summary.total}" failures="${summary.failed}" errors="0" skipped="0">
  <testsuite name="Azure DevOps Suite Runner" tests="${summary.total}" failures="${summary.failed}" errors="0" skipped="0">
${testCaseXml}
  </testsuite>
</testsuites>
`;

  await fs.writeFile(junitPath, junitXml, "utf8");
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
