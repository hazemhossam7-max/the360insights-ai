import assert from "node:assert/strict";
import { buildWebsiteOpenAIBatches } from "../../agent/website-openai-plan.mjs";

const sampleBrief = {
  title: "Dashboard | The360 Insights",
  host: "the360insights.ai",
  authenticated: true,
  sidebarModules: [
    "Dashboard",
    "Directory",
    "Athlete 360°",
    "Technical Analysis",
    "HH Hazem Hosny Sports Analytics User",
  ],
  featureCandidates: [
    { feature: "Dashboard", evidence: ["https://the360insights.ai/"] },
    { feature: "Featured Athletes", evidence: ["https://the360insights.ai/"] },
    { feature: "Global Rankings", evidence: ["https://the360insights.ai/"] },
    { feature: "Advanced Filters", evidence: ["https://the360insights.ai/athletes"] },
    { feature: "Match Analysis", evidence: ["https://the360insights.ai/technical-analysis"] },
  ],
  notablePaths: ["/", "/athletes", "/technical-analysis"],
  pages: [
    {
      url: "https://the360insights.ai/",
      title: "Dashboard | The360 Insights",
      headings: ["Taekwondo", "Featured Athletes", "Global Rankings"],
      buttons: ["Egypt", "Select Weight"],
      forms: [],
      cards: ["Seif Eissa", "Moataz Bellah Asem"],
      importantLinks: [{ text: "Directory", href: "https://the360insights.ai/athletes" }],
    },
    {
      url: "https://the360insights.ai/athletes",
      title: "Directory | The360 Insights",
      headings: ["Available Athletes"],
      buttons: ["Advanced Filters", "Clear All Filters", "View 360° Analysis"],
      forms: [{ summary: "search, filters, weight" }],
      cards: [],
      importantLinks: [],
    },
    {
      url: "https://the360insights.ai/technical-analysis",
      title: "Technical Analysis | The360 Insights",
      headings: ["Match Analysis"],
      buttons: ["Select Weight"],
      forms: [{ summary: "athlete selector, match upload" }],
      cards: ["Recent Matches"],
      importantLinks: [],
    },
  ],
};

const cases = [
  {
    name: "buildWebsiteOpenAIBatches filters noisy module labels",
    run() {
      const plan = buildWebsiteOpenAIBatches(sampleBrief, 120, { batchSize: 12 });
      const modules = plan.modules.map((item) => item.module);
      assert.ok(modules.includes("Dashboard"));
      assert.ok(modules.includes("Directory"));
      assert.ok(!modules.includes("HH Hazem Hosny Sports Analytics User"));
    },
  },
  {
    name: "buildWebsiteOpenAIBatches creates module and shared batches",
    run() {
      const plan = buildWebsiteOpenAIBatches(sampleBrief, 120, { batchSize: 12 });
      assert.ok(plan.batches.some((item) => item.batchType === "module"));
      assert.ok(plan.batches.some((item) => item.batchType === "shared"));
      assert.equal(plan.batches.reduce((sum, item) => sum + item.targetCaseCount, 0), 120);
    },
  },
  {
    name: "buildWebsiteOpenAIBatches includes module detail evidence",
    run() {
      const plan = buildWebsiteOpenAIBatches(sampleBrief, 120, { batchSize: 12 });
      const directoryBatch = plan.batches.find((item) => item.module === "Directory");
      assert.ok(directoryBatch);
      assert.equal(directoryBatch.route, "/athletes");
      assert.ok(directoryBatch.content.discoveredSubfeatures.includes("Available Athletes"));
      assert.ok(directoryBatch.content.discoveredSubfeatures.includes("Advanced Filters"));
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
