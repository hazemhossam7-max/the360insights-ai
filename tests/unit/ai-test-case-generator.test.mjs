import assert from "node:assert/strict";
import { generateTestCasesForWebsite } from "../../agent/ai-test-case-generator.mjs";

const sampleBrief = {
  url: "https://the360insights.ai/",
  title: "Dashboard | The360 Insights",
  host: "the360insights.ai",
  authenticated: true,
  source: "authenticated-app-discovery",
  sidebarModules: [
    "Dashboard",
    "Directory",
    "Athlete 360°",
    "Technical Analysis",
  ],
  featureCandidates: [
    { feature: "Featured Athletes", evidence: ["https://the360insights.ai/"] },
    { feature: "Advanced Filters", evidence: ["https://the360insights.ai/athletes"] },
    { feature: "Match Analysis", evidence: ["https://the360insights.ai/technical-analysis"] },
  ],
  notablePaths: ["/", "/athletes", "/technical-analysis"],
  pages: [
    {
      url: "https://the360insights.ai/",
      title: "Dashboard | The360 Insights",
      headings: ["Featured Athletes", "Global Rankings"],
      buttons: ["Select Weight", "View Athlete"],
      forms: [],
      cards: [],
      importantLinks: [{ text: "Directory", href: "https://the360insights.ai/athletes" }],
    },
    {
      url: "https://the360insights.ai/athletes",
      title: "Directory | The360 Insights",
      headings: ["Available Athletes"],
      buttons: ["Advanced Filters", "Clear All Filters"],
      forms: [{ summary: "search, filters, weight" }],
      cards: [],
      importantLinks: [],
    },
    {
      url: "https://the360insights.ai/technical-analysis",
      title: "Technical Analysis | The360 Insights",
      headings: ["Match Analysis"],
      buttons: ["Upload Match"],
      forms: [{ summary: "athlete selector, match upload" }],
      cards: ["Recent Matches"],
      importantLinks: [],
    },
  ],
};

function mockSuccessfulOpenAIFetch() {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    const requestedCount = Number(body?.text?.format?.schema?.properties?.testCases?.minItems || 1);
    const moduleMatch = String(body?.input || "").match(/"module":\s*"([^"]+)"/);
    const moduleLabel = moduleMatch?.[1] || `Shared-${calls.length + 1}`;
    const testCases = Array.from({ length: requestedCount }, (_, index) => ({
      title: `${moduleLabel} scenario ${calls.length + 1}-${index + 1}`,
      preconditions: ["The user is logged in and the authenticated shell is visible."],
      steps: [
        `Open the ${moduleLabel} area.`,
        `Execute interaction ${index + 1} for ${moduleLabel}.`,
      ],
      expectedResult: `${moduleLabel} interaction ${index + 1} completes successfully.`,
      priority: index % 3 === 0 ? "High" : "Medium",
      automationCandidate: true,
    }));

    calls.push({
      requestedCount,
      moduleLabel,
    });

    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          output_text: JSON.stringify({
            storyTitle: moduleLabel,
            summary: `${moduleLabel} batch`,
            testCases,
          }),
        };
      },
    };
  };

  return {
    calls,
    restore() {
      global.fetch = originalFetch;
    },
  };
}

const cases = [
  {
    name: "generateTestCasesForWebsite returns exact OpenAI deep-module coverage without heuristic expansion",
    async run() {
      const mock = mockSuccessfulOpenAIFetch();

      try {
        const result = await generateTestCasesForWebsite(sampleBrief, {
          provider: "openai",
          apiKey: "test-key",
          websiteTargetCaseCount: 40,
          openAiBatchSize: 10,
          allowHeuristicFallback: "false",
        });

        assert.equal(result.generationSource, "openai-deep-modules");
        assert.equal(result.testCases.length, 40);
        assert.ok(mock.calls.length > 1);
        assert.match(result.summary, /OpenAI generated 40 website test cases/i);
        assert.ok(
          result.testCases.every((item) => !String(item.title || "").toLowerCase().includes("happy path"))
        );
      } finally {
        mock.restore();
      }
    },
  },
  {
    name: "generateTestCasesForWebsite throws when OpenAI fails and heuristic fallback is disabled",
    async run() {
      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        async json() {
          return {
            error: {
              message: "invalid api key",
            },
          };
        },
      });

      try {
        await assert.rejects(
          generateTestCasesForWebsite(sampleBrief, {
            provider: "openai",
            apiKey: "bad-key",
            websiteTargetCaseCount: 20,
            allowHeuristicFallback: "false",
          }),
          /OpenAI website generation failed: OpenAI batch 1\/4 \(module Directory\) failed: OpenAI transport error: OpenAI request failed \(401\): invalid api key/
        );
      } finally {
        global.fetch = originalFetch;
      }
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
