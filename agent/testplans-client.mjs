function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildBasicAuthHeader(pat) {
  if (!pat) {
    return null;
  }
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

function workItemTypePath(type) {
  const normalized = String(type || "").trim();
  if (!normalized) {
    throw new Error("A work item type is required.");
  }
  return `$${encodeURIComponent(normalized)}`;
}

function buildTestCaseDescription(testCaseDraft) {
  const lines = [
    `Source criterion: ${testCaseDraft.sourceCriterion || testCaseDraft.expectedResult || ""}`,
    "",
    "Preconditions:",
    ...(testCaseDraft.preconditions || []).map((item) => `- ${item}`),
    "",
    "Steps:",
    ...(testCaseDraft.steps || []).map((item, index) => `${index + 1}. ${item}`),
    "",
    `Expected result: ${testCaseDraft.expectedResult || ""}`,
  ];

  return lines.join("\n").trim();
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

  async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
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

    if (!response.ok) {
      const message = data?.message || data?.error || response.statusText || "Request failed";
      throw new Error(`Azure DevOps request failed (${response.status}): ${message}`);
    }

    return data;
  }

  return {
    async createTestSuite({ planId, parentSuiteId, name }) {
      const numericParentSuiteId = Number(parentSuiteId);
      if (!Number.isFinite(numericParentSuiteId) || numericParentSuiteId <= 0) {
        throw new Error("A valid parent suite id is required.");
      }

      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/testplan/Plans/${encodeURIComponent(planId)}/suites`
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

    async createTestCaseWorkItem(testCaseDraft) {
      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${workItemTypePath("Test Case")}`
      );
      url.searchParams.set("api-version", "7.1");

      const patchDocument = [
        { op: "add", path: "/fields/System.Title", value: testCaseDraft.title },
        { op: "add", path: "/fields/System.Description", value: buildTestCaseDescription(testCaseDraft) },
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
