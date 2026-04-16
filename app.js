(function () {
function loadAppScript() {
  if (document.querySelector('script[src="./planner.js"]')) {
    return;
  }

    const script = document.createElement("script");
    script.src = "./planner.js";
    document.head.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPlannerScript, { once: true });
    return;
  }

loadAppScript();
})();
