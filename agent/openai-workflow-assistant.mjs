function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

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
      if (typeof content?.text === "string" && content.text.trim()) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["diagnosis", "actions"],
    properties: {
      diagnosis: { type: "string" },
      actions: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type"],
          properties: {
            type: {
              type: "string",
              enum: ["click_text", "click_selector", "fill_selector", "press_key", "choose_first_option"],
            },
            text: { type: "string" },
            selector: { type: "string" },
            value: { type: "string" },
            key: { type: "string" },
          },
        },
      },
    },
  };
}

function buildPrompt({ goal, errorMessage, pageSnapshot }) {
  return [
    "You are helping a browser automation agent recover a stuck workflow.",
    "Return only valid JSON matching the schema.",
    "Prefer minimal safe recovery steps that satisfy required inputs and continue the workflow.",
    "Use only visible controls described in the page snapshot.",
    "If the form is blocked by prerequisite selection, select the first valid option.",
    "Do not invent selectors unrelated to the snapshot.",
    "",
    `Goal: ${cleanText(goal)}`,
    `Current failure: ${cleanText(errorMessage)}`,
    "",
    "Page snapshot:",
    JSON.stringify(pageSnapshot, null, 2),
  ].join("\n");
}

export function canUseOpenAIWorkflowAssistant() {
  return Boolean(readEnv("OPENAI_API_KEY"));
}

export async function planWorkflowRecovery({ goal, errorMessage, pageSnapshot }) {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    return null;
  }

  const model = readEnv("OPENAI_WORKFLOW_MODEL", "OPENAI_MODEL") || "gpt-4o";
  const baseUrl = normalizeBaseUrl(readEnv("OPENAI_BASE_URL"));
  const requestBody = {
    model,
    input: buildPrompt({ goal, errorMessage, pageSnapshot }),
    temperature: 0.1,
    max_output_tokens: 1200,
    text: {
      format: {
        type: "json_schema",
        name: "workflow_recovery_plan",
        strict: true,
        schema: buildSchema(),
      },
    },
  };

  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || response.statusText || "Request failed";
    throw new Error(`OpenAI workflow assist failed (${response.status}): ${message}`);
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error("OpenAI workflow assist returned no text output.");
  }

  const parsed = JSON.parse(text);
  return {
    diagnosis: cleanText(parsed?.diagnosis || ""),
    actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
  };
}
