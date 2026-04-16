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

function normalizeFields(fields = {}) {
  const acceptanceCriteria =
    fields["Microsoft.VSTS.Common.AcceptanceCriteria"] ||
    fields["System.AcceptanceCriteria"] ||
    fields["System.Description"] ||
    "";

  const tags = String(fields["System.Tags"] || "")
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    title: String(fields["System.Title"] || "").trim(),
    description: String(fields["System.Description"] || "").trim(),
    acceptanceCriteria: String(acceptanceCriteria || "").trim(),
    type: String(fields["System.WorkItemType"] || "").trim(),
    tags,
    state: String(fields["System.State"] || "").trim(),
    areaPath: String(fields["System.AreaPath"] || "").trim(),
    iterationPath: String(fields["System.IterationPath"] || "").trim(),
    stepsHtml: String(fields["Microsoft.VSTS.TCM.Steps"] || "").trim(),
  };
}

export function createAzureDevOpsClient(config) {
  const orgUrl = trimTrailingSlash(config.orgUrl);
  const project = String(config.project || "").trim();
  const authHeader = buildAuthHeader(config.pat, config.accessToken);

  if (!orgUrl) {
    throw new Error("AZDO_ORG_URL is required.");
  }
  if (!project) {
    throw new Error("AZDO_PROJECT is required.");
  }

  async function fetchJson(url) {
    const headers = {
      Accept: "application/json",
    };

    if (authHeader) {
      headers.Authorization = authHeader;
    }

    const response = await fetch(url, { headers });
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
    async getWorkItem(workItemId) {
      if (!workItemId && workItemId !== 0) {
        throw new Error("A work item id is required.");
      }

      const url = new URL(
        `${orgUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/${encodeURIComponent(workItemId)}`
      );
      url.searchParams.set("api-version", "7.1");
      url.searchParams.set("$expand", "fields");

      const workItem = await fetchJson(url.toString());
      const fields = normalizeFields(workItem.fields);

      return {
        id: Number(workItem.id || workItemId),
        url: workItem.url || "",
        rev: workItem.rev || null,
        ...fields,
      };
    },
  };
}

export function resolveWorkItemId(payload) {
  const resource = payload?.resource || {};
  const directCandidates = [
    resource.id,
    resource.workItemId,
    resource.workitemId,
    resource.fields?.["System.Id"],
    payload?.resourceId,
  ];

  for (const candidate of directCandidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  const urlCandidates = [
    resource.url,
    resource._links?.html?.href,
    payload?.resource?.revision?.url,
    payload?.message?.text,
    payload?.message?.html,
    payload?.detailedMessage?.text,
    payload?.detailedMessage?.html,
    payload?.message?.markdown,
    payload?.detailedMessage?.markdown,
  ].filter(Boolean);

  for (const value of urlCandidates) {
    const match = String(value).match(/(?:[?&](?:id|workItemId)=|\/workitems?\/)(\d+)/i);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}
