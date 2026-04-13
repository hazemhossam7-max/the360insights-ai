import http from "node:http";
import { createAzureDevOpsClient, resolveWorkItemId } from "./azure-devops-client.mjs";
import { generateTestCasesForStory } from "./ai-test-case-generator.mjs";
import { createTestPlansClient } from "./testplans-client.mjs";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

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

function getConfig() {
  return {
    orgUrl: readEnv("AZDO_ORG_URL", "azdo.org.url"),
    project: readEnv("AZDO_PROJECT", "azdo.project"),
    pat: readEnv("AZDO_PAT", "azdo.pat"),
    testPlanId: readEnv("AZDO_TEST_PLAN_ID", "azdo.test.plan.id"),
    testSuiteId: readEnv("AZDO_TEST_SUITE_ID", "azdo.test.suite.id"),
    openAiApiKey: readEnv("OPENAI_API_KEY", "openai.key"),
    openAiModel: readEnv("OPENAI_MODEL", "openai.model"),
    openAiBaseUrl: readEnv("OPENAI_BASE_URL", "openai.base.url"),
  };
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

  const added = await client.addTestCasesToSuite({
    planId,
    suiteId,
    testCaseIds: createdCases.map((item) => item.id),
  });

  return {
    skipped: false,
    planId,
    suiteId,
    createdCases,
    added,
  };
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
    client = createAzureDevOpsClient(getConfig());
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
    const workItem = await client.getWorkItem(workItemId);
    console.log(`[webhook] fetched work item: ${workItem.id} - ${workItem.title}`);
    const config = getConfig();
    const testCaseDrafts = await generateTestCasesForStory(workItem, {
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
      baseUrl: config.openAiBaseUrl,
    });
    console.log(
      `[webhook] generated ${testCaseDrafts.testCases.length} test case(s) using ${testCaseDrafts.generationSource}`
    );
    const uploadResult = await uploadGeneratedTests(getConfig(), testCaseDrafts);
    if (uploadResult?.skipped) {
      console.log(`[webhook] upload skipped: ${uploadResult.reason}`);
    } else {
      console.log(
        `[webhook] uploaded ${uploadResult.createdCases.length} test case(s) to plan ${uploadResult.planId}, suite ${uploadResult.suiteId}`
      );
    }

    sendJson(res, 200, {
      ok: true,
      message: "Webhook received and story processed.",
      workItem,
      testCaseDrafts,
      uploadResult,
    });
  } catch (error) {
    console.error(`[webhook] processing failed: ${error.stack || error.message}`);
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

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Trip Budget Agent listening on http://${HOST}:${PORT}`);
});
