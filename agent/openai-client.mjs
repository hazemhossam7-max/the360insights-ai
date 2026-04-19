function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isUnresolvedPlaceholder(value) {
  const text = String(value || "").trim();
  return /^\$\([^)]+\)$/.test(text) || /^\$\{[^}]+\}$/.test(text);
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || isUnresolvedPlaceholder(raw)) {
    return "https://api.openai.com";
  }

  return trimTrailingSlash(raw);
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
  const requestedCount = Math.max(1, Number(targetCaseCount) || 1);
  return {
    type: "object",
    additionalProperties: false,
    required: ["storyTitle", "summary", "testCases"],
    properties: {
      storyTitle: { type: "string" },
      summary: { type: "string" },
      testCases: {
        type: "array",
        minItems: requestedCount,
        maxItems: requestedCount,
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
  const baseUrl = normalizeBaseUrl(config.baseUrl);

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
              "Prefer specific titles such as billing, login, dashboard, history, compare, insights, pricing, navigation, search, support, charts, tables, or content sections when the site evidence supports them.",
              "Avoid vague titles like generic happy path or typical user flow unless the site evidence truly warrants them.",
              "Think like a test designer: include navigation, form, negative, boundary, responsive, accessibility, performance, and content coverage when relevant.",
              `Generate a diverse seed set of at least ${targetCaseCount} distinct cases if the website surface supports it.`,
              "Each seed case should map to a distinct feature, page, route, or visible interaction that appears in the evidence.",
              "The runner will expand these seed cases into a much larger suite, so focus on breadth and specificity instead of repetitive permutations.",
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
    const requestedCount = Math.max(1, Number(request?.targetCaseCount || config.targetCaseCount || 1));
    const maxOutputTokens = Math.max(
      1600,
      Number(request?.maxOutputTokens || 0) || (requestedCount > 8 ? requestedCount * 320 : 1600)
    );

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
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "qa_test_cases",
            strict: true,
            schema: buildSchema(requestedCount),
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

    const parsedCases = Array.isArray(parsed.testCases) ? parsed.testCases : [];
    if (parsedCases.length !== requestedCount) {
      throw new Error(
        `OpenAI returned ${parsedCases.length} test cases, but ${requestedCount} were required for this batch.`
      );
    }

    return {
      model,
      storyTitle: String(parsed.storyTitle || "").trim(),
      summary: String(parsed.summary || "").trim(),
      testCases: parsedCases,
      maxOutputTokens,
      raw: parsed,
    };
  }

  return {
    model,
    createResponse,
  };
}
