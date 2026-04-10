(function () {
  const emptyState = document.getElementById("insights-empty-state");
  const content = document.getElementById("insights-content");
  const runtimeNotice = document.getElementById("runtime-notice");
  const isFilePreview = window.location.protocol === "file:";

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  async function loadStats() {
    if (isFilePreview) {
      runtimeNotice.textContent = "Insights need the backend. Open the app from http://127.0.0.1:4180 to load analytics.";
      runtimeNotice.classList.remove("hidden");
      emptyState.classList.remove("hidden");
      emptyState.textContent = "Insights are unavailable in file preview mode.";
      content.classList.add("hidden");
      return;
    }

    try {
      const response = await fetch("/api/stats");
      const payload = await response.json();
      const stats = payload.stats;

      if (stats.totalTrips === 0) {
        emptyState.classList.remove("hidden");
        content.classList.add("hidden");
        return;
      }

      emptyState.classList.add("hidden");
      content.classList.remove("hidden");

      document.getElementById("stat-total-trips").textContent = String(stats.totalTrips);
      document.getElementById("stat-average-budget").textContent = formatMoney(stats.averageBudget);
      document.getElementById("stat-average-daily-budget").textContent = formatMoney(stats.averageDailyBudget);
      document.getElementById("stat-most-common-style").textContent = stats.mostCommonStyle;
      document.getElementById("stat-too-tight-count").textContent = String(stats.tooTightCount);
      document.getElementById("stat-total-budget-sum").textContent = formatMoney(stats.totalBudgetSum);
    } catch (error) {
      emptyState.classList.remove("hidden");
      emptyState.textContent = "Insights are unavailable right now. Please try again.";
      content.classList.add("hidden");
    }
  }

  loadStats();
})();
