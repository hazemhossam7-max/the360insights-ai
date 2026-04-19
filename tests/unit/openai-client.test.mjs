import assert from "node:assert/strict";
import { createOpenAIClient } from "../../agent/openai-client.mjs";

const cases = [
  {
    name: "createOpenAIClient ignores unresolved OPENAI_BASE_URL placeholders",
    async run() {
      const originalFetch = global.fetch;
      const requests = [];
      global.fetch = async (url) => {
        requests.push(String(url));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async json() {
            return {
              output_text: JSON.stringify({
                storyTitle: "Batch",
                summary: "Summary",
                testCases: [
                  {
                    title: "Case 1",
                    preconditions: ["Logged in"],
                    steps: ["Open dashboard"],
                    expectedResult: "Dashboard loads",
                    priority: "High",
                    automationCandidate: true,
                  },
                ],
              }),
            };
          },
        };
      };

      try {
        const client = createOpenAIClient({
          apiKey: "test-key",
          baseUrl: "$(OPENAI_BASE_URL)",
        });

        const result = await client.createResponse({
          kind: "website",
          content: { module: "Dashboard" },
          targetCaseCount: 1,
        });

        assert.equal(requests[0], "https://api.openai.com/v1/responses");
        assert.equal(result.testCases.length, 1);
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
