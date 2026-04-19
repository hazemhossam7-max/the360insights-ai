import assert from "node:assert/strict";
import { createOpenAIClient } from "../../agent/openai-client.mjs";

const cases = [
  {
    name: "createOpenAIClient ignores unresolved OPENAI_BASE_URL placeholders",
    async run() {
      const originalFetch = global.fetch;
      const requests = [];
      global.fetch = async (url, options = {}) => {
        requests.push(String(url));
        const body = JSON.parse(options.body);
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
  {
    name: "createOpenAIClient retries transient fetch failures before succeeding",
    async run() {
      const originalFetch = global.fetch;
      const requests = [];
      let attempts = 0;
      global.fetch = async (url) => {
        attempts += 1;
        requests.push(String(url));
        if (attempts < 3) {
          throw new TypeError("fetch failed");
        }

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
          maxRetries: 3,
          requestTimeoutMs: 5000,
        });

        const result = await client.createResponse({
          kind: "website",
          content: { module: "Dashboard" },
          targetCaseCount: 1,
        });

        assert.equal(attempts, 3);
        assert.equal(requests.length, 3);
        assert.equal(result.testCases.length, 1);
      } finally {
        global.fetch = originalFetch;
      }
    },
  },
  {
    name: "createOpenAIClient retries invalid JSON output with a repair prompt",
    async run() {
      const originalFetch = global.fetch;
      const prompts = [];
      let attempts = 0;
      global.fetch = async (_url, options = {}) => {
        attempts += 1;
        const body = JSON.parse(options.body);
        prompts.push(String(body.input || ""));
        if (attempts === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            async json() {
              return {
                output_text: "{invalid json",
              };
            },
          };
        }

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
          maxRetries: 3,
        });

        const result = await client.createResponse({
          kind: "website",
          content: { module: "AI Opponent Analysis" },
          targetCaseCount: 1,
        });

        assert.equal(attempts, 2);
        assert.match(prompts[1], /Previous response could not be accepted\./);
        assert.equal(result.testCases.length, 1);
      } finally {
        global.fetch = originalFetch;
      }
    },
  },
  {
    name: "createOpenAIClient defaults to gpt-4o",
    async run() {
      const originalFetch = global.fetch;
      const models = [];
      global.fetch = async (_url, options = {}) => {
        const body = JSON.parse(options.body);
        models.push(body.model);
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
        });

        await client.createResponse({
          kind: "website",
          content: { module: "Dashboard" },
          targetCaseCount: 1,
        });

        assert.equal(models[0], "gpt-4o");
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
