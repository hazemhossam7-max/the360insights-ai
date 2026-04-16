function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response?.output || []) {
    if (!item || item.type !== "message") {
      continue;
    }
    for (const content of item.content || []) {
      if (!content) {
        continue;
      }
      if (typeof content.text === "string" && content.text.trim()) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function buildSchema(targetCaseCount = 1) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["storyTitle", "summary", "testCases"],
    properties: {
      storyTitle: { type: "string" },
      summary: { type: "string" },
      testCases: {
        type: "array",
        minItems: Math.max(1, Number(targetCaseCount) || 1),
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "preconditions", "steps", "expectedResult", "priority", "automationCandidate"],
          properties: {
            title: { type: "string" },
            preconditions: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            steps: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            expectedResult: { type: "string" },
            priority: {
              type: "string",
              enum: ["High", "Medium", "Low"],
            },
            automationCandidate: { type: "boolean" },
          },
        },
      },
    },
  };
}

export function createOpenAIClient(config) {
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "gpt-4o-mini").trim();
  const baseUrl = trimTrailingSlash(config.baseUrl || "https://api.openai.com");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for AI generation.");
  }

  function buildPrompt(request) {
    const kind = String(request?.kind || "story").trim().toLowerCase();
    const content = request?.content ?? request;
    const targetCaseCount = Math.max(1, Number(request?.targetCaseCount) || 1);
    const baseInstructions =
      Array.isArray(request?.instructions) && request.instructions.length
        ? request.instructions.map((item) => String(item).trim()).filter(Boolean)
        : kind === "website"
          ? [
              "You are a senior QA lead.",
              "Generate the most useful website test cases for the brief below.",
              "Focus on concrete visible behavior from the observed pages, headings, buttons, links, forms, and feature candidates.",
              "Prefer specific titles such as billing, login, dashboard, pricing, navigation, search, support, or content sections when the site evidence supports them.",
              "Avoid vague titles like generic happy path or typical user flow unless the site evidence truly warrants them.",
              "Think like a test designer: include navigation, form, negative, boundary, responsive, accessibility, and content coverage when relevant.",
              `Generate at least ${targetCaseCount} distinct test cases if the website surface supports it.`,
              "Do not write implementation details.",
              "Use concise but complete steps that a human tester could follow.",
              "Tie each case to the actual site structure and evidence in the brief.",
              "Return only structured JSON that matches the provided schema.",
            ]
          : [
              "You are a senior QA lead.",
              "Generate the most useful manual test cases for the Azure DevOps User Story below.",
              "Think like a test designer: include happy path, negative, boundary, and integration coverage when relevant.",
              `Generate at least ${targetCaseCount} distinct test cases if the story has enough acceptance criteria or scenarios.`,
              "Do not write implementation details.",
              "Use concise but complete steps.",
              "Return only structured JSON that matches the provided schema.",
            ];

    const label =
      kind === "website"
        ? "Website brief:"
        : kind === "story"
          ? "User story:"
          : `${kind} brief:`;

    return [...baseInstructions, "", label, JSON.stringify(content, null, 2)].join("\n");
  }

  async function createResponse(request = {}) {
    const prompt = buildPrompt(request);

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        temperature: 0.2,
        max_output_tokens: 1600,
        text: {
          format: {
            type: "json_schema",
            name: "trip_budget_test_cases",
            strict: true,
            schema: buildSchema(request?.targetCaseCount),
          },
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || "Request failed";
      throw new Error(`OpenAI request failed (${response.status}): ${message}`);
    }

    const text = extractOutputText(payload);
    if (!text) {
      throw new Error("OpenAI returned no text output.");
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("OpenAI returned invalid JSON output.");
    }

    return {
      model,
      storyTitle: String(parsed.storyTitle || "").trim(),
      summary: String(parsed.summary || "").trim(),
      testCases: Array.isArray(parsed.testCases) ? parsed.testCases : [],
      raw: parsed,
    };
  }

  return {
    model,
    createResponse,
  };
}
