(function () {
  const allocations = {
    Shoestring: { Lodging: 35, Food: 25, Transport: 20, Activities: 20 },
    Balanced: { Lodging: 40, Food: 25, Transport: 15, Activities: 20 },
    Comfort: { Lodging: 45, Food: 20, Transport: 15, Activities: 20 },
  };

  const form = document.getElementById("budget-form");
  const resetButton = document.getElementById("reset-button");
  const saveButton = document.getElementById("save-button");
  const saveFeedback = document.getElementById("save-feedback");
  const emptyState = document.getElementById("empty-state");
  const resultsContent = document.getElementById("results-content");
  const statusPill = document.getElementById("status-pill");
  const totalBudgetValue = document.getElementById("total-budget-value");
  const dailyBudgetValue = document.getElementById("daily-budget-value");
  const perTravelerValue = document.getElementById("per-traveler-value");
  const dailyPerTravelerValue = document.getElementById("daily-per-traveler-value");
  const riskLevelValue = document.getElementById("risk-level-value");
  const styleSummary = document.getElementById("style-summary");
  const allocationList = document.getElementById("allocation-list");
  const runtimeNotice = document.getElementById("runtime-notice");

  let latestPlan = null;
  const isFilePreview = window.location.protocol === "file:";

  const fields = {
    tripName: document.getElementById("tripName"),
    destination: document.getElementById("destination"),
    budget: document.getElementById("budget"),
    days: document.getElementById("days"),
    travelers: document.getElementById("travelers"),
    style: document.getElementById("style"),
    notes: document.getElementById("notes"),
  };

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }

  function clearErrors() {
    document.querySelectorAll(".error-message").forEach((node) => {
      node.textContent = "";
    });
  }

  function setError(fieldName, message) {
    const node = document.querySelector(`[data-error-for="${fieldName}"]`);
    if (node) {
      node.textContent = message;
    }
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

  function getStatusClass(riskLevel) {
    if (riskLevel === "Too Tight") {
      return "tight";
    }
    if (riskLevel === "Balanced") {
      return "balanced";
    }
    return "comfortable";
  }

  function validate(values) {
    const errors = {};
    const tripName = values.tripName.trim();
    const destination = values.destination.trim();
    const notes = values.notes.trim();

    if (!tripName) {
      errors.tripName = "Trip name is required.";
    } else if (tripName.length < 2 || tripName.length > 40) {
      errors.tripName = "Trip name must be between 2 and 40 characters.";
    }

    if (!destination) {
      errors.destination = "Destination is required.";
    } else if (destination.length < 2 || destination.length > 50) {
      errors.destination = "Destination must be between 2 and 50 characters.";
    }

    if (Number.isNaN(values.budget)) {
      errors.budget = "Total budget is required.";
    } else if (values.budget < 100 || values.budget > 50000) {
      errors.budget = "Budget must be between 100 and 50000.";
    }

    if (Number.isNaN(values.days)) {
      errors.days = "Trip length is required.";
    } else if (values.days < 1 || values.days > 30) {
      errors.days = "Trip length must be between 1 and 30 days.";
    }

    if (Number.isNaN(values.travelers)) {
      errors.travelers = "Traveler count is required.";
    } else if (values.travelers < 1 || values.travelers > 10) {
      errors.travelers = "Traveler count must be between 1 and 10.";
    }

    if (!values.style) {
      errors.style = "Travel style is required.";
    }

    if (notes.length > 160) {
      errors.notes = "Notes must be 160 characters or fewer.";
    }

    return errors;
  }

  function createPlan(values) {
    const dailyBudget = values.budget / values.days;
    const perTravelerBudget = values.budget / values.travelers;
    const dailyPerTraveler = values.budget / values.days / values.travelers;
    const riskLevel = getRiskLevel(dailyPerTraveler);

    return {
      tripName: values.tripName.trim(),
      destination: values.destination.trim(),
      budget: values.budget,
      days: values.days,
      travelers: values.travelers,
      style: values.style,
      notes: values.notes.trim(),
      dailyBudget,
      perTravelerBudget,
      dailyPerTraveler,
      riskLevel,
      allocations: Object.entries(allocations[values.style]).map(([label, percent]) => ({
        label,
        percent,
        amount: Math.round((values.budget * percent) / 100),
      })),
    };
  }

  function renderPlan(plan) {
    totalBudgetValue.textContent = formatMoney(plan.budget);
    dailyBudgetValue.textContent = formatMoney(plan.dailyBudget);
    perTravelerValue.textContent = formatMoney(plan.perTravelerBudget);
    dailyPerTravelerValue.textContent = formatMoney(plan.dailyPerTraveler);
    riskLevelValue.textContent = plan.riskLevel;
    styleSummary.textContent = `${plan.style} allocation for ${plan.tripName} in ${plan.destination}`;

    statusPill.textContent = plan.riskLevel;
    statusPill.className = `status-pill ${getStatusClass(plan.riskLevel)}`;

    allocationList.innerHTML = "";
    plan.allocations.forEach((item) => {
      const node = document.createElement("article");
      node.className = "allocation-item";
      node.innerHTML = `
        <div class="allocation-row">
          <strong>${item.label}</strong>
          <span>${formatMoney(item.amount)}</span>
        </div>
        <div class="allocation-meta">
          <span>${item.percent}% of budget</span>
        </div>
        <div class="bar-track" aria-hidden="true">
          <div class="bar-fill" style="width: ${item.percent}%"></div>
        </div>
      `;
      allocationList.appendChild(node);
    });

    emptyState.classList.add("hidden");
    resultsContent.classList.remove("hidden");
    saveButton.disabled = false;
  }

  function resetUI() {
    form.reset();
    clearErrors();
    saveFeedback.textContent = "";
    latestPlan = null;
    totalBudgetValue.textContent = "--";
    dailyBudgetValue.textContent = "--";
    perTravelerValue.textContent = "--";
    dailyPerTravelerValue.textContent = "--";
    riskLevelValue.textContent = "--";
    styleSummary.textContent = "Style breakdown";
    allocationList.innerHTML = "";
    statusPill.textContent = "Awaiting input";
    statusPill.className = "status-pill muted";
    resultsContent.classList.add("hidden");
    emptyState.classList.remove("hidden");
    saveButton.disabled = true;
  }

  if (isFilePreview) {
    runtimeNotice.textContent = "Preview mode: this page is opened directly from disk. The design will render here, but saving trips and live data work fully at http://127.0.0.1:4180.";
    runtimeNotice.classList.remove("hidden");
  }

  Object.values(fields).forEach((field) => {
    field.addEventListener("input", function () {
      saveFeedback.textContent = "";
    });
    field.addEventListener("change", function () {
      saveFeedback.textContent = "";
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();
    saveFeedback.textContent = "";

    const values = {
      tripName: fields.tripName.value,
      destination: fields.destination.value,
      budget: Number(fields.budget.value),
      days: Number(fields.days.value),
      travelers: Number(fields.travelers.value),
      style: fields.style.value,
      notes: fields.notes.value,
    };

    const errors = validate(values);
    if (Object.keys(errors).length > 0) {
      Object.entries(errors).forEach(([fieldName, message]) => setError(fieldName, message));
      resultsContent.classList.add("hidden");
      emptyState.classList.remove("hidden");
      statusPill.textContent = "Fix inputs";
      statusPill.className = "status-pill tight";
      saveButton.disabled = true;
      latestPlan = null;
      return;
    }

    latestPlan = createPlan(values);
    renderPlan(latestPlan);
  });

  saveButton.addEventListener("click", async function () {
    if (!latestPlan) {
      return;
    }

    if (isFilePreview) {
      saveFeedback.textContent = "Saving requires the local server at http://127.0.0.1:4180.";
      statusPill.textContent = "Server required";
      statusPill.className = "status-pill balanced";
      return;
    }

    saveButton.disabled = true;
    saveFeedback.textContent = "Saving trip...";

    try {
      const response = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(latestPlan),
      });

      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload.error || "Unable to save trip.");
      }

      const payload = await response.json();
      saveFeedback.textContent = `Saved ${payload.trip.tripName} to history.`;
      statusPill.textContent = "Saved";
      statusPill.className = "status-pill comfortable";
    } catch (error) {
      saveFeedback.textContent = error.message;
      statusPill.textContent = "Save failed";
      statusPill.className = "status-pill tight";
    } finally {
      saveButton.disabled = false;
    }
  });

  resetButton.addEventListener("click", resetUI);
  resetUI();
})();
