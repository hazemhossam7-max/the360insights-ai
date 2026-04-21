function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => cleanText(value))
        .filter(Boolean)
    )
  );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAction(action) {
  if (!action) {
    return null;
  }

  if (typeof action === "string") {
    return { type: cleanText(action) };
  }

  return {
    ...action,
    type: cleanText(action.type),
  };
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeAction).filter((item) => item?.type);
  }
  if (!value) {
    return [];
  }
  const normalized = normalizeAction(value);
  return normalized?.type ? [normalized] : [];
}

function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function interpolateTemplate(value, runtime) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }

  const latest = runtime?.createdEntities?.[runtime.createdEntities.length - 1] || null;

  return raw.replace(/\$\{([^}]+)\}/g, (_, token) => {
    const key = cleanText(token).toLowerCase();
    if (key === "timestamp") {
      return runtime.timestamp;
    }
    if (key === "random") {
      return runtime.random;
    }
    if (key === "latest.name") {
      return latest?.name || "";
    }
    if (key === "latest.type") {
      return latest?.type || "";
    }
    return "";
  });
}

function buildEntityName(spec, runtime, entityLabel) {
  const requested = interpolateTemplate(spec?.name || spec?.input?.name || spec?.fields?.name || "", runtime);
  if (requested) {
    return requested;
  }

  return `${entityLabel} ${runtime.timestamp}-${runtime.random}`;
}

function buildEntityDescription(spec, runtime) {
  const raw =
    spec?.description ||
    spec?.input?.description ||
    spec?.fields?.description ||
    "Automation-created test data";
  return interpolateTemplate(raw, runtime);
}

function buildPathCandidates(websiteBrief, moduleNames = []) {
  const allPages = Array.isArray(websiteBrief?.pages) ? websiteBrief.pages : [];
  const names = moduleNames.map((value) => cleanText(value).toLowerCase()).filter(Boolean);
  const matches = allPages
    .filter((page) => {
      const title = cleanText(page?.title || "").toLowerCase();
      const url = cleanText(page?.url || "").toLowerCase();
      return names.some((name) => title.includes(name) || url.includes(name.replace(/\s+/g, "-")) || url.includes(name.replace(/\s+/g, "")));
    })
    .map((page) => cleanText(page?.url || ""));

  return unique(matches);
}

function entityConfig(actionType) {
  switch (cleanText(actionType).toLowerCase()) {
    case "create_collection":
    case "delete_collection":
      return {
        entityType: "collection",
        entityLabel: "Codex Collection",
        moduleNames: ["Collections", "Collection"],
        createLabels: ["Create Collection", "New Collection", "Add Collection", "Create", "New", "Add"],
        submitLabels: ["Create Collection", "Save Collection", "Create", "Save", "Submit"],
        deleteLabels: ["Delete Collection", "Delete", "Remove", "Archive"],
      };
    case "create_training_plan":
    case "delete_training_plan":
      return {
        entityType: "training_plan",
        entityLabel: "Codex Training Plan",
        moduleNames: ["Training Planner", "Training Plan", "Training"],
        createLabels: ["Create Training Plan", "New Training Plan", "Add Training Plan", "Create Plan", "Create", "New", "Add"],
        submitLabels: ["Create Training Plan", "Save Training Plan", "Create Plan", "Save Plan", "Create", "Save", "Submit"],
        deleteLabels: ["Delete Training Plan", "Delete Plan", "Delete", "Remove"],
      };
    case "create_nutrition_plan":
    case "delete_nutrition_plan":
      return {
        entityType: "nutrition_plan",
        entityLabel: "Codex Nutrition Plan",
        moduleNames: ["Nutrition Plan", "Nutrition", "Meal Plan", "Nutrition Planner"],
        createLabels: ["Create Nutrition Plan", "New Nutrition Plan", "Add Nutrition Plan", "Create Plan", "Create", "New", "Add"],
        submitLabels: ["Create Nutrition Plan", "Save Nutrition Plan", "Create Plan", "Save Plan", "Create", "Save", "Submit"],
        deleteLabels: ["Delete Nutrition Plan", "Delete Plan", "Delete", "Remove"],
      };
    default:
      return null;
  }
}

function buildTextSelectors(label, elementKinds = ["button", "link", "generic"]) {
  const cleanLabel = cleanText(label);
  if (!cleanLabel) {
    return [];
  }

  const selectors = [];
  if (elementKinds.includes("button")) {
    selectors.push(`button:has-text("${cleanLabel}")`);
    selectors.push(`[role="button"]:has-text("${cleanLabel}")`);
  }
  if (elementKinds.includes("link")) {
    selectors.push(`a:has-text("${cleanLabel}")`);
  }
  if (elementKinds.includes("generic")) {
    selectors.push(`text="${cleanLabel}"`);
  }
  return selectors;
}

function buildFieldSelectors(names, kind = "input") {
  const selectors = [];
  for (const name of names) {
    const label = cleanText(name);
    if (!label) {
      continue;
    }

    const lower = label.toLowerCase();
    selectors.push(`input[name="${lower}"]`);
    selectors.push(`textarea[name="${lower}"]`);
    selectors.push(`input[placeholder*="${label}" i]`);
    selectors.push(`textarea[placeholder*="${label}" i]`);
    selectors.push(`input[aria-label*="${label}" i]`);
    selectors.push(`textarea[aria-label*="${label}" i]`);
    selectors.push(`input[id*="${lower}" i]`);
    selectors.push(`textarea[id*="${lower}" i]`);
    if (kind === "title") {
      selectors.push(`input[name*="title" i]`);
      selectors.push(`input[placeholder*="title" i]`);
    }
    if (kind === "description") {
      selectors.push(`textarea`);
      selectors.push(`textarea[name*="description" i]`);
      selectors.push(`textarea[placeholder*="description" i]`);
      selectors.push(`input[name*="description" i]`);
    }
  }

  return unique(selectors);
}

async function locatorCount(locator) {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function isVisibleLocator(locator) {
  try {
    if ((await locatorCount(locator)) === 0) {
      return false;
    }
    if (typeof locator.isVisible === "function") {
      return await locator.isVisible();
    }
    return true;
  } catch {
    return false;
  }
}

async function findFirstVisibleLocator(page, selectors) {
  for (const selector of unique(selectors)) {
    if (!selector) {
      continue;
    }
    const locator = page.locator(selector).first();
    if (await isVisibleLocator(locator)) {
      return { selector, locator };
    }
  }
  return null;
}

async function clickFirstVisible(page, selectors) {
  const found = await findFirstVisibleLocator(page, selectors);
  if (!found) {
    return false;
  }
  await found.locator.click();
  return true;
}

async function fillFirstVisible(page, selectors, value) {
  const found = await findFirstVisibleLocator(page, selectors);
  if (!found) {
    return false;
  }
  await found.locator.fill(String(value ?? ""));
  return true;
}

async function readBodyText(page) {
  try {
    return cleanText(await page.locator("body").innerText());
  } catch {
    return "";
  }
}

function matchesExpectedText(text, expectedValues) {
  const haystack = cleanText(text).toLowerCase();
  return expectedValues.some((value) => haystack.includes(cleanText(value).toLowerCase()));
}

async function openModule(page, websiteBrief, spec, config) {
  const overrideRoute = cleanText(spec?.route || "");
  const pathCandidates = unique([
    overrideRoute,
    ...buildPathCandidates(websiteBrief, [spec?.module, ...(config?.moduleNames || [])]),
  ]);

  if (pathCandidates.length) {
    for (const route of pathCandidates) {
      try {
        const targetUrl = new URL(route, websiteBrief.url).toString();
        const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle").catch(() => {});
        if (!response || response.status() < 500) {
          return {
            method: "goto",
            route,
            url: targetUrl,
          };
        }
      } catch {
        // fall back to UI navigation
      }
    }
  }

  const moduleNames = unique([spec?.module, ...(config?.moduleNames || [])]);
  const selectors = moduleNames.flatMap((label) => buildTextSelectors(label, ["button", "link", "generic"]));
  const clicked = await clickFirstVisible(page, selectors);
  if (!clicked) {
    throw new Error(`Could not open the ${config?.entityLabel || "target"} module.`);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  return {
    method: "click",
    route: "",
    url: page.url(),
  };
}

function buildRuntimeEntity(config, spec, runtime) {
  const name = buildEntityName(spec, runtime, config.entityLabel);
  const description = buildEntityDescription(spec, runtime);
  return {
    type: config.entityType,
    module: cleanText(spec?.module || config.moduleNames?.[0] || ""),
    name,
    description,
    createdAt: new Date().toISOString(),
  };
}

async function assertTextVisible(page, expectedValues, message) {
  const body = await readBodyText(page);
  if (!matchesExpectedText(body, expectedValues)) {
    throw new Error(message);
  }
}

async function executeCreateEntity(page, websiteBrief, spec, runtime, config) {
  const entity = buildRuntimeEntity(config, spec, runtime);
  await openModule(page, websiteBrief, spec, config);

  const createSelectors = unique([
    ...(spec?.locators?.createButton ? [spec.locators.createButton] : []),
    ...config.createLabels.flatMap((label) => buildTextSelectors(label, ["button", "generic", "link"])),
  ]);
  const createTriggered = await clickFirstVisible(page, createSelectors);
  if (!createTriggered && !spec?.skipCreateTrigger) {
    throw new Error(`Could not find a create action for ${config.entityLabel}.`);
  }

  if (createTriggered) {
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  const nameFilled = await fillFirstVisible(
    page,
    unique([
      ...(spec?.locators?.nameInput ? [spec.locators.nameInput] : []),
      ...buildFieldSelectors(["name", "title", `${config.entityType} name`], "title"),
    ]),
    entity.name
  );

  const descriptionValue = entity.description;
  await fillFirstVisible(
    page,
    unique([
      ...(spec?.locators?.descriptionInput ? [spec.locators.descriptionInput] : []),
      ...buildFieldSelectors(["description", "notes", "summary"], "description"),
    ]),
    descriptionValue
  );

  if (!nameFilled && !spec?.allowMissingNameField) {
    throw new Error(`Could not find a name/title field for ${config.entityLabel}.`);
  }

  if (spec?.fields && typeof spec.fields === "object") {
    for (const [fieldName, fieldValue] of Object.entries(spec.fields)) {
      if (["name", "title", "description"].includes(cleanText(fieldName).toLowerCase())) {
        continue;
      }
      await fillFirstVisible(
        page,
        buildFieldSelectors([fieldName]),
        interpolateTemplate(fieldValue, runtime)
      ).catch(() => {});
    }
  }

  const submitSelectors = unique([
    ...(spec?.locators?.submitButton ? [spec.locators.submitButton] : []),
    ...config.submitLabels.flatMap((label) => buildTextSelectors(label, ["button", "generic"])),
  ]);

  const submitted = await clickFirstVisible(page, submitSelectors);
  if (!submitted) {
    throw new Error(`Could not find a submit/save action for ${config.entityLabel}.`);
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  const expectedTexts = unique([
    entity.name,
    ...(Array.isArray(spec?.expect?.textVisible) ? spec.expect.textVisible : []),
    ...(spec?.expect?.textVisible && !Array.isArray(spec.expect.textVisible) ? [spec.expect.textVisible] : []),
  ]);

  if (expectedTexts.length && spec?.expect?.createdNameVisible !== false) {
    await assertTextVisible(
      page,
      expectedTexts,
      `${config.entityLabel} appears to have been submitted, but the created data was not visible afterward.`
    );
  }

  runtime.createdEntities.push({
    ...entity,
    url: cleanText(page.url()),
  });

  return entity;
}

function latestCreatedEntity(runtime, entityType) {
  return [...(runtime?.createdEntities || [])]
    .reverse()
    .find((item) => cleanText(item.type).toLowerCase() === cleanText(entityType).toLowerCase());
}

async function executeDeleteEntity(page, websiteBrief, spec, runtime, config) {
  const target = latestCreatedEntity(runtime, config.entityType);
  const expectedName = cleanText(spec?.name || target?.name || "");
  const deleteSelectors = unique([
    ...(spec?.locators?.deleteButton ? [spec.locators.deleteButton] : []),
    ...config.deleteLabels.flatMap((label) => buildTextSelectors(label, ["button", "generic"])),
  ]);

  const currentBody = await readBodyText(page);
  const deleteVisibleOnCurrentPage = Boolean(await findFirstVisibleLocator(page, deleteSelectors));
  const alreadyOnTargetPage = expectedName ? matchesExpectedText(currentBody, [expectedName]) : true;

  if (!(deleteVisibleOnCurrentPage && alreadyOnTargetPage)) {
    await openModule(page, websiteBrief, spec, config);
  }

  if (expectedName) {
    await clickFirstVisible(
      page,
      unique([
        ...(spec?.locators?.entityLink ? [spec.locators.entityLink] : []),
        ...buildTextSelectors(expectedName, ["button", "link", "generic"]),
      ])
    ).catch(() => false);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  const deleted = await clickFirstVisible(
    page,
    deleteSelectors
  );

  if (!deleted) {
    throw new Error(`Could not find a delete action for ${config.entityLabel}.`);
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  await clickFirstVisible(
    page,
    unique([
      ...(spec?.locators?.confirmDeleteButton ? [spec.locators.confirmDeleteButton] : []),
      ...["Confirm", "Yes", "Delete", "Remove"].flatMap((label) => buildTextSelectors(label, ["button", "generic"])),
    ])
  ).catch(() => false);

  await page.waitForLoadState("networkidle").catch(() => {});
  runtime.deletedEntities.push({
    type: config.entityType,
    name: expectedName,
    deletedAt: new Date().toISOString(),
    url: cleanText(page.url()),
  });

  return {
    type: config.entityType,
    name: expectedName,
  };
}

async function runAssertion(page, assertion, runtime) {
  const spec = normalizeAction(assertion);
  if (!spec) {
    return;
  }

  switch (cleanText(spec.type).toLowerCase()) {
    case "text_visible": {
      const expected = unique([
        spec.text,
        ...(Array.isArray(spec.values) ? spec.values : []),
      ]);
      if (!expected.length) {
        throw new Error("text_visible assertion requires expected text.");
      }
      await assertTextVisible(page, expected, `Expected text was not visible: ${expected.join(", ")}`);
      return;
    }
    case "created_entity_visible": {
      const latest = latestCreatedEntity(runtime, spec.entityType || "");
      if (!latest?.name) {
        throw new Error("No created entity is available for created_entity_visible assertion.");
      }
      await assertTextVisible(page, [latest.name], `The created ${latest.type} was not visible after execution.`);
      return;
    }
    case "url_includes": {
      const expected = cleanText(spec.value || spec.text || "");
      if (!expected) {
        throw new Error("url_includes assertion requires a value.");
      }
      if (!cleanText(page.url()).toLowerCase().includes(expected.toLowerCase())) {
        throw new Error(`The current URL did not include "${expected}".`);
      }
      return;
    }
    default:
      throw new Error(`Unsupported workflow assertion type "${spec.type}".`);
  }
}

async function executeWorkflowAction(page, websiteBrief, action, runtime) {
  const spec = normalizeAction(action);
  if (!spec?.type) {
    throw new Error("Workflow action type is required.");
  }

  const config = entityConfig(spec.type);

  switch (cleanText(spec.type).toLowerCase()) {
    case "create_collection":
    case "create_training_plan":
    case "create_nutrition_plan":
      return executeCreateEntity(page, websiteBrief, spec, runtime, config);
    case "delete_collection":
    case "delete_training_plan":
    case "delete_nutrition_plan":
      return executeDeleteEntity(page, websiteBrief, spec, runtime, config);
    case "navigate_module":
      return openModule(page, websiteBrief, spec, {
        entityLabel: "workflow target",
        moduleNames: [spec.module],
      });
    default:
      throw new Error(`Unsupported workflow action type "${spec.type}".`);
  }
}

export function hasWorkflowDefinition(testCase) {
  return Boolean(
    toArray(testCase?.setupActions).length ||
      normalizeAction(testCase?.action)?.type ||
      normalizeAction(testCase?.testAction)?.type ||
      toArray(testCase?.assertions).length ||
      toArray(testCase?.cleanupActions).length
  );
}

export function createWorkflowRuntime(testCase = {}) {
  return {
    testCaseId: cleanText(testCase?.id || ""),
    timestamp: formatTimestamp(),
    random: randomSuffix(),
    createdEntities: [],
    deletedEntities: [],
    cleanupErrors: [],
  };
}

export async function executeWorkflowTestCase(page, websiteBrief, testCase, runtime = createWorkflowRuntime(testCase)) {
  const setupActions = toArray(testCase?.setupActions);
  const assertions = toArray(testCase?.assertions);
  const cleanupActions = toArray(testCase?.cleanupActions);
  const mainAction = normalizeAction(testCase?.action || testCase?.testAction);

  let actionResult = null;
  try {
    for (const action of setupActions) {
      await executeWorkflowAction(page, websiteBrief, action, runtime);
    }

    if (mainAction?.type) {
      actionResult = await executeWorkflowAction(page, websiteBrief, mainAction, runtime);
    }

    for (const assertion of assertions) {
      await runAssertion(page, assertion, runtime);
    }

    return {
      actionResult,
      runtime,
    };
  } finally {
    for (const cleanupAction of cleanupActions) {
      try {
        await executeWorkflowAction(page, websiteBrief, cleanupAction, runtime);
      } catch (error) {
        runtime.cleanupErrors.push(cleanText(error?.message || error));
      }
    }
  }
}
