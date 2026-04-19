import { createOpenAIClient } from "./openai-client.mjs";
import { createGeminiClient } from "./gemini-client.mjs";
import { generateTestCaseDrafts as generateHeuristicTestCaseDrafts } from "./story-to-tests.mjs";
import { expandWebsiteTestCases } from "./website-case-expander.mjs";
import { buildWebsiteOpenAIBatches } from "./website-openai-plan.mjs";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
    generationNotes: result?.generationNotes || "",
    generatedAt: new Date().toISOString(),
    testCases,
  };
}

function expandWebsiteResult(websiteBrief, result, source, options = {}) {
  const normalized = normalizeWebsiteResult(websiteBrief, result, source);
  const targetCaseCount = Math.max(
    1,
    Number(options.websiteTargetCaseCount || process.env.WEBSITE_TARGET_CASE_COUNT || 1000) || 1000
  );

  return {
    ...normalized,
    generationSource: `${normalized.generationSource}+expanded`,
    expandedFrom: normalized.testCases.length,
    targetCaseCount,
    testCases: expandWebsiteTestCases(websiteBrief, normalized.testCases, targetCaseCount),
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

  if (String(options.apiKey || process.env.OPENAI_API_KEY || "").trim()) {
    return "openai";
  }

  if (String(options.geminiApiKey || process.env.GEMINI_API_KEY || "").trim()) {
    return "gemini";
  }

  return "openai";
}

function resolveTargetCaseCount(content, kind) {
  if (kind === "website") {
    const featureCount = Array.isArray(content?.featureCandidates) ? content.featureCandidates.length : 0;
    const pageCount = Array.isArray(content?.pages) ? content.pages.length : 0;
    return Math.max(12, Math.min(16, 6 + featureCount * 2 + pageCount * 2));
  }

  const acceptanceCriteria = String(content?.acceptanceCriteria || content?.description || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean).length;

  return Math.max(3, Math.min(8, acceptanceCriteria || 3));
}

async function generateWithModel(content, options, kind, fallbackFactory) {
  const provider = resolveAiProvider(options);
  const heuristicFallbackEnabled = isTruthyFlag(
    options.allowHeuristicFallback ?? process.env.ALLOW_HEURISTIC_FALLBACK ?? ""
  );
  const fallback = fallbackFactory();
  const targetCaseCount = resolveTargetCaseCount(content, kind);

  try {
    const client =
      provider === "gemini"
        ? createGeminiClient({
            apiKey: options.geminiApiKey || process.env.GEMINI_API_KEY,
            model: options.geminiModel || process.env.GEMINI_MODEL || "gemini-2.5-flash",
            baseUrl: options.geminiBaseUrl || process.env.GEMINI_BASE_URL,
            targetCaseCount,
          })
        : createOpenAIClient({
            apiKey: options.apiKey || process.env.OPENAI_API_KEY,
            model: options.model || process.env.OPENAI_MODEL || "gpt-4o",
            baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
            targetCaseCount,
          });

    const result = await client.createResponse({ kind, content, targetCaseCount });
    if (kind === "website") {
      return expandWebsiteResult(content, result, provider, options);
    }

    if (provider === "gemini") {
      return normalizeGeminiResult(content, result);
    }

    return normalizeOpenAIResult(content, result);
  } catch (error) {
    if (heuristicFallbackEnabled) {
      const heuristic = {
        ...fallback,
        generationSource: "heuristic",
        model: null,
        generationNotes: error.message,
      };
      return kind === "website"
        ? expandWebsiteResult(content, heuristic, "heuristic", options)
        : heuristic;
    }

    const providerLabel = provider === "gemini" ? "Gemini" : "OpenAI";
    throw new Error(`${providerLabel} generation failed: ${error.message}`);
  }
}

function buildWebsiteGenerationSummary(websiteBrief, batches, createdCases) {
  const moduleNames = uniqueCompact(
    (batches || [])
      .map((batch) => batch.module)
      .filter(Boolean)
  );

  const focusItems = uniqueCompact(
    (batches || []).flatMap((batch) => batch.content?.batchFocusItems || [])
  );

  return cleanText(
    [
      `OpenAI generated ${createdCases.length} website test cases across ${moduleNames.length} modules.`,
      moduleNames.length ? `Modules: ${moduleNames.join(", ")}.` : "",
      focusItems.length ? `Representative subfeatures: ${focusItems.slice(0, 12).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function uniqueCompact(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((item) => cleanText(item))
        .filter(Boolean)
    )
  );
}

function dedupeNormalizedCases(testCases) {
  const seen = new Set();
  const output = [];

  for (const item of testCases || []) {
    const normalized = normalizeCase(item, output.length);
    const key = normalizeKey(
      [
        normalized.title,
        normalized.expectedResult,
        ...(normalized.steps || []),
      ].join(" ")
    );

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push({
      ...normalized,
      id: `TC-${String(output.length + 1).padStart(3, "0")}`,
    });
  }

  return output;
}

function buildSupplementalWebsiteBatches(plan, shortfall, existingCases, options = {}) {
  const batchSize = Math.max(
    8,
    Math.min(20, Number(options.openAiBatchSize || process.env.OPENAI_BATCH_CASE_COUNT || plan.batchSize || 12) || 12)
  );
  const existingTitles = uniqueCompact((existingCases || []).map((item) => item?.title)).slice(-24);
  const prioritizedTemplates = [
    ...(plan.batches || []).filter((batch) => batch.batchType === "module"),
    ...(plan.batches || []).filter((batch) => batch.batchType === "shared"),
  ];

  if (!prioritizedTemplates.length) {
    return [];
  }

  const supplements = [];
  let remaining = shortfall;
  let cursor = 0;

  while (remaining > 0) {
    const template = prioritizedTemplates[cursor % prioritizedTemplates.length];
    const currentTarget = Math.min(batchSize, remaining);
    remaining -= currentTarget;
    cursor += 1;

    supplements.push({
      ...template,
      targetCaseCount: currentTarget,
      maxOutputTokens: Math.max(5000, currentTarget * 320),
      instructions: [
        ...(template.instructions || []),
        "Generate additional cases that are materially different from previously generated ones for this same authenticated product area.",
        existingTitles.length
          ? `Avoid overlapping with these existing case titles: ${existingTitles.join(" | ")}.`
          : "",
      ].filter(Boolean),
      content: {
        ...(template.content || {}),
        existingCaseTitlesToAvoid: existingTitles,
      },
    });
  }

  return supplements;
}

async function collectWebsiteBatchCases(client, batches) {
  const rawCases = [];
  const batchNotes = [];

  for (let index = 0; index < (batches || []).length; index += 1) {
    const batch = batches[index];
    let result;
    try {
      result = await client.createResponse({
        kind: "website",
        content: batch.content,
        targetCaseCount: batch.targetCaseCount,
        maxOutputTokens: batch.maxOutputTokens,
        instructions: batch.instructions,
      });
    } catch (error) {
      const batchLabel = cleanText(
        batch.batchType === "module"
          ? `module ${batch.module || "unknown"}`
          : batch.batchLabel || `shared batch ${index + 1}`
      );
      throw new Error(
        `OpenAI batch ${index + 1}/${(batches || []).length} (${batchLabel}) failed: ${error.message}`
      );
    }

    const normalizedBatchCases = (result?.testCases || []).map(normalizeCase);
    rawCases.push(...normalizedBatchCases);
    batchNotes.push(
      cleanText(
        `${batch.batchType === "module" ? `module ${batch.module}` : batch.batchLabel}: ${normalizedBatchCases.length} cases`
      )
    );
  }

  return {
    rawCases,
    batchNotes,
  };
}

async function generateWebsiteCasesWithOpenAI(websiteBrief, options = {}) {
  const targetCaseCount = Math.max(
    1,
    Number(options.websiteTargetCaseCount || process.env.WEBSITE_TARGET_CASE_COUNT || 1000) || 1000
  );
  const client = createOpenAIClient({
    apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    model: options.model || process.env.OPENAI_MODEL || "gpt-4o",
    baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL,
    targetCaseCount: 12,
  });
  const plan = buildWebsiteOpenAIBatches(websiteBrief, targetCaseCount, {
    batchSize: Math.max(10, Math.min(20, Number(options.openAiBatchSize || process.env.OPENAI_BATCH_CASE_COUNT || 12) || 12)),
  });

  const initial = await collectWebsiteBatchCases(client, plan.batches);
  const batchNotes = [...initial.batchNotes];
  let deduped = dedupeNormalizedCases(initial.rawCases).slice(0, targetCaseCount);

  if (deduped.length < targetCaseCount) {
    const supplements = buildSupplementalWebsiteBatches(
      plan,
      targetCaseCount - deduped.length,
      deduped,
      options
    );
    if (supplements.length) {
      const supplemental = await collectWebsiteBatchCases(client, supplements);
      batchNotes.push(`supplemental_round: ${supplements.length} batches`);
      batchNotes.push(...supplemental.batchNotes);
      deduped = dedupeNormalizedCases([...deduped, ...supplemental.rawCases]).slice(0, targetCaseCount);
    }
  }

  if (!deduped.length) {
    throw new Error("OpenAI returned zero website test cases after batched generation.");
  }
  if (deduped.length < targetCaseCount) {
    throw new Error(
      `OpenAI generated ${deduped.length} unique website test cases, but ${targetCaseCount} were requested.`
    );
  }

  return {
    websiteUrl: String(websiteBrief?.url || "").trim(),
    websiteTitle: String(websiteBrief?.title || websiteBrief?.host || "").trim(),
    summary: buildWebsiteGenerationSummary(websiteBrief, plan.batches, deduped),
    generationSource: "openai-deep-modules",
    model: client.model,
    generationNotes: batchNotes.join(" | "),
    generatedAt: new Date().toISOString(),
    testCases: deduped,
  };
}

export async function generateTestCasesForStory(story, options = {}) {
  return generateWithModel(story, options, "story", () => generateHeuristicTestCaseDrafts(story));
}

export async function generateTestCasesForWebsite(websiteBrief, options = {}) {
  const provider = resolveAiProvider(options);
  const heuristicFallbackEnabled = isTruthyFlag(
    options.allowHeuristicFallback ?? process.env.ALLOW_HEURISTIC_FALLBACK ?? ""
  );

  if (provider === "openai") {
    try {
      return await generateWebsiteCasesWithOpenAI(websiteBrief, options);
    } catch (error) {
      if (heuristicFallbackEnabled) {
        const heuristic = {
          ...generateHeuristicTestCaseDrafts(websiteBrief),
          generationSource: "heuristic",
          model: null,
          generationNotes: error.message,
        };
        return expandWebsiteResult(websiteBrief, heuristic, "heuristic", options);
      }

      throw new Error(`OpenAI website generation failed: ${error.message}`);
    }
  }

  return generateWithModel(
    websiteBrief,
    options,
    "website",
    () => generateHeuristicTestCaseDrafts(websiteBrief)
  );
}
