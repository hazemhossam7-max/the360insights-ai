import http from "node:http";
import { createAzureDevOpsClient, resolveWorkItemId } from "./azure-devops-client.mjs";
import { analyzeWebsite } from "./website-analyzer.mjs";
import { generateTestCasesForStory, generateTestCasesForWebsite } from "./ai-test-case-generator.mjs";
import { createTestPlansClient } from "./testplans-client.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

process.on("unhandledRejection", (error) => {
  console.error(`[process] unhandled rejection: ${error?.stack || error?.message || error}`);
});

process.on("uncaughtException", (error) => {
  console.error(`[process] uncaught exception: ${error?.stack || error?.message || error}`);
});

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON payload."));
      }
    });

    req.on("error", reject);
  });
}

function parseTags(value) {
  return String(value || "")
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function extractTitleFromMessage(text) {
  const message = String(text || "").trim();
  if (!message) {
    return "";
  }

  const titleMatch = message.match(/\((.*?)\)\s+(?:updated|created|deleted|commented)\s+by\b/i);
  if (titleMatch?.[1]?.trim()) {
    return titleMatch[1].trim();
  }

  const fallbackMatch = message.match(/\(([^()]+)\)/);
  if (fallbackMatch?.[1]?.trim()) {
    return fallbackMatch[1].trim();
  }

  return "";
}

function extractDetailedMessageText(payload) {
  const parts = [
    payload?.detailedMessage?.text,
    payload?.detailedMessage?.markdown,
    payload?.message?.text,
    payload?.message?.markdown,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return parts.join("\n").trim();
}

function buildStoryFromWebhookPayload(payload, workItemId) {
  const fields = payload?.resource?.fields || {};
  const detailedText = extractDetailedMessageText(payload);
  const titleFromFields = String(fields["System.Title"] || "").trim();
  const titleFromMessage = extractTitleFromMessage(payload?.message?.text || payload?.message?.markdown || "");
  const descriptionFromFields = String(fields["System.Description"] || "").trim();
  const acceptanceCriteriaFromFields = String(fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "").trim();

  return {
    id: Number(workItemId) || Number(fields["System.Id"]) || null,
    url: String(payload?.resource?.url || "").trim(),
    rev: payload?.resource?.rev || null,
    title: titleFromFields || titleFromMessage || `Work item ${workItemId}`,
    description: descriptionFromFields || detailedText || titleFromMessage || "",
    acceptanceCriteria:
      acceptanceCriteriaFromFields || descriptionFromFields || detailedText || titleFromMessage || "",
    type: String(fields["System.WorkItemType"] || "").trim(),
    tags: parseTags(fields["System.Tags"]),
    state: String(fields["System.State"] || "").trim(),
    areaPath: String(fields["System.AreaPath"] || "").trim(),
    iterationPath: String(fields["System.IterationPath"] || "").trim(),
    source: "webhook-payload",
  };
}

function getConfig() {
  const config = {
    orgUrl: readEnv("AZDO_ORG_URL", "azdo.org.url"),
    project: readEnv("AZDO_PROJECT", "azdo.project"),
    pat: readEnv("AZDO_PAT", "azdo.pat"),
    testPlanId: readEnv("AZDO_TEST_PLAN_ID", "azdo.test.plan.id"),
    testSuiteId: readEnv("AZDO_TEST_SUITE_ID", "azdo.test.suite.id"),
    openAiApiKey: readEnv("OPENAI_API_KEY", "openai.key"),
    openAiModel: readEnv("OPENAI_MODEL", "openai.model"),
    openAiBaseUrl: readEnv("OPENAI_BASE_URL", "openai.base.url"),
    allowHeuristicFallback: readEnv("ALLOW_HEURISTIC_FALLBACK", "openai.fallback"),
  };

  return config;
}

function summarizeConfig(config) {
  return {
    orgUrlPresent: Boolean(config.orgUrl),
    projectPresent: Boolean(config.project),
    patPresent: Boolean(config.pat),
    testPlanIdPresent: Boolean(config.testPlanId),
    testSuiteIdPresent: Boolean(config.testSuiteId),
    openAiApiKeyPresent: Boolean(config.openAiApiKey),
    openAiModel: config.openAiModel || null,
    openAiBaseUrlPresent: Boolean(config.openAiBaseUrl),
    heuristicFallbackEnabled: Boolean(config.allowHeuristicFallback),
    patLength: config.pat ? String(config.pat).length : 0,
    orgUrl: config.orgUrl || null,
    project: config.project || null,
  };
}

function isProcessableStoryType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    "issue",
    "user story",
    "product backlog item",
    "bug",
    "requirement",
  ].includes(normalized);
}

function normalizeWebsiteUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new Error("A website URL is required.");
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  parsed.hash = "";
  return parsed.toString();
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)) {
    return parsed;
  }
  return null;
}

async function uploadGeneratedTests(config, testCaseDrafts) {
  const planId = parsePositiveInteger(config.testPlanId);
  const suiteId = parsePositiveInteger(config.testSuiteId);
  const testPlanLabel =
    String(testCaseDrafts?.websiteTitle || testCaseDrafts?.storyTitle || "Generated Test Cases").trim();

  if (!planId || !suiteId) {
    return {
      skipped: true,
      reason: "AZDO_TEST_PLAN_ID and AZDO_TEST_SUITE_ID were not both set.",
    };
  }

  const client = createTestPlansClient(config);
  const createdCases = [];

  for (const draft of testCaseDrafts.testCases) {
    const created = await client.createTestCaseWorkItem(draft);
    createdCases.push(created);
  }

  let added;
  let targetSuiteId = suiteId;

  try {
    added = await client.addTestCasesToSuite({
      planId,
      suiteId,
      testCaseIds: createdCases.map((item) => item.id),
    });
  } catch (error) {
    const suiteLinkLimitHit = /TF237201|1000 link limit/i.test(String(error?.message || ""));
    if (!suiteLinkLimitHit) {
      throw error;
    }

    const fallbackSuiteName = `${testPlanLabel.slice(0, 80)} (${new Date().toISOString().slice(0, 10)})`;
    console.warn(
      `[webhook] suite ${suiteId} hit the link limit, creating a new suite named "${fallbackSuiteName}"`
    );
    const createdSuite = await client.createTestSuite({
      planId,
      parentSuiteId: suiteId,
      name: fallbackSuiteName,
    });
    targetSuiteId = createdSuite.id;
    added = await client.addTestCasesToSuite({
      planId,
      suiteId: targetSuiteId,
      testCaseIds: createdCases.map((item) => item.id),
    });
  }

  return {
    skipped: false,
    planId,
    suiteId: targetSuiteId,
    createdCases,
    added,
  };
}

async function processWebhook(payload, workItemId, client, config) {
  console.log(`[webhook] background processing started for work item ${workItemId}`);

  let workItem;
  try {
    workItem = await client.getWorkItem(workItemId);
  } catch (fetchError) {
    const fallbackAllowed = /401|403|404/.test(String(fetchError?.message || ""));
    if (!fallbackAllowed) {
      throw fetchError;
    }

    workItem = buildStoryFromWebhookPayload(payload, workItemId);
    console.warn(
      `[webhook] Azure DevOps read failed, using webhook payload fallback for work item ${workItemId}: ${fetchError.message}`
    );
  }

  if (!workItem?.title) {
    workItem = buildStoryFromWebhookPayload(payload, workItemId);
  }

  if (!isProcessableStoryType(workItem?.type)) {
    console.log(
      `[webhook] skipping work item ${workItem.id} because type "${workItem.type || "unknown"}" is not a story type`
    );
    return { skipped: true, reason: `Unsupported work item type: ${workItem.type || "unknown"}` };
  }

  console.log(`[webhook] processing work item: ${workItem.id} - ${workItem.title}`);
  console.log(
    `[webhook] generating test cases with OpenAI model ${config.openAiModel || "gpt-4o-mini"}`
  );

  const testCaseDrafts = await generateTestCasesForStory(workItem, {
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    baseUrl: config.openAiBaseUrl,
    allowHeuristicFallback: config.allowHeuristicFallback,
  });

  console.log(
    `[webhook] generated ${testCaseDrafts.testCases.length} test case(s) using ${testCaseDrafts.generationSource}`
  );

  const uploadResult = await uploadGeneratedTests(config, testCaseDrafts);
  if (uploadResult?.skipped) {
    console.log(`[webhook] upload skipped: ${uploadResult.reason}`);
  } else {
    console.log(
      `[webhook] uploaded ${uploadResult.createdCases.length} test case(s) to plan ${uploadResult.planId}, suite ${uploadResult.suiteId}`
    );
  }

  console.log(`[webhook] background processing finished for work item ${workItemId}`);
  return { workItem, testCaseDrafts, uploadResult };
}

async function processWebsiteUrl(url, config) {
  console.log(`[website] background processing started for ${url}`);
  const websiteBrief = await analyzeWebsite(url);
  console.log(
    `[website] analyzed ${websiteBrief.pages.length} page(s) and ${websiteBrief.featureCandidates.length} feature candidate(s)`
  );

  const testCaseDrafts = await generateTestCasesForWebsite(websiteBrief, {
    apiKey: config.openAiApiKey,
    model: config.openAiModel,
    baseUrl: config.openAiBaseUrl,
    allowHeuristicFallback: true,
  });

  console.log(
    `[website] generated ${testCaseDrafts.testCases.length} test case(s) using ${testCaseDrafts.generationSource}`
  );

  const uploadResult = await uploadGeneratedTests(config, testCaseDrafts);
  if (uploadResult?.skipped) {
    console.log(`[website] upload skipped: ${uploadResult.reason}`);
  } else {
    console.log(
      `[website] uploaded ${uploadResult.createdCases.length} test case(s) to plan ${uploadResult.planId}, suite ${uploadResult.suiteId}`
    );
  }

  console.log(`[website] background processing finished for ${url}`);
  return { websiteBrief, testCaseDrafts, uploadResult };
}

async function handleWebhook(req, res) {
  console.log(`[webhook] ${new Date().toISOString()} received request`);
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    console.error(`[webhook] invalid payload: ${error.message}`);
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  let client;
  try {
    const config = getConfig();
    console.log(`[webhook] config summary: ${JSON.stringify(summarizeConfig(config))}`);
    client = createAzureDevOpsClient(config);
  } catch (error) {
    console.error(`[webhook] config error: ${error.message}`);
    sendJson(res, 500, { ok: false, error: error.message });
    return;
  }

  const workItemId = resolveWorkItemId(payload);
  if (!workItemId) {
    console.error("[webhook] could not resolve work item id from payload");
    sendJson(res, 400, {
      ok: false,
      error: "Could not determine the Azure DevOps work item id from the webhook payload.",
    });
    return;
  }

  try {
    console.log(`[webhook] resolved work item id: ${workItemId}`);
    const config = getConfig();
    sendJson(res, 200, {
      ok: true,
      message: "Webhook received and queued for processing.",
      workItemId,
    });

    setImmediate(() => {
      void processWebhook(payload, workItemId, client, config).catch((error) => {
        console.error(`[webhook] background processing failed: ${error.stack || error.message}`);
      });
    });
  } catch (error) {
    console.error(`[webhook] processing failed: ${error.stack || error.message}`);
    sendJson(res, 502, { ok: false, error: error.message });
  }
}

async function handleWebsiteInspection(req, res, urlFromQuery = "") {
  console.log(`[website] ${new Date().toISOString()} received request`);
  let payload = {};

  if (req.method === "POST") {
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      console.error(`[website] invalid payload: ${error.message}`);
      sendJson(res, 400, { ok: false, error: error.message });
      return;
    }
  }

  const rawUrl = String(payload?.url || payload?.websiteUrl || urlFromQuery || "").trim();
  let websiteUrl;
  try {
    websiteUrl = normalizeWebsiteUrl(rawUrl);
  } catch (error) {
    console.error(`[website] invalid url: ${error.message}`);
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  let config;
  try {
    config = getConfig();
    console.log(`[website] config summary: ${JSON.stringify(summarizeConfig(config))}`);
  } catch (error) {
    console.error(`[website] config error: ${error.message}`);
    sendJson(res, 500, { ok: false, error: error.message });
    return;
  }

  try {
    sendJson(res, 200, {
      ok: true,
      message: "Website URL received and queued for processing.",
      url: websiteUrl,
    });

    setImmediate(() => {
      void processWebsiteUrl(websiteUrl, config).catch((error) => {
        console.error(`[website] background processing failed: ${error.stack || error.message}`);
      });
    });
  } catch (error) {
    console.error(`[website] processing failed: ${error.stack || error.message}`);
    sendJson(res, 502, { ok: false, error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "trip-budget-agent",
      status: "healthy",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    sendText(
      res,
      200,
      "Trip Budget Agent is running. POST Azure DevOps service hooks to /webhook."
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    await handleWebhook(req, res);
    return;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/inspect-url") {
    await handleWebsiteInspection(req, res, url.searchParams.get("url") || "");
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Trip Budget Agent listening on http://${HOST}:${PORT}`);
});
