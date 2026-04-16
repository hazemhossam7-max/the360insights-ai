(function () {
  const filter = document.getElementById("style-filter");
  const list = document.getElementById("history-list");
  const emptyState = document.getElementById("history-empty-state");
  const clearButton = document.getElementById("clear-trips-button");
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

  function renderTrips(trips) {
    const selected = filter.value;
    const visibleTrips = selected === "All" ? trips : trips.filter((trip) => trip.style === selected);

    list.innerHTML = "";

    if (visibleTrips.length === 0) {
      list.classList.add("hidden");
      emptyState.classList.remove("hidden");
      emptyState.textContent = selected === "All"
        ? "No saved runs yet. Save a run from the Overview page."
        : `No ${selected} runs found.`;
      return;
    }

    emptyState.classList.add("hidden");
    list.classList.remove("hidden");

    visibleTrips.forEach((trip) => {
      const item = document.createElement("article");
      item.className = "history-item";
      item.innerHTML = `
        <div class="history-item-top">
          <h3>${trip.tripName}</h3>
          <span class="chip ${riskClass(trip.riskLevel)}">${trip.riskLevel}</span>
        </div>
        <p>${trip.destination}</p>
        <div class="history-meta">
          <span>${trip.style}</span>
          <span>${formatMoney(trip.budget)}</span>
          <span>${formatMoney(trip.dailyBudget)} / day</span>
          <span>${trip.days} day(s)</span>
          <span>${trip.travelers} traveler(s)</span>
        </div>
      `;
      list.appendChild(item);
    });
  }

  async function loadTrips() {
    if (isFilePreview) {
      runtimeNotice.textContent = "History needs the backend. Open the app from http://127.0.0.1:4180 to load saved runs.";
      runtimeNotice.classList.remove("hidden");
      list.classList.add("hidden");
      emptyState.classList.remove("hidden");
      emptyState.textContent = "History is unavailable in file preview mode.";
      clearButton.disabled = true;
      filter.disabled = true;
      return;
    }

    try {
      const response = await fetch("/api/trips");
      const payload = await response.json();
      renderTrips(payload.trips);
    } catch (error) {
      list.classList.add("hidden");
      emptyState.classList.remove("hidden");
      emptyState.textContent = "Run history is unavailable right now. Please try again.";
    }
  }

  filter.addEventListener("change", loadTrips);
  clearButton.addEventListener("click", async function () {
    await fetch("/api/trips", { method: "DELETE" });
    await loadTrips();
  });

  loadTrips();
})();
