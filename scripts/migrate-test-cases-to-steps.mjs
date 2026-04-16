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

function parseIdList(value) {
  return String(value || "")
    .split(",")
    .map((item) => parsePositiveInteger(item.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
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
  const explicitPlanIds = parseIdList(readEnv("AZDO_TEST_PLAN_ID"));
  const explicitSuiteId = parsePositiveInteger(readEnv("AZDO_TEST_SUITE_ID"));
  const rewriteExisting = /^(true|1|yes|on)$/i.test(readEnv("REWRITE_EXISTING_TEST_CASES"));

  const config = { orgUrl, project, pat };
  const testPlansClient = createTestPlansClient(config);
  const azureClient = createAzureDevOpsClient(config);

  const migrated = [];
  const skipped = [];
  const seenWorkItemIds = new Set();
  const plansToProcess = [];

  if (explicitPlanIds.length) {
    for (const planId of explicitPlanIds) {
      plansToProcess.push(await testPlansClient.getTestPlan(planId));
    }
  } else {
    let continuationToken = "";
    do {
      const page = await testPlansClient.listTestPlans({
        includePlanDetails: true,
        filterActivePlans: false,
        continuationToken,
      });
      plansToProcess.push(...page.plans);
      continuationToken = String(page.continuationToken || "").trim();
    } while (continuationToken);
  }

  for (const plan of plansToProcess) {
    const planId = parsePositiveInteger(plan?.id);
    const rootSuiteId = parsePositiveInteger(plan?.rootSuite?.id);
    const suiteId = explicitSuiteId || rootSuiteId;

    if (!planId) {
      skipped.push({ id: plan?.id || "unknown", reason: "missing plan id" });
      continue;
    }

    if (!suiteId) {
      skipped.push({ id: planId, reason: "could not determine a suite id to migrate" });
      continue;
    }

    const suiteCases = await listAllSuiteTestCases(testPlansClient, planId, suiteId);

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
        planId,
        id: workItem.id,
        title: workItem.title,
        steps: parsed.steps.length,
      });
    }
  }

  const summary = {
    planIds: plansToProcess.map((plan) => Number(plan?.id)).filter((value) => Number.isFinite(value) && value > 0),
    suiteId: explicitSuiteId || null,
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
