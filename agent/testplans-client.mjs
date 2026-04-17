import { buildTestCaseStepsXml } from "./testcase-steps.mjs";

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildAuthHeader(pat, accessToken) {
  if (pat) {
    return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
  }
  if (accessToken) {
    return `Bearer ${accessToken}`;
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(values, size = 100) {
  const items = Array.isArray(values) ? values : [];
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

function normalizeSuitePoint(item) {
  const pointId = Number(item?.id || item?.pointId);
  const testCase = item?.testCase || item?.testCaseReference || item?.workItem || {};
  const workItemId = Number(testCase?.id || item?.workItemId || item?.testCaseId);

  if (!Number.isFinite(pointId) || pointId <= 0 || !Number.isFinite(workItemId) || workItemId <= 0) {
    return null;
  }

  return {
    id: pointId,
    pointId,
    title: String(testCase?.name || testCase?.title || item?.testCaseTitle || item?.title || "").trim(),
    workItemId,
    configurationId: Number(item?.configuration?.id || item?.configurationId || 0) || null,
    suiteId: Number(item?.suite?.id || item?.suiteId || 0) || null,
    raw: item,
  };
}

export function createTestPlansClient(config) {
  const orgUrl = trimTrailingSlash(config.orgUrl);
  const project = String(config.project || "").trim();
  const authHeader = buildAuthHeader(config.pat, config.accessToken);

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

    async listTestPlans({ owner = "", continuationToken = "", includePlanDetails = true, filterActivePlans = false } = {}) {
      const url = new URL(`${orgUrl}/${encodeURIComponent(project)}/_apis/testplan/plans`);
      url.searchParams.set("api-version", "7.1");
      if (owner) {
        url.searchParams.set("owner", owner);
      }
      if (continuationToken) {
        url.searchParams.set("continuationToken", continuationToken);
      }
      if (includePlanDetails) {
        url.searchParams.set("includePlanDetails", "true");
      }
      if (filterActivePlans) {
        url.searchParams.set("filterActivePlans", "true");
      }

      const { data, response } = await requestJsonWithMeta(url.toString());
      const plans = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : [];

      return {
        plans,
        continuationToken:
          response?.headers?.get?.("x-ms-continuationtoken") ||
          data?.continuationToken ||
          null,
      };
    },

    async listTestSuitesForPlan({ planId, asTreeView = true, continuationToken = "" }) {
      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/testplan/Plans/${encodeURIComponent(planId)}/suites`
      );
      url.searchParams.set("api-version", "7.1");
      if (asTreeView) {
        url.searchParams.set("asTreeView", "true");
      }
      if (continuationToken) {
        url.searchParams.set("continuationToken", continuationToken);
      }

      const { data, response } = await requestJsonWithMeta(url.toString());
      const suites = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : [];

      return {
        suites,
        continuationToken:
          response?.headers?.get?.("x-ms-continuationtoken") ||
          data?.continuationToken ||
          null,
      };
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

    async getSuiteTestPoints({ planId, suiteId, continuationToken = "" }) {
      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/test/Plans/${encodeURIComponent(planId)}/Suites/${encodeURIComponent(suiteId)}/points`
      );
      url.searchParams.set("api-version", "7.1");
      if (continuationToken) {
        url.searchParams.set("continuationToken", String(continuationToken));
      }

      const { data, response } = await requestJsonWithMeta(url.toString());
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.value)
          ? data.value
          : Array.isArray(data?.points)
            ? data.points
            : [];

      return {
        testPoints: items.map(normalizeSuitePoint).filter(Boolean),
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
        return { added: [], ids: [], errors: [] };
      }

      const added = [];
      const errors = [];
      for (const chunk of chunkArray(ids, 100)) {
        const url = new URL(
          `${orgUrl}/${encodeURIComponent(project)}/_apis/test/Plans/${encodeURIComponent(planId)}/suites/${encodeURIComponent(suiteId)}/testcases/${chunk.join(",")}`
        );
        url.searchParams.set("api-version", "7.1");

        try {
          added.push(
            await requestJson(url.toString(), {
              method: "POST",
            })
          );
        } catch (error) {
          errors.push({
            ids: chunk,
            error: error.message,
          });
        }
      }

      return {
        added,
        ids,
        errors,
      };
    },

    async updateTestPoints({ planId, suiteId, pointUpdates }) {
      const updates = (pointUpdates || [])
        .map((item) => ({
          id: Number(item?.id || item?.pointId || 0),
          outcome: String(item?.outcome || "").trim().toLowerCase(),
        }))
        .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.outcome);

      if (!updates.length) {
        return { updated: [], ids: [], errors: [] };
      }

      const updated = [];
      const errors = [];
      for (const chunk of chunkArray(updates, 100)) {
        const url = new URL(
          `${orgUrl}/${encodeURIComponent(project)}/_apis/testplan/Plans/${encodeURIComponent(planId)}/Suites/${encodeURIComponent(suiteId)}/TestPoint`
        );
        url.searchParams.set("api-version", "7.1");

        try {
          updated.push(
            await requestJson(url.toString(), {
              method: "PATCH",
              body: JSON.stringify(
                chunk.map((item) => ({
                  id: item.id,
                  results: {
                    outcome: item.outcome,
                  },
                }))
              ),
            })
          );
        } catch (error) {
          errors.push({
            ids: chunk.map((item) => item.id),
            error: error.message,
          });
        }
      }

      return {
        updated,
        ids: updates.map((item) => item.id),
        errors,
      };
    },

    async createTestRun({ name, planId, pointIds, automated = true, state = "InProgress" }) {
      const ids = (pointIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);

      const url = new URL(`${orgUrl}/${encodeURIComponent(project)}/_apis/test/runs`);
      url.searchParams.set("api-version", "7.1");

      return requestJson(url.toString(), {
        method: "POST",
        body: JSON.stringify({
          name,
          automated,
          isAutomated: automated,
          state,
          plan: {
            id: Number(planId),
          },
          pointIds: ids,
        }),
      });
    },

    async addTestResults({ runId, results }) {
      const payload = Array.isArray(results) ? results.filter(Boolean) : [];
      if (!payload.length) {
        return [];
      }

      const url = new URL(`${orgUrl}/${encodeURIComponent(project)}/_apis/test/Runs/${encodeURIComponent(runId)}/results`);
      url.searchParams.set("api-version", "7.1");

      const responses = [];
      for (const chunk of chunkArray(payload, 100)) {
        responses.push(
          await requestJson(url.toString(), {
            method: "POST",
            body: JSON.stringify(chunk),
          })
        );
      }

      return responses;
    },

    async updateTestRun({ runId, state = "Completed", completedDate = new Date().toISOString(), comment = "" }) {
      const url = new URL(`${orgUrl}/${encodeURIComponent(project)}/_apis/test/runs/${encodeURIComponent(runId)}`);
      url.searchParams.set("api-version", "7.1");

      return requestJson(url.toString(), {
        method: "PATCH",
        body: JSON.stringify({
          state,
          completedDate,
          comment,
        }),
      });
    },
  };
}
