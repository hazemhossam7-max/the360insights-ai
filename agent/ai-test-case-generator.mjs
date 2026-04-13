import { createOpenAIClient } from "./openai-client.mjs";
import { createGeminiClient } from "./gemini-client.mjs";
import { generateTestCaseDrafts as generateHeuristicTestCaseDrafts } from "./story-to-tests.mjs";

function normalizeCase(item, index) {
  const title = String(item?.title || "").trim();
  const preconditions = Array.isArray(item?.preconditions)
    ? item.preconditions.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const steps = Array.isArray(item?.steps)
    ? item.steps.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const expectedResult = String(item?.expectedResult || "").trim();
  const priority = ["High", "Medium", "Low"].includes(item?.priority) ? item.priority : "Medium";

  return {
    id: `TC-${String(index + 1).padStart(3, "0")}`,
    title: title || `Generated test case ${index + 1}`,
    preconditions: preconditions.length ? preconditions : ["The app is open and reachable."],
    steps: steps.length ? steps : ["Open the app and validate the user story flow."],
    expectedResult: expectedResult || "The expected story outcome is observed.",
    priority,
    automationCandidate: Boolean(item?.automationCandidate),
    sourceCriterion: String(item?.sourceFocus || item?.expectedResult || title || "").trim(),
  };
}

function normalizeOpenAIResult(story, result) {
  const summary = String(result?.summary || story?.description || "").trim();
  const testCases = (result?.testCases || []).map(normalizeCase);

  return {
    storyId: story?.id ?? null,
    storyTitle: String(result?.storyTitle || story?.title || "").trim(),
    summary,
    generationSource: "openai",
    model: result?.model || null,
    generatedAt: new Date().toISOString(),
    testCases,
  };
}

function normalizeGeminiResult(story, result) {
  const summary = String(result?.summary || story?.description || "").trim();
  const testCases = (result?.testCases || []).map(normalizeCase);

  return {
    storyId: story?.id ?? null,
    storyTitle: String(result?.storyTitle || story?.title || "").trim(),
    summary,
    generationSource: "gemini",
    model: result?.model || null,
    generatedAt: new Date().toISOString(),
    testCases,
  };
}

function normalizeWebsiteResult(websiteBrief, result, source) {
  const summary = String(result?.summary || websiteBrief?.summary || "").trim();
  const testCases = (result?.testCases || []).map(normalizeCase);

  return {
    websiteUrl: String(websiteBrief?.url || "").trim(),
    websiteTitle: String(result?.storyTitle || websiteBrief?.title || "").trim(),
    summary,
    generationSource: source,
    model: result?.model || null,
    generatedAt: new Date().toISOString(),
    testCases,
  };
}

function isTruthyFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveAiProvider(options) {
  const explicit = String(options.provider || process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicit === "gemini" || explicit === "openai") {
    return explicit;
  }

  if (String(options.geminiApiKey || process.env.GEMINI_API_KEY || "").trim()) {
    return "gemini";
  }

  return "openai";
}

async function generateWithModel(content, options, kind, fallbackFactory) {
  const provider = resolveAiProvider(options);
  const heuristicFallbackEnabled = isTruthyFlag(
    options.allowHeuristicFallback ?? process.env.ALLOW_HEURISTIC_FALLBACK ?? ""
  );
  const fallback = fallbackFactory();

  try {
    const client =
      provider === "gemini"
        ? createGeminiClient({
            apiKey: options.geminiApiKey || process.env.GEMINI_API_KEY,
            model: options.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
            baseUrl: options.geminiBaseUrl || process.env.GEMINI_BASE_URL,
          })
        : createOpenAIClient({
            apiKey: options.apiKey || process.env.OPENAI_API_KEY,
            model: options.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
            baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
          });

    const result = await client.createResponse({ kind, content });
    if (provider === "gemini") {
      return kind === "website"
        ? normalizeWebsiteResult(content, result, "gemini")
        : normalizeGeminiResult(content, result);
    }

    return kind === "website"
      ? normalizeWebsiteResult(content, result, "openai")
      : normalizeOpenAIResult(content, result);
  } catch (error) {
    if (heuristicFallbackEnabled) {
      return {
        ...fallback,
        generationSource: "heuristic",
        model: null,
        generationNotes: error.message,
      };
    }

    const providerLabel = provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(`${providerLabel} generation failed: ${error.message}`);
  }
}

export async function generateTestCasesForStory(story, options = {}) {
  return generateWithModel(story, options, "story", () => generateHeuristicTestCaseDrafts(story));
}

export async function generateTestCasesForWebsite(websiteBrief, options = {}) {
  return generateWithModel(
    websiteBrief,
    options,
    "website",
    () => generateHeuristicTestCaseDrafts(websiteBrief)
  );
}
