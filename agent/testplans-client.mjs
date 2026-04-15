import { buildTestCaseStepsXml } from "./testcase-steps.mjs";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildBasicAuthHeader(pat) {
  if (!pat) {
    return null;
  }
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return [429, 500, 502, 503, 504].includes(Number(status));
}

function workItemTypePath(type) {
  const normalized = String(type || "").trim();
  if (!normalized) {
    throw new Error("A work item type is required.");
  }
  return `$${encodeURIComponent(normalized)}`;
}

function buildTestCaseSteps(testCaseDraft) {
  return buildTestCaseStepsXml(testCaseDraft?.steps || [], testCaseDraft?.expectedResult || "");
}

function normalizeSuiteTestCase(item) {
  const testCase = item?.testCase || item?.workItem || {};
  const id = Number(testCase?.id || item?.id || item?.testCaseId);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    title: String(testCase?.name || testCase?.title || item?.title || "").trim(),
    workItemId: Number(testCase?.workItemId || item?.workItemId || id),
    pointId: Number(item?.pointId || item?.id || id),
    configurationId: Number(item?.configurationId || 0) || null,
    suiteId: Number(item?.suiteId || 0) || null,
    raw: item,
  };
}

export function createTestPlansClient(config) {
  const orgUrl = trimTrailingSlash(config.orgUrl);
  const project = String(config.project || "").trim();
  const authHeader = buildBasicAuthHeader(config.pat);

  if (!orgUrl) {
    throw new Error("AZDO_ORG_URL is required.");
  }
  if (!project) {
    throw new Error("AZDO_PROJECT is required.");
  }

  async function requestJsonWithMeta(url, { method = "GET", headers = {}, body } = {}) {
    let attempt = 0;

    while (attempt < 3) {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...headers,
        },
        body,
      });

      const text = await response.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (response.ok) {
        return { data, response };
      }

      const message = data?.message || data?.error || response.statusText || "Request failed";
      if (isRetryableStatus(response.status) && attempt < 2) {
        attempt += 1;
        await delay(1000 * attempt);
        continue;
      }

      throw new Error(`Azure DevOps request failed (${response.status}): ${message}`);
    }

    throw new Error("Azure DevOps request failed after retries.");
  }

  async function requestJson(url, options = {}) {
    const { data } = await requestJsonWithMeta(url, options);
    return data;
  }

  return {
    async getTestPlan(planId) {
      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/testplan/plans/${encodeURIComponent(planId)}`
      );
      url.searchParams.set("api-version", "7.1");

      return requestJson(url.toString());
    },

    async getSuiteTestCases({ planId, suiteId, isRecursive = true, continuationToken = "" }) {
      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/test/Plans/${encodeURIComponent(planId)}/suites/${encodeURIComponent(suiteId)}/testcases`
      );
      url.searchParams.set("api-version", "7.1");
      if (isRecursive) {
        url.searchParams.set("isRecursive", "true");
      }
      if (continuationToken) {
        url.searchParams.set("continuationToken", String(continuationToken));
      }

      const { data, response } = await requestJsonWithMeta(url.toString());
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : Array.isArray(data?.testCases)
            ? data.testCases
            : [];

      return {
        testCases: items.map(normalizeSuiteTestCase).filter(Boolean),
        continuationToken:
          data?.continuationToken ??
          data?.continuationToken?.toString?.() ??
          response?.headers?.get?.("x-ms-continuationtoken") ??
          null,
      };
    },

    async createTestSuite({ planId, parentSuiteId, name }) {
      const numericParentSuiteId = Number(parentSuiteId);
      if (!Number.isFinite(numericParentSuiteId) || numericParentSuiteId <= 0) {
        throw new Error("A valid parent suite id is required.");
      }

      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/testplan/plans/${encodeURIComponent(planId)}/suites`
      );
      url.searchParams.set("api-version", "7.1");

      const created = await requestJson(url.toString(), {
        method: "POST",
        body: JSON.stringify({
          name,
          suiteType: "staticTestSuite",
          parentSuite: {
            id: numericParentSuiteId,
          },
        }),
      });

      return {
        id: Number(created.id),
        name: created.name || name,
        suiteType: created.suiteType || "staticTestSuite",
      };
    },

    async updateTestCaseWorkItem(testCaseId, testCaseDraft) {
      const id = Number(testCaseId);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error("A valid test case id is required.");
      }

      const url = new URL(`${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(id)}`);
      url.searchParams.set("api-version", "7.1");

      const patchDocument = [
        { op: "add", path: "/fields/System.Title", value: testCaseDraft.title },
        { op: "add", path: "/fields/System.Description", value: "" },
        { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: buildTestCaseSteps(testCaseDraft) },
      ];

      const updated = await requestJson(url.toString(), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json-patch+json",
        },
        body: JSON.stringify(patchDocument),
      });

      return {
        id: Number(updated.id),
        url: updated.url || "",
        rev: updated.rev || null,
        title: updated.fields?.["System.Title"] || testCaseDraft.title,
      };
    },

    async createTestCaseWorkItem(testCaseDraft) {
      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemTypePath("Test Case")}`
      );
      url.searchParams.set("api-version", "7.1");

      const patchDocument = [
        { op: "add", path: "/fields/System.Title", value: testCaseDraft.title },
        { op: "add", path: "/fields/System.Description", value: "" },
        { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: buildTestCaseSteps(testCaseDraft) },
        { op: "add", path: "/fields/System.Tags", value: "GeneratedBy=TripBudgetAgent" },
      ];

      const created = await requestJson(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json-patch+json",
        },
        body: JSON.stringify(patchDocument),
      });

      return {
        id: Number(created.id),
        url: created.url || "",
        rev: created.rev || null,
        title: created.fields?.["System.Title"] || testCaseDraft.title,
      };
    },

    async addTestCasesToSuite({ planId, suiteId, testCaseIds }) {
      const ids = (testCaseIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!ids.length) {
        return { added: [], ids: [] };
      }

      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/test/Plans/${encodeURIComponent(planId)}/suites/${encodeURIComponent(suiteId)}/testcases/${ids.join(",")}`
      );
      url.searchParams.set("api-version", "7.1");

      const added = await requestJson(url.toString(), {
        method: "POST",
      });

      return {
        added,
        ids,
      };
    },
  };
}
