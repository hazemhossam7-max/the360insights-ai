import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const baseUrl = "http://127.0.0.1:4180";
const bugDir = path.join(root, "bug_reports");
const casesPath = path.join(root, "test_cases.json");
const reportPath = path.join(root, "bug_reports", "latest_report.json");

const cases = JSON.parse(await fs.readFile(casesPath, "utf8"));
await fs.mkdir(bugDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const failures = [];
const results = [];

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function clearTrips() {
  await fetch(`${baseUrl}/api/trips`, { method: "DELETE" });
}

async function postTrip(trip) {
  return fetch(`${baseUrl}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trip),
  });
}

async function fillPlanner(values) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.fill("#tripName", values.tripName ?? "");
  await page.fill("#destination", values.destination ?? "");
  await page.fill("#budget", values.budget ?? "");
  await page.fill("#days", values.days ?? "");
  await page.fill("#travelers", values.travelers ?? "");
  await page.selectOption("#style", values.style ?? "");
  await page.fill("#notes", values.notes ?? "");
}

async function planTrip(values) {
  await fillPlanner(values);
  await page.click('button[type="submit"]');
}

async function saveTripThroughUi(values) {
  await planTrip(values);
  await page.click("#save-button");
  await page.waitForTimeout(250);
}

async function saveTripAndNavigateImmediately(values, destinationPath) {
  await planTrip(values);
  await page.click("#save-button");
  await page.goto(`${baseUrl}${destinationPath}`, { waitUntil: "domcontentloaded" });
}

async function getText(selector) {
  return (await page.textContent(selector))?.trim() ?? "";
}

async function assertNoResults() {
  await expect((await page.locator("#results-content").isVisible()) === false, "Results should remain hidden.");
}

const sampleTrips = {
  balanced: {
    tripName: "Cairo Escape",
    destination: "Cairo, Egypt",
    budget: "2400",
    days: "6",
    travelers: "2",
    style: "Balanced",
    notes: "City break with museums and river cruise.",
  },
  comfort: {
    tripName: "Oslo Weekend",
    destination: "Oslo, Norway",
    budget: "4200",
    days: "5",
    travelers: "2",
    style: "Comfort",
    notes: "Central hotel and restaurant-heavy itinerary.",
  },
  shoestring: {
    tripName: "Mini Trip",
    destination: "Alexandria, Egypt",
    budget: "100",
    days: "1",
    travelers: "10",
    style: "Shoestring",
    notes: "Day trip by local transport.",
  },
};

async function runTestCase(testCase) {
  switch (testCase.id) {
    case "TC-001": {
      await clearTrips();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await expect(await page.getByRole("heading", { name: /Plan it, save it, compare it./i }).isVisible(), "Home hero missing.");
      await expect(await page.locator("#budget-form").isVisible(), "Planner form missing.");
      await expect(await page.getByRole("link", { name: "History" }).isVisible(), "History nav missing.");
      await expect(await page.getByRole("link", { name: "Compare" }).isVisible(), "Compare nav missing.");
      break;
    }
    case "TC-002": {
      await clearTrips();
      await planTrip(sampleTrips.balanced);
      await expect(await page.locator("#results-content").isVisible(), "Results should be visible.");
      await expect((await getText("#total-budget-value")) === "$2,400", "Incorrect total budget.");
      await expect((await getText("#daily-budget-value")) === "$400", "Incorrect daily budget.");
      await expect((await getText("#daily-per-traveler-value")) === "$200", "Incorrect daily per traveler.");
      await expect((await getText("#risk-level-value")) === "Comfortable", "Incorrect risk level.");
      await expect((await page.locator("#save-button").isDisabled()) === false, "Save button should be enabled.");
      break;
    }
    case "TC-003": {
      await clearTrips();
      await saveTripThroughUi(sampleTrips.balanced);
      await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
      await expect((await getText("#history-list")).includes("Cairo Escape"), "Saved run missing from history.");
      await expect((await getText("#history-list")).includes("Cairo, Egypt"), "Destination missing from history.");
      break;
    }
    case "TC-004": {
      await clearTrips();
      await saveTripThroughUi(sampleTrips.balanced);
      await saveTripThroughUi(sampleTrips.comfort);
      await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
      await page.selectOption("#style-filter", "Comfort");
      await page.waitForTimeout(150);
      const listText = await getText("#history-list");
      await expect(listText.includes("Oslo Weekend"), "Comfort trip should remain visible.");
      await expect(listText.includes("Cairo Escape") === false, "Non-matching style should be hidden.");
      break;
    }
    case "TC-005": {
      await clearTrips();
      await saveTripThroughUi(sampleTrips.balanced);
      await saveTripThroughUi(sampleTrips.comfort);
      await page.goto(`${baseUrl}/insights`, { waitUntil: "domcontentloaded" });
      await expect((await getText("#stat-total-trips")) === "2", "Total trip count incorrect.");
      await expect((await getText("#stat-average-budget")) === "$3,300", "Average budget incorrect.");
      await expect((await getText("#stat-average-daily-budget")) === "$620", "Average daily budget incorrect.");
      await expect((await getText("#stat-most-common-style")) === "Balanced", "Most common style incorrect.");
      break;
    }
    case "TC-006": {
      await clearTrips();
      await planTrip(sampleTrips.balanced);
      await page.click("#reset-button");
      await expect((await page.inputValue("#tripName")) === "", "Trip name should reset.");
      await expect((await page.locator("#save-button").isDisabled()) === true, "Save button should disable after reset.");
      await expect((await getText("#status-pill")) === "Awaiting input", "Status should reset.");
      break;
    }
    case "TC-007": {
      await clearTrips();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.click('button[type="submit"]');
      await expect((await getText('[data-error-for="tripName"]')) === "Trip name is required.", "Trip name required error missing.");
      await expect((await getText('[data-error-for="destination"]')) === "Destination is required.", "Destination required error missing.");
      await assertNoResults();
      break;
    }
    case "TC-008": {
      await clearTrips();
      await planTrip({ ...sampleTrips.balanced, tripName: "A" });
      await expect((await getText('[data-error-for="tripName"]')) === "Trip name must be between 2 and 40 characters.", "Trip name min validation missing.");
      break;
    }
    case "TC-009": {
      await clearTrips();
      const response = await postTrip({ tripName: "X" });
      const payload = await response.json();
      await expect(response.status === 400, "Malformed payload should return 400.");
      await expect(payload.error === "Trip name must be between 2 and 40 characters.", "Server validation message incorrect.");
      break;
    }
    case "TC-010": {
      await clearTrips();
      await planTrip(sampleTrips.shoestring);
      await expect((await getText("#risk-level-value")) === "Too Tight", "Minimum threshold should be Too Tight.");
      break;
    }
    case "TC-011": {
      await clearTrips();
      await planTrip({
        tripName: "Threshold Check",
        destination: "Amman, Jordan",
        budget: "140",
        days: "2",
        travelers: "2",
        style: "Balanced",
        notes: "",
      });
      await expect((await getText("#risk-level-value")) === "Balanced", "Balanced threshold should include 35.");
      break;
    }
    case "TC-012": {
      await clearTrips();
      await planTrip({
        tripName: "Grand Expedition",
        destination: "Tokyo, Japan",
        budget: "50000",
        days: "30",
        travelers: "10",
        style: "Comfort",
        notes: "Large family trip.",
      });
      await expect((await getText("#total-budget-value")) === "$50,000", "Max total budget incorrect.");
      await expect((await getText("#risk-level-value")) === "Comfortable", "Max risk incorrect.");
      break;
    }
    case "TC-013": {
      await clearTrips();
      await saveTripThroughUi(sampleTrips.balanced);
      await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
      await page.click("#clear-trips-button");
      await page.waitForTimeout(150);
      await expect(await page.locator("#history-empty-state").isVisible(), "Empty state should show after clear.");
      break;
    }
    case "TC-014": {
      await clearTrips();
      await saveTripThroughUi(sampleTrips.balanced);
      await page.goto(`${baseUrl}/history`, { waitUntil: "domcontentloaded" });
      await page.click("#clear-trips-button");
      await page.waitForTimeout(150);
      await expect(await page.locator("#history-empty-state").isVisible(), "Empty state should show after clear.");
      await page.goto(`${baseUrl}/insights`, { waitUntil: "domcontentloaded" });
      await expect(await page.locator("#insights-empty-state").isVisible(), "Insights empty state should appear with no trips.");
      break;
    }
    case "TC-015": {
      await clearTrips();
      await saveTripAndNavigateImmediately(sampleTrips.balanced, "/history");
      await page.waitForTimeout(250);
      await expect((await getText("#history-list")).includes("Cairo Escape"), "Trip should persist after immediate navigation.");
      break;
    }
    case "TC-016": {
      await clearTrips();
      await saveTripThroughUi(sampleTrips.balanced);
      await saveTripThroughUi(sampleTrips.shoestring);
      await page.goto(`${baseUrl}/compare`, { waitUntil: "domcontentloaded" });
      await expect((await getText("#compare-best-value")) === "Mini Trip", "Best daily value spotlight incorrect.");
      await expect((await getText("#compare-tight-count")) === "1", "Too Tight count should be reflected in compare page.");
      await expect((await getText("#compare-table-body")).includes("Cairo Escape"), "Balanced trip missing from compare table.");
      await expect((await getText("#compare-table-body")).includes("Mini Trip"), "Shoestring trip missing from compare table.");
      break;
    }
    default:
      throw new Error(`Unsupported test case: ${testCase.id}`);
  }
}

for (const testCase of cases) {
  try {
    await runTestCase(testCase);
    results.push({ id: testCase.id, title: testCase.title, status: "passed" });
  } catch (error) {
    const screenshotPath = path.join(bugDir, `${testCase.id}.png`);
    const markdownPath = path.join(bugDir, `${testCase.id}.md`);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const bugReport = `# ${testCase.id} - ${testCase.title}

## Steps
${testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

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

await browser.close();

const summary = {
  total: cases.length,
  passed: results.filter((item) => item.status === "passed").length,
  failed: failures.length,
  results,
  failures,
};

await fs.writeFile(reportPath, JSON.stringify(summary, null, 2), "utf8");

if (failures.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
