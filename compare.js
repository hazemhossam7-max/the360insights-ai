(function () {
  const emptyState = document.getElementById("compare-empty-state");
  const content = document.getElementById("compare-content");
  const tableBody = document.getElementById("compare-table-body");
  const runtimeNotice = document.getElementById("runtime-notice");
  const isFilePreview = window.location.protocol === "file:";

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function riskClass(riskLevel) {
    if (riskLevel === "Too Tight") {
      return "tight";
    }
    if (riskLevel === "Balanced") {
      return "balanced";
    }
    return "comfortable";
  }

  function setText(id, value) {
    document.getElementById(id).textContent = value;
  }

  function renderTrips(trips) {
    if (trips.length === 0) {
      emptyState.classList.remove("hidden");
      content.classList.add("hidden");
      tableBody.innerHTML = "";
      return;
    }

    emptyState.classList.add("hidden");
    content.classList.remove("hidden");

    const bestValueTrip = [...trips].sort((a, b) => a.dailyPerTraveler - b.dailyPerTraveler)[0];
    const highestBudgetTrip = [...trips].sort((a, b) => b.budget - a.budget)[0];
    const tooTightTrips = trips.filter((trip) => trip.riskLevel === "Too Tight");

    setText("compare-best-value", bestValueTrip.tripName);
    setText(
      "compare-best-value-copy",
      `${formatMoney(bestValueTrip.dailyPerTraveler)} per traveler each day in ${bestValueTrip.destination}.`
    );

    setText("compare-highest-budget", highestBudgetTrip.tripName);
    setText(
      "compare-highest-budget-copy",
      `${formatMoney(highestBudgetTrip.budget)} total across ${highestBudgetTrip.days} day(s).`
    );

    setText("compare-tight-count", String(tooTightTrips.length));
    setText(
      "compare-tight-copy",
      tooTightTrips.length
        ? tooTightTrips.map((trip) => trip.tripName).join(", ")
        : "No saved trips are flagged as Too Tight."
    );

    tableBody.innerHTML = "";
    trips.forEach((trip) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <strong>${trip.tripName}</strong>
          <span>${trip.destination}</span>
        </td>
        <td>${trip.style}</td>
        <td>${formatMoney(trip.budget)}</td>
        <td>${formatMoney(trip.dailyBudget)}</td>
        <td>${formatMoney(trip.perTravelerBudget)}</td>
        <td><span class="chip ${riskClass(trip.riskLevel)}">${trip.riskLevel}</span></td>
      `;
      tableBody.appendChild(row);
    });
  }

  async function loadTrips() {
    if (isFilePreview) {
      runtimeNotice.textContent = "Compare view needs the backend. Open the app from http://127.0.0.1:4180 to compare saved trips.";
      runtimeNotice.classList.remove("hidden");
      emptyState.classList.remove("hidden");
      emptyState.textContent = "Comparison data is unavailable in file preview mode.";
      content.classList.add("hidden");
      return;
    }

    try {
      const response = await fetch("/api/trips");
      const payload = await response.json();
      renderTrips(payload.trips);
    } catch (error) {
      emptyState.classList.remove("hidden");
      emptyState.textContent = "Trip comparisons are unavailable right now. Please try again.";
      content.classList.add("hidden");
    }
  }

  loadTrips();
})();
