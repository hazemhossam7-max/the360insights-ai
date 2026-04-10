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

async function clearTrips(request, baseURL) {
  const response = await request.delete(`${baseURL}/api/trips`);
  if (!response.ok()) {
    throw new Error(`Failed to clear trips. Status: ${response.status()}`);
  }
}

async function postTrip(request, baseURL, trip) {
  return request.post(`${baseURL}/api/trips`, {
    data: trip,
  });
}

async function fillPlanner(page, values, baseURL) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.fill("#tripName", values.tripName ?? "");
  await page.fill("#destination", values.destination ?? "");
  await page.fill("#budget", values.budget ?? "");
  await page.fill("#days", values.days ?? "");
  await page.fill("#travelers", values.travelers ?? "");
  await page.selectOption("#style", values.style ?? "");
  await page.fill("#notes", values.notes ?? "");
}

async function planTrip(page, values, baseURL) {
  await fillPlanner(page, values, baseURL);
  await page.click('button[type="submit"]');
}

async function saveTripThroughUi(page, values, baseURL) {
  await planTrip(page, values, baseURL);
  await page.click("#save-button");
  await page.waitForTimeout(250);
}

async function saveTripAndNavigateImmediately(page, values, destinationPath, baseURL) {
  await planTrip(page, values, baseURL);
  await page.click("#save-button");
  await page.goto(`${baseURL}${destinationPath}`, { waitUntil: "domcontentloaded" });
}

module.exports = {
  sampleTrips,
  clearTrips,
  postTrip,
  fillPlanner,
  planTrip,
  saveTripThroughUi,
  saveTripAndNavigateImmediately,
};

