import assert from "node:assert/strict";
import { classifyFailure } from "../../agent/failure-classifier.mjs";

const cases = [
  {
    name: "classifyFailure does not treat generic feature misses as auth failures on protected pages",
    run() {
      const classification = classifyFailure({
        error: new Error('Could not validate the "athlete card" feature on the site.'),
        pageContext: {
          url: "https://the360insights.ai/",
          title: "Dashboard | The360 Insights",
          reachedProtectedPage: true,
        },
        authState: {
          reachedProtectedPage: true,
        },
      });

      assert.equal(classification, "Unsupported/unconfirmed feature assumption");
    },
  },
  {
    name: "classifyFailure still identifies explicit auth failures",
    run() {
      const classification = classifyFailure({
        error: new Error("The authenticated session is not available for reuse on the current page."),
        pageContext: {
          url: "https://the360insights.ai/login",
          title: "Login | The360 Insights",
          reachedProtectedPage: false,
        },
        authState: {
          authenticated: false,
        },
      });

      assert.equal(classification, "Authentication/access issue");
    },
  },
  {
    name: "classifyFailure treats runner workflow gaps as automation issues",
    run() {
      const error = new Error("Could not find a create action for Codex Training Plan.");
      error.classification = "automation_issue";

      const classification = classifyFailure({
        error,
        pageContext: {
          url: "https://the360insights.ai/training-planner",
          title: "Training Planner | The360 Insights",
          reachedProtectedPage: true,
        },
        authState: {
          reachedProtectedPage: true,
        },
      });

      assert.equal(classification, "Automation issue");
    },
  },
];

let failures = 0;

for (const entry of cases) {
  try {
    await entry.run();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error?.stack || error?.message || String(error));
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS ${cases.length} tests`);
}
