const { test, expect } = require("playwright/test");
const {
  sampleTrips,
  clearTrips,
  seedTrips,
  saveTripThroughUi,
  saveTripAndNavigateImmediately,
} = require("./helpers");

test.describe("History, insights, and compare flows", () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await clearTrips(request, baseURL);
  });

  test("TC-003: saving a valid trip persists it to history", async ({ page, baseURL }) => {
    await saveTripThroughUi(page, sampleTrips.balanced, baseURL);
    await page.goto(`${baseURL}/history`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#history-list")).toContainText("Cairo Escape");
    await expect(page.locator("#history-list")).toContainText("Cairo, Egypt");
  });

  test("TC-004: history filter shows only matching styles", async ({ page, request, baseURL }) => {
    await seedTrips(request, baseURL, [sampleTrips.balanced, sampleTrips.comfort]);
    await page.goto(`${baseURL}/history`, { waitUntil: "domcontentloaded" });
    await page.selectOption("#style-filter", "Comfort");

    await expect(page.locator("#history-list")).toContainText("Oslo Weekend");
    await expect(page.locator("#history-list")).not.toContainText("Cairo Escape");
  });

  test("TC-005: insights page shows aggregate stats from saved data", async ({ page, request, baseURL }) => {
    await seedTrips(request, baseURL, [sampleTrips.balanced, sampleTrips.comfort]);
    await page.goto(`${baseURL}/insights`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#stat-total-trips")).toHaveText("2");
    await expect(page.locator("#stat-average-budget")).toHaveText("$3,300");
    await expect(page.locator("#stat-average-daily-budget")).toHaveText("$620");
    await expect(page.locator("#stat-most-common-style")).toHaveText("Balanced");
  });

  test("TC-013: clear all removes persisted trips from history", async ({ page, request, baseURL }) => {
    await seedTrips(request, baseURL, [sampleTrips.balanced]);
    await page.goto(`${baseURL}/history`, { waitUntil: "domcontentloaded" });
    await page.click("#clear-trips-button");

    await expect(page.locator("#history-empty-state")).toBeVisible();
  });

  test("TC-014: insights page returns to empty state after clearing runs", async ({ page, request, baseURL }) => {
    await seedTrips(request, baseURL, [sampleTrips.balanced]);
    await page.goto(`${baseURL}/history`, { waitUntil: "domcontentloaded" });
    await page.click("#clear-trips-button");

    await expect(page.locator("#history-empty-state")).toHaveText(
      "No saved runs yet. Save a run from the Overview page."
    );
    await page.goto(`${baseURL}/insights`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#insights-empty-state")).toBeVisible();
  });

  test("TC-015: save still persists if the user navigates away immediately", async ({ page, baseURL }) => {
    await saveTripAndNavigateImmediately(page, sampleTrips.balanced, "/history", baseURL);

    await expect(page.locator("#history-list")).toContainText("Cairo Escape");
  });

  test("TC-016: compare page shows saved runs and best-value spotlight", async ({ page, request, baseURL }) => {
    await seedTrips(request, baseURL, [sampleTrips.balanced, sampleTrips.shoestring]);
    await page.goto(`${baseURL}/compare`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#compare-best-value")).toHaveText("Mini Trip");
    await expect(page.locator("#compare-tight-count")).toHaveText("1");
    await expect(page.locator("#compare-table-body")).toContainText("Cairo Escape");
    await expect(page.locator("#compare-table-body")).toContainText("Mini Trip");
  });
});
