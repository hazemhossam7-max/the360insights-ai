import assert from "node:assert/strict";
import { generateGroundedWebsiteTestCases } from "../../agent/grounded-website-testcases.mjs";

const cases = [
  {
    name: "generateGroundedWebsiteTestCases includes collection workflow cases for authenticated collections modules",
    run() {
      const suite = generateGroundedWebsiteTestCases(
        {
          url: "https://example.com/app",
          title: "Dashboard",
          sidebarModules: ["Dashboard", "Collections", "Training Planner"],
          pages: [
            {
              title: "Collections",
              url: "https://example.com/app/collections",
              headings: ["Collections"],
              buttons: ["Create Collection"],
              forms: [{ summary: "name; description" }],
              cards: [],
            },
          ],
        },
        { maxCases: 50 }
      );

      const workflowCase = suite.testCases.find((item) =>
        item.title === "Workflow: create collection and verify it persists after refresh"
      );

      assert.ok(workflowCase);
      assert.equal(workflowCase.action?.type, "create_collection");
      assert.equal(workflowCase.action?.module, "Collections");
      assert.equal(workflowCase.action?.locators?.submitButton, 'button:has-text("Create Collection")');
      assert.deepEqual(
        workflowCase.assertions?.map((item) => item.type),
        ["created_entity_visible", "refresh_and_created_entity_visible"]
      );
    },
  },
  {
    name: "generateGroundedWebsiteTestCases keeps the collection workflow inside the first 40 cases",
    run() {
      const suite = generateGroundedWebsiteTestCases(
        {
          url: "https://example.com/app",
          title: "Dashboard",
          sidebarModules: [
            "Dashboard",
            "Directory",
            "Athlete 360°",
            "Collections",
            "Competitions",
            "AI Opponent Analysis",
            "Technical Analysis",
            "Mental Analysis",
            "Training Planner",
            "Rank-Up Calculator",
          ],
          pages: [
            {
              title: "Collections",
              url: "https://example.com/app/collections",
              headings: ["Collections"],
              buttons: ["Create Collection"],
              forms: [{ summary: "name; description" }],
              cards: [],
            },
            {
              title: "Dashboard",
              url: "https://example.com/app",
              headings: ["Dashboard"],
              buttons: ["Open"],
              forms: [],
              cards: [],
            },
            {
              title: "Athletes",
              url: "https://example.com/app/athletes",
              headings: ["Athletes"],
              buttons: ["Filter"],
              forms: [],
              cards: [],
            },
            {
              title: "Competitions",
              url: "https://example.com/app/competitions",
              headings: ["Competitions"],
              buttons: ["Advanced Filters"],
              forms: [],
              cards: [],
            },
          ],
        },
        { maxCases: 40 }
      );

      const titles = suite.testCases.map((item) => item.title);
      assert.ok(titles.includes("Workflow: create collection and verify it persists after refresh"));
      assert.ok(titles.indexOf("Workflow: create collection and verify it persists after refresh") < 40);
    },
  },
  {
    name: "generateGroundedWebsiteTestCases omits collection workflow cases when collections are not discovered",
    run() {
      const suite = generateGroundedWebsiteTestCases(
        {
          url: "https://example.com/app",
          title: "Dashboard",
          sidebarModules: ["Dashboard", "Training Planner"],
          pages: [
            {
              title: "Training Planner",
              url: "https://example.com/app/training-planner",
              headings: ["Training Planner"],
              buttons: ["Create Training Plan"],
              forms: [{ summary: "name; description" }],
              cards: [],
            },
          ],
        },
        { maxCases: 50 }
      );

      assert.equal(
        suite.testCases.some((item) => item.title === "Workflow: create collection and verify it persists after refresh"),
        false
      );
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
