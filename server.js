const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 4180;
const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "trips.json");

const allocations = {
  Shoestring: { Lodging: 35, Food: 25, Transport: 20, Activities: 20 },
  Balanced: { Lodging: 40, Food: 25, Transport: 15, Activities: 20 },
  Comfort: { Lodging: 45, Food: 20, Transport: 15, Activities: 20 },
};
const stylePriority = ["Balanced", "Comfort", "Shoestring"];

const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, "[]", "utf8");
  }
}

function readTrips() {
  ensureStore();
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeTrips(trips) {
  ensureStore();
  fs.writeFileSync(dataFile, JSON.stringify(trips, null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = staticTypes[ext] || "text/plain; charset=utf-8";
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

function getRiskLevel(dailyPerTraveler) {
  if (dailyPerTraveler < 35) {
    return "Too Tight";
  }
  if (dailyPerTraveler < 80) {
    return "Balanced";
  }
  return "Comfortable";
}

function validateTrip(input) {
  const tripName = String(input.tripName || "").trim();
  const destination = String(input.destination || "").trim();
  const notes = String(input.notes || "").trim();
  const budget = Number(input.budget);
  const days = Number(input.days);
  const travelers = Number(input.travelers);
  const style = String(input.style || "");

  if (!tripName || tripName.length < 2 || tripName.length > 40) {
    return "Trip name must be between 2 and 40 characters.";
  }
  if (!destination || destination.length < 2 || destination.length > 50) {
    return "Destination must be between 2 and 50 characters.";
  }
  if (Number.isNaN(budget) || budget < 100 || budget > 50000) {
    return "Budget must be between 100 and 50000.";
  }
  if (Number.isNaN(days) || days < 1 || days > 30) {
    return "Trip length must be between 1 and 30 days.";
  }
  if (Number.isNaN(travelers) || travelers < 1 || travelers > 10) {
    return "Traveler count must be between 1 and 10.";
  }
  if (!allocations[style]) {
    return "Travel style is required.";
  }
  if (notes.length > 160) {
    return "Notes must be 160 characters or fewer.";
  }
  return null;
}

function normalizeTrip(input) {
  const budget = Number(input.budget);
  const days = Number(input.days);
  const travelers = Number(input.travelers);
  const dailyBudget = budget / days;
  const perTravelerBudget = budget / travelers;
  const dailyPerTraveler = budget / days / travelers;
  const riskLevel = getRiskLevel(dailyPerTraveler);

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    tripName: String(input.tripName).trim(),
    destination: String(input.destination).trim(),
    budget,
    days,
    travelers,
    style: String(input.style),
    notes: String(input.notes || "").trim(),
    dailyBudget,
    perTravelerBudget,
    dailyPerTraveler,
    riskLevel,
    allocations: Object.entries(allocations[input.style]).map(([label, percent]) => ({
      label,
      percent,
      amount: Math.round((budget * percent) / 100),
    })),
  };
}

function getStats(trips) {
  if (trips.length === 0) {
    return {
      totalTrips: 0,
      averageBudget: 0,
      averageDailyBudget: 0,
      mostCommonStyle: "None",
      tooTightCount: 0,
      totalBudgetSum: 0,
    };
  }

  const totalBudgetSum = trips.reduce((sum, trip) => sum + trip.budget, 0);
  const styleCounts = trips.reduce((counts, trip) => {
    counts[trip.style] = (counts[trip.style] || 0) + 1;
    return counts;
  }, {});
  const mostCommonStyle = Object.entries(styleCounts)
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return stylePriority.indexOf(a[0]) - stylePriority.indexOf(b[0]);
    })[0][0];
  const tooTightCount = trips.filter((trip) => trip.riskLevel === "Too Tight").length;

  return {
    totalTrips: trips.length,
    averageBudget: totalBudgetSum / trips.length,
    averageDailyBudget: trips.reduce((sum, trip) => sum + trip.dailyBudget, 0) / trips.length,
    mostCommonStyle,
    tooTightCount,
    totalBudgetSum,
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function routeStatic(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const fileMap = {
    "/": "index.html",
    "/index.html": "index.html",
    "/history": "history.html",
    "/history.html": "history.html",
    "/insights": "insights.html",
    "/insights.html": "insights.html",
    "/compare": "compare.html",
    "/compare.html": "compare.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
  "/planner.js": "planner.js",
    "/history.js": "history.js",
    "/insights.js": "insights.js",
    "/compare.js": "compare.js",
  };

  if (fileMap[pathname]) {
    sendFile(res, path.join(root, fileMap[pathname]));
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (routeStatic(req, res)) {
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/trips") {
    const trips = readTrips().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, { trips });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/trips") {
    try {
      const payload = await parseBody(req);
      const error = validateTrip(payload);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }
      const trip = normalizeTrip(payload);
      const trips = readTrips();
      trips.push(trip);
      writeTrips(trips);
      sendJson(res, 201, { trip });
    } catch (error) {
      sendJson(res, 400, { error: "Invalid JSON payload." });
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/trips") {
    writeTrips([]);
    sendJson(res, 200, { success: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stats") {
    const trips = readTrips();
    sendJson(res, 200, { stats: getStats(trips) });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

ensureStore();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`The360 Insights AI QA server running at http://127.0.0.1:${PORT}`);
});
