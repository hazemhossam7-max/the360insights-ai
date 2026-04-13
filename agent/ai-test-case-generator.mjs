import { createOpenAIClient } from "./openai-client.mjs";
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

export async function generateTestCasesForStory(story, options = {}) {
  const fallback = generateHeuristicTestCaseDrafts(story);
  const apiKey = String(options.apiKey || process.env.OPENAI_API_KEY || "").trim();
  const allowHeuristicFallback = String(
    options.allowHeuristicFallback ?? process.env.ALLOW_HEURISTIC_FALLBACK ?? ""
  )
    .trim()
    .toLowerCase();
  const heuristicFallbackEnabled =
    allowHeuristicFallback === "1" ||
    allowHeuristicFallback === "true" ||
    allowHeuristicFallback === "yes" ||
    allowHeuristicFallback === "on";

  if (!apiKey) {
    if (heuristicFallbackEnabled) {
      return {
        ...fallback,
        generationSource: "heuristic",
        model: null,
        generationNotes: "OPENAI_API_KEY was not set.",
      };
    }

    throw new Error("OPENAI_API_KEY is required for AI generation.");
  }

  try {
    const client = createOpenAIClient({
      apiKey,
      model: options.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
      baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
    });
    const result = await client.createResponse(story);
    return normalizeOpenAIResult(story, result);
  } catch (error) {
    if (heuristicFallbackEnabled) {
      return {
        ...fallback,
        generationSource: "heuristic",
        model: null,
        generationNotes: error.message,
      };
    }

    throw new Error(`OpenAI generation failed: ${error.message}`);
  }
}
