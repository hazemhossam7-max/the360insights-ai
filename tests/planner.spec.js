const { test, expect } = require("playwright/test");
const {
  sampleTrips,
  clearTrips,
  postTrip,
  planTrip,
} = require("./helpers");

test.describe("Planner flows", () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await clearTrips(request, baseURL);
  });

  test("TC-001: home page loads with planner and navigation", async ({ page, baseURL }) => {
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /Plan it, save it, compare it./i })).toBeVisible();
    await expect(page.locator("#budget-form")).toBeVisible();
    await expect(page.getByRole("link", { name: "History" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Compare" })).toBeVisible();
  });

  test("TC-002: valid trip plan calculates summary and enables save", async ({ page, baseURL }) => {
    await planTrip(page, sampleTrips.balanced, baseURL);

    await expect(page.locator("#results-content")).toBeVisible();
    await expect(page.locator("#total-budget-value")).toHaveText("$2,400");
    await expect(page.locator("#daily-budget-value")).toHaveText("$400");
    await expect(page.locator("#daily-per-traveler-value")).toHaveText("$200");
    await expect(page.locator("#risk-level-value")).toHaveText("Comfortable");
    await expect(page.locator("#save-button")).toBeEnabled();
  });

  test("TC-006: reset clears form and disables save", async ({ page, baseURL }) => {
    await planTrip(page, sampleTrips.balanced, baseURL);
    await page.click("#reset-button");

    await expect(page.locator("#tripName")).toHaveValue("");
    await expect(page.locator("#save-button")).toBeDisabled();
    await expect(page.locator("#status-pill")).toHaveText("Awaiting input");
  });

  test("TC-007: blank submission shows required errors", async ({ page, baseURL }) => {
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.click('button[type="submit"]');

    await expect(page.locator('[data-error-for="tripName"]')).toHaveText("Trip name is required.");
    await expect(page.locator('[data-error-for="destination"]')).toHaveText("Destination is required.");
    await expect(page.locator("#results-content")).toBeHidden();
  });

  test("TC-008: trip name below minimum is rejected", async ({ page, baseURL }) => {
    await planTrip(page, { ...sampleTrips.balanced, tripName: "A" }, baseURL);

    await expect(page.locator('[data-error-for="tripName"]')).toHaveText(
      "Trip name must be between 2 and 40 characters."
    );
  });

  test("TC-009: server rejects malformed trip payload", async ({ request, baseURL }) => {
    const response = await postTrip(request, baseURL, { tripName: "X" });
    const payload = await response.json();

    expect(response.status()).toBe(400);
    expect(payload.error).toBe("Trip name must be between 2 and 40 characters.");
  });

  test("TC-010: minimum valid values compute Too Tight risk", async ({ page, baseURL }) => {
    await planTrip(page, sampleTrips.shoestring, baseURL);

    await expect(page.locator("#risk-level-value")).toHaveText("Too Tight");
  });

  test("TC-011: balanced risk threshold is inclusive at 35", async ({ page, baseURL }) => {
    await planTrip(
      page,
      {
        tripName: "Threshold Check",
        destination: "Amman, Jordan",
        budget: "140",
        days: "2",
        travelers: "2",
        style: "Balanced",
        notes: "",
      },
      baseURL
    );

    await expect(page.locator("#risk-level-value")).toHaveText("Balanced");
  });

  test("TC-012: maximum valid values compute successfully", async ({ page, baseURL }) => {
    await planTrip(
      page,
      {
        tripName: "Grand Expedition",
        destination: "Tokyo, Japan",
        budget: "50000",
        days: "30",
        travelers: "10",
        style: "Comfort",
        notes: "Large family trip.",
      },
      baseURL
    );

    await expect(page.locator("#total-budget-value")).toHaveText("$50,000");
    await expect(page.locator("#risk-level-value")).toHaveText("Comfortable");
  });
});

