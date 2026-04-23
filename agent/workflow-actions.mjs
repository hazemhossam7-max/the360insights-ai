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
        defaultColor: "gray",
        defaultIcon: "folder",
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

function buildCollectionColorSelectors(color) {
  const label = cleanText(color);
  if (!label) {
    return [];
  }

  const lower = label.toLowerCase();
  return unique([
    `[aria-label*="${label}" i]`,
    `[title*="${label}" i]`,
    `[data-color="${lower}"]`,
    `[data-value="${lower}"]`,
    `button[value="${lower}"]`,
    `[role="radio"][aria-label*="${label}" i]`,
    `text="${label}"`,
  ]);
}

function buildCollectionIconSelectors(icon) {
  const label = cleanText(icon);
  if (!label) {
    return [];
  }

  const lower = label.toLowerCase();
  return unique([
    `[aria-label*="${label}" i]`,
    `[title*="${label}" i]`,
    `[data-icon="${lower}"]`,
    `[data-value="${lower}"]`,
    `button[value="${lower}"]`,
    `text="${label}"`,
  ]);
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
    color: cleanText(spec?.color || spec?.input?.color || config?.defaultColor || ""),
    icon: cleanText(spec?.icon || spec?.input?.icon || config?.defaultIcon || ""),
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
      ...buildFieldSelectors(["description", "notes", "summary", "Add a description"], "description"),
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

  if (config?.entityType === "collection") {
    await clickFirstVisible(
      page,
      unique([
        ...(spec?.locators?.colorOption ? [spec.locators.colorOption] : []),
        ...buildCollectionColorSelectors(entity.color),
      ])
    ).catch(() => false);

    await clickFirstVisible(
      page,
      unique([
        ...(spec?.locators?.iconOption ? [spec.locators.iconOption] : []),
        ...buildCollectionIconSelectors(entity.icon),
      ])
    ).catch(() => false);
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

// ---------------------------------------------------------------------------
// verify_module_content
// Navigate to a module and verify it shows substantive real content.
// Throws with a descriptive product-bug message if content is missing.
// ---------------------------------------------------------------------------
async function executeVerifyModuleContent(page, websiteBrief, spec, runtime) {
  const moduleLabel = cleanText(spec?.module || "module");
  const moduleAliases = unique([moduleLabel, ...(Array.isArray(spec?.moduleAliases) ? spec.moduleAliases : [])]);
  const minBodyChars = Math.max(20, Number(spec?.minBodyChars || 100) || 100);

  const config = {
    entityLabel: moduleLabel,
    moduleNames: moduleAliases,
  };

  const navigation = await openModule(page, websiteBrief, spec, config);

  const body = await readBodyText(page);

  if (body.length < minBodyChars) {
    throw new Error(
      `The ${moduleLabel} module loaded but shows insufficient content ` +
        `(${body.length} chars, expected at least ${minBodyChars}). ` +
        `The module may not be rendering its data correctly.`
    );
  }

  // Check for error states only when content is short (avoids false positives)
  if (body.length < 400) {
    const lowerBody = body.toLowerCase();
    const errorPatterns = [
      "404",
      "page not found",
      "not found",
      "something went wrong",
      "error occurred",
      "unexpected error",
      "access denied",
      "forbidden",
    ];
    for (const pat of errorPatterns) {
      if (lowerBody.includes(pat)) {
        throw new Error(
          `The ${moduleLabel} module shows an error or empty state: "${body.slice(0, 200)}"`
        );
      }
    }
  }

  const expectedTexts = unique([
    ...(Array.isArray(spec?.expect?.textVisible) ? spec.expect.textVisible : []),
    ...(spec?.expect?.textVisible && !Array.isArray(spec.expect.textVisible)
      ? [spec.expect.textVisible]
      : []),
  ]);

  if (expectedTexts.length) {
    await assertTextVisible(
      page,
      expectedTexts,
      `${moduleLabel} loaded but expected content was not found: ${expectedTexts.join(", ")}`
    );
  }

  runtime.createdEntities.push({
    type: "module_load",
    module: moduleLabel,
    url: cleanText(page.url()),
    bodyLength: body.length,
    createdAt: new Date().toISOString(),
  });

  return { module: moduleLabel, url: page.url(), bodyLength: body.length, navigation };
}

// ---------------------------------------------------------------------------
// search_in_directory
// Open the Directory/Athletes module, type a search query, and verify results.
// ---------------------------------------------------------------------------
async function executeSearchInDirectory(page, websiteBrief, spec, runtime) {
  const moduleLabel = cleanText(spec?.module || "Directory");
  const query = cleanText(spec?.query || spec?.searchQuery || "a");
  const moduleAliases = unique([
    moduleLabel,
    ...(Array.isArray(spec?.moduleAliases) ? spec.moduleAliases : []),
    "Directory",
    "Athletes",
    "Player Directory",
  ]);

  await openModule(page, websiteBrief, spec, {
    entityLabel: moduleLabel,
    moduleNames: moduleAliases,
  });

  const priorBody = await readBodyText(page);

  const searchInputSelectors = unique([
    ...(spec?.locators?.searchInput ? [spec.locators.searchInput] : []),
    'input[type="search"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="athlete" i]',
    'input[placeholder*="player" i]',
    'input[aria-label*="search" i]',
    'input[name*="search" i]',
    'input[id*="search" i]',
    '[role="searchbox"]',
  ]);

  const filled = await fillFirstVisible(page, searchInputSelectors, query);
  if (!filled) {
    throw new Error(
      `Could not find a search input in the ${moduleLabel} module. ` +
        `Search functionality appears to be missing or inaccessible.`
    );
  }

  await page.keyboard.press("Enter").catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});

  const postBody = await readBodyText(page);

  const hasResultIndicators =
    (await page
      .locator(
        '[class*="result"], [class*="card"], [class*="athlete"], [class*="player"], td, [class*="item"]'
      )
      .count()
      .catch(() => 0)) > 0;

  if (postBody.length < 50 && !hasResultIndicators) {
    throw new Error(
      `Search in ${moduleLabel} for "${query}" returned no visible results. ` +
        `The search functionality may be broken or no athletes are available.`
    );
  }

  return { module: moduleLabel, query, url: page.url() };
}

// ---------------------------------------------------------------------------
// open_first_athlete
// Open the Athletes/Athlete 360° module, click the first athlete card/row,
// and verify a detail view opens with substantive content.
// ---------------------------------------------------------------------------
async function executeOpenFirstAthlete(page, websiteBrief, spec, runtime) {
  const moduleLabel = cleanText(spec?.module || "Athlete 360°");
  const moduleAliases = unique([
    moduleLabel,
    ...(Array.isArray(spec?.moduleAliases) ? spec.moduleAliases : []),
    "Athlete 360",
    "Athletes",
    "Directory",
  ]);

  await openModule(page, websiteBrief, spec, {
    entityLabel: moduleLabel,
    moduleNames: moduleAliases,
  });

  const priorUrl = cleanText(page.url());

  const cardSelectors = unique([
    ...(spec?.locators?.athleteCard ? [spec.locators.athleteCard] : []),
    '[class*="athlete-card"]',
    '[class*="AthleteCard"]',
    '[class*="athlete"][class*="item"]',
    '[class*="player-card"]',
    '[class*="PlayerCard"]',
    '[data-testid*="athlete"]',
    "[class*=\"grid\"] [class*=\"card\"]:first-child",
    "table tbody tr:first-child a",
    "[class*=\"list\"] [class*=\"item\"]:first-child",
    "[class*=\"card\"]:first-child",
  ]);

  const clicked = await clickFirstVisible(page, cardSelectors);
  if (!clicked) {
    throw new Error(
      `No athlete cards or list items found in the ${moduleLabel} module. ` +
        `The module may not be loading athlete data, or the list is empty.`
    );
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  const newUrl = cleanText(page.url());
  const body = await readBodyText(page);

  if (newUrl === priorUrl && body.length < 100) {
    throw new Error(
      `Clicking an athlete item in ${moduleLabel} did not open a detail view. ` +
        `The URL did not change and page content is minimal (${body.length} chars).`
    );
  }

  return { module: moduleLabel, url: newUrl };
}

// ---------------------------------------------------------------------------
// run_rank_calculator
// Open the Rank-Up Calculator module, fill in numeric inputs, trigger the
// calculation, and verify the output changes.
// ---------------------------------------------------------------------------
async function executeRunRankCalculator(page, websiteBrief, spec, runtime) {
  const moduleLabel = cleanText(spec?.module || "Rank-Up Calculator");
  const moduleAliases = unique([
    moduleLabel,
    ...(Array.isArray(spec?.moduleAliases) ? spec.moduleAliases : []),
    "Rank Up Calculator",
    "RankUp",
    "Calculator",
    "Rank-Up",
  ]);

  await openModule(page, websiteBrief, spec, {
    entityLabel: moduleLabel,
    moduleNames: moduleAliases,
  });

  const priorBody = await readBodyText(page);

  const inputs = spec?.inputs && typeof spec.inputs === "object" ? spec.inputs : {};
  let filledAny = false;

  if (Object.keys(inputs).length) {
    for (const [fieldName, fieldValue] of Object.entries(inputs)) {
      const filled = await fillFirstVisible(
        page,
        buildFieldSelectors([fieldName]),
        String(fieldValue ?? "")
      ).catch(() => false);
      if (filled) filledAny = true;
    }
  }

  if (!filledAny) {
    // Generic fallback: try any visible numeric input
    const genericNumericSelectors = [
      'input[type="number"]',
      'input[inputmode="numeric"]',
      'input[class*="score" i]',
      'input[class*="rank" i]',
      'input[placeholder*="score" i]',
      'input[placeholder*="rank" i]',
      'input[placeholder*="value" i]',
      'input[placeholder*="enter" i]',
    ];
    const filled = await fillFirstVisible(page, genericNumericSelectors, "75").catch(() => false);
    if (filled) filledAny = true;
  }

  if (!filledAny) {
    throw new Error(
      `Could not find any calculator input fields in the ${moduleLabel} module. ` +
        `The calculator form may not be rendering or no numeric inputs are available.`
    );
  }

  // Trigger calculation
  const calculateSelectors = unique([
    ...(spec?.locators?.calculateButton ? [spec.locators.calculateButton] : []),
    'button:has-text("Calculate")',
    'button:has-text("Calculate Rank")',
    'button:has-text("Run")',
    'button:has-text("Compute")',
    'button:has-text("Submit")',
    'button[type="submit"]',
    '[role="button"]:has-text("Calculate")',
  ]);

  const triggered = await clickFirstVisible(page, calculateSelectors);
  if (!triggered) {
    await page.keyboard.press("Enter").catch(() => {});
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  const postBody = await readBodyText(page);

  if (postBody === priorBody && !triggered) {
    throw new Error(
      `The ${moduleLabel} calculator did not produce any output after filling inputs and triggering calculation. ` +
        `The calculation functionality may be broken or the submit button is missing.`
    );
  }

  return { module: moduleLabel, url: page.url() };
}

// ---------------------------------------------------------------------------
// trigger_module_action
// Open a module and click its primary action button (e.g. Analyze, Generate),
// then verify the page response changes or expected text appears.
// ---------------------------------------------------------------------------
async function executeTriggerModuleAction(page, websiteBrief, spec, runtime) {
  const moduleLabel = cleanText(spec?.module || "module");
  const actionLabel = cleanText(spec?.actionLabel || "Analyze");
  const moduleAliases = unique([
    moduleLabel,
    ...(Array.isArray(spec?.moduleAliases) ? spec.moduleAliases : []),
  ]);

  await openModule(page, websiteBrief, spec, {
    entityLabel: moduleLabel,
    moduleNames: moduleAliases,
  });

  const priorBody = await readBodyText(page);

  const actionSelectors = unique([
    ...(spec?.locators?.actionButton ? [spec.locators.actionButton] : []),
    ...buildTextSelectors(actionLabel, ["button", "link", "generic"]),
    'button:has-text("Generate")',
    'button:has-text("Analyze")',
    'button:has-text("Run Analysis")',
    'button:has-text("Start")',
    'button:has-text("Run")',
    '[role="button"]:has-text("Generate")',
    '[role="button"]:has-text("Analyze")',
  ]);

  const triggered = await clickFirstVisible(page, actionSelectors);
  if (!triggered) {
    throw new Error(
      `Could not find the "${actionLabel}" action button in the ${moduleLabel} module. ` +
        `The primary action may not be available or the module is not rendering correctly.`
    );
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  const postBody = await readBodyText(page);

  const expectedTexts = unique([
    ...(Array.isArray(spec?.expect?.textVisible) ? spec.expect.textVisible : []),
    ...(spec?.expect?.textVisible && !Array.isArray(spec.expect.textVisible)
      ? [spec.expect.textVisible]
      : []),
  ]);

  if (expectedTexts.length) {
    await assertTextVisible(
      page,
      expectedTexts,
      `${moduleLabel}: triggered "${actionLabel}" but expected response content not found: ${expectedTexts.join(", ")}`
    );
  } else if (postBody === priorBody) {
    throw new Error(
      `${moduleLabel}: triggered "${actionLabel}" but the page content did not change. ` +
        `The action may have failed silently or the response is not being rendered.`
    );
  }

  return { module: moduleLabel, action: actionLabel, url: page.url() };
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
    case "refresh_and_created_entity_visible": {
      const latest = latestCreatedEntity(runtime, spec.entityType || "");
      if (!latest?.name) {
        throw new Error("No created entity is available for refresh_and_created_entity_visible assertion.");
      }
      await page.reload({ waitUntil: "domcontentloaded" }).catch(async () => {
        if (latest?.url) {
          await page.goto(latest.url, { waitUntil: "domcontentloaded" });
        }
      });
      await page.waitForLoadState("networkidle").catch(() => {});
      await assertTextVisible(
        page,
        [latest.name],
        `The created ${latest.type} was not visible after refreshing the page.`
      );
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
    case "verify_module_content":
      return executeVerifyModuleContent(page, websiteBrief, spec, runtime);
    case "search_in_directory":
      return executeSearchInDirectory(page, websiteBrief, spec, runtime);
    case "open_first_athlete":
      return executeOpenFirstAthlete(page, websiteBrief, spec, runtime);
    case "run_rank_calculator":
      return executeRunRankCalculator(page, websiteBrief, spec, runtime);
    case "trigger_module_action":
      return executeTriggerModuleAction(page, websiteBrief, spec, runtime);
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
