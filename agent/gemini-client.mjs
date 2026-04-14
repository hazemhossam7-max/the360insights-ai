function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function extractText(response) {
  const chunks = [];

  for (const candidate of response?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function stripCodeFences(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonText(text) {
  const cleaned = stripCodeFences(text);
  if (!cleaned) {
    return "";
  }

  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");
  if (firstObject !== -1 && lastObject !== -1 && lastObject > firstObject) {
    return cleaned.slice(firstObject, lastObject + 1).trim();
  }

  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    return cleaned.slice(firstArray, lastArray + 1).trim();
  }

  return cleaned;
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
            "Generate the most useful manual test cases for the website brief below.",
            "Think like a test designer: include navigation, form, negative, boundary, and integration coverage when relevant.",
            "Prioritize the discovered user journeys and feature candidates.",
            `Generate at least ${targetCaseCount} distinct test cases if the website surface supports it.`,
            "Do not write implementation details.",
            "Use concise but complete steps.",
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

export function createGeminiClient(config) {
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "gemini-2.5-flash").trim();
  const baseUrl = trimTrailingSlash(config.baseUrl || "https://generativelanguage.googleapis.com/v1beta");

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for AI generation.");
  }

  async function createResponse(request = {}) {
    const prompt = buildPrompt(request);
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: buildSchema(request?.targetCaseCount),
          temperature: 0.2,
          maxOutputTokens: 1600,
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText || "Request failed";
      throw new Error(`Gemini request failed (${response.status}): ${message}`);
    }

    const text = extractText(payload);
    if (!text) {
      throw new Error("Gemini returned no text output.");
    }

    let parsed;
    try {
      parsed = JSON.parse(extractJsonText(text));
    } catch {
      throw new Error("Gemini returned invalid JSON output.");
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
