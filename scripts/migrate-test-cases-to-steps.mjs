import { createAzureDevOpsClient } from "../agent/azure-devops-client.mjs";
import { createTestPlansClient } from "../agent/testplans-client.mjs";
import { parseLegacyDescriptionToSteps } from "../agent/testcase-steps.mjs";

function readEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && Number.isInteger(parsed)) {
    return parsed;
  }
  return null;
}

async function listAllSuiteTestCases(client, planId, suiteId) {
  const cases = [];
  let continuationToken = "";

  do {
    const page = await client.getSuiteTestCases({
      planId,
      suiteId,
      isRecursive: true,
      continuationToken,
    });

    cases.push(...page.testCases);
    continuationToken = String(page.continuationToken || "").trim();
  } while (continuationToken);

  return cases;
}

async function main() {
  const orgUrl = readEnv("AZDO_ORG_URL");
  const project = readEnv("AZDO_PROJECT");
  const pat = readEnv("AZDO_PAT");
  const planId = parsePositiveInteger(readEnv("AZDO_TEST_PLAN_ID"));
  const explicitSuiteId = parsePositiveInteger(readEnv("AZDO_TEST_SUITE_ID"));
  const rewriteExisting = /^(true|1|yes|on)$/i.test(readEnv("REWRITE_EXISTING_TEST_CASES"));

  if (!planId) {
    throw new Error("AZDO_TEST_PLAN_ID is required.");
  }

  const config = { orgUrl, project, pat };
  const testPlansClient = createTestPlansClient(config);
  const azureClient = createAzureDevOpsClient(config);

  const plan = await testPlansClient.getTestPlan(planId);
  const rootSuiteId = parsePositiveInteger(plan?.rootSuite?.id);
  const suiteId = explicitSuiteId || rootSuiteId;

  if (!suiteId) {
    throw new Error("Could not determine a suite id to migrate.");
  }

  const suiteCases = await listAllSuiteTestCases(testPlansClient, planId, suiteId);
  const migrated = [];
  const skipped = [];
  const seenWorkItemIds = new Set();

  for (const suiteCase of suiteCases) {
    const workItemId = Number(suiteCase.workItemId || suiteCase.id);
    if (!Number.isFinite(workItemId) || workItemId <= 0) {
      skipped.push({ id: suiteCase.id, reason: "missing work item id" });
      continue;
    }

    if (seenWorkItemIds.has(workItemId)) {
      skipped.push({ id: workItemId, reason: "duplicate work item from recursive suite listing" });
      continue;
    }
    seenWorkItemIds.add(workItemId);

    const workItem = await azureClient.getWorkItem(workItemId);
    const description = String(workItem.description || "").trim();
    const stepsHtml = String(workItem.stepsHtml || "").trim();

    if (!description) {
      skipped.push({ id: workItem.id, reason: "description already empty" });
      continue;
    }

    if (stepsHtml && !rewriteExisting) {
      skipped.push({ id: workItem.id, reason: "steps already exist" });
      continue;
    }

    const parsed = parseLegacyDescriptionToSteps(description);
    if (!parsed.steps.length) {
      skipped.push({ id: workItem.id, reason: "no step content found" });
      continue;
    }

    await testPlansClient.updateTestCaseWorkItem(workItem.id, {
      title: workItem.title,
      steps: parsed.steps,
      expectedResult: parsed.expectedResult,
    });

    migrated.push({
      id: workItem.id,
      title: workItem.title,
      steps: parsed.steps.length,
    });
  }

  const summary = {
    planId,
    suiteId,
    total: suiteCases.length,
    migrated: migrated.length,
    skipped: skipped.length,
    migratedCases: migrated,
    skippedCases: skipped,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
