import { canUseOpenAIWorkflowAssistant, planWorkflowRecovery } from "./openai-workflow-assistant.mjs";

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

function createClassifiedError(message, classification = "automation_issue", details = {}) {
  const error = new Error(cleanText(message));
  error.classification = classification;
  Object.assign(error, details);
  return error;
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

function buildLocatorTarget(pageOrScope, selector) {
  if (!pageOrScope || !selector) {
    return null;
  }
  if (typeof pageOrScope.locator === "function") {
    return pageOrScope.locator(selector).first();
  }
  return null;
}

async function findFirstVisibleLocator(page, selectors, options = {}) {
  const scope = options?.scope && typeof options.scope.locator === "function" ? options.scope : null;
  for (const selector of unique(selectors)) {
    if (!selector) {
      continue;
    }
    const locator = buildLocatorTarget(scope || page, selector);
    if (await isVisibleLocator(locator)) {
      return { selector, locator };
    }
  }
  return null;
}

async function clickFirstVisible(page, selectors, options = {}) {
  const found = await findFirstVisibleLocator(page, selectors, options);
  if (!found) {
    return false;
  }
  await found.locator.click(options?.clickOptions || {});
  return true;
}

async function fillFirstVisible(page, selectors, value, options = {}) {
  const found = await findFirstVisibleLocator(page, selectors, options);
  if (!found) {
    return false;
  }
  await found.locator.fill(String(value ?? ""));
  return true;
}

async function findActiveDialogScope(page) {
  const selectors = [
    '[role="dialog"]',
    '[data-state="open"][role="dialog"]',
    '[data-state="open"] [role="dialog"]',
    '[data-state="open"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await isVisibleLocator(locator)) {
      return locator;
    }
  }

  return null;
}

async function readBodyText(page) {
  try {
    return cleanText(await page.locator("body").innerText());
  } catch {
    return "";
  }
}

async function tryEvaluate(page, expression, fallback = []) {
  try {
    if (typeof page.evaluate !== "function") {
      return fallback;
    }
    const result = await page.evaluate(expression);
    return Array.isArray(result) ? result.map((item) => cleanText(item)).filter(Boolean) : fallback;
  } catch {
    return fallback;
  }
}

async function captureWorkflowPageSnapshot(page) {
  const title = typeof page.title === "function" ? cleanText(await page.title().catch(() => "")) : "";
  const body = await readBodyText(page);
  const buttons = await tryEvaluate(
    page,
    () =>
      Array.from(document.querySelectorAll("button,[role='button'],a"))
        .map((item) => item.innerText || item.getAttribute("aria-label") || "")
        .slice(0, 20)
  );
  const inputs = await tryEvaluate(
    page,
    () =>
      Array.from(document.querySelectorAll("input, textarea, select, [role='combobox']"))
        .map((item) =>
          item.getAttribute("aria-label") ||
          item.getAttribute("placeholder") ||
          item.getAttribute("name") ||
          item.getAttribute("id") ||
          item.textContent ||
          ""
        )
        .slice(0, 20)
  );

  return {
    url: cleanText(typeof page.url === "function" ? page.url() : ""),
    title,
    bodySnippet: body.slice(0, 1200),
    buttons,
    inputs,
  };
}

async function applyWorkflowRecoveryActions(page, actions = []) {
  for (const action of Array.isArray(actions) ? actions : []) {
    const type = cleanText(action?.type).toLowerCase();
    if (!type) {
      continue;
    }

    if (type === "click_text") {
      await clickFirstVisible(page, buildTextSelectors(action?.text || "", ["button", "link", "generic"]), {
        clickOptions: { force: true },
      }).catch(() => false);
      continue;
    }

    if (type === "click_selector") {
      await clickFirstVisible(page, [action?.selector || ""], {
        clickOptions: { force: true },
      }).catch(() => false);
      continue;
    }

    if (type === "fill_selector") {
      await fillFirstVisible(page, [action?.selector || ""], action?.value || "").catch(() => false);
      continue;
    }

    if (type === "press_key" && typeof page.keyboard?.press === "function") {
      await page.keyboard.press(cleanText(action?.key || "Enter")).catch(() => {});
      continue;
    }

    if (type === "choose_first_option") {
      await chooseFirstAvailableOption(page).catch(() => false);
    }
  }

  await page.waitForLoadState("networkidle").catch(() => {});
}

async function attemptOpenAIWorkflowRecovery(page, goal, error) {
  if (!canUseOpenAIWorkflowAssistant()) {
    return null;
  }

  const pageSnapshot = await captureWorkflowPageSnapshot(page);
  const plan = await planWorkflowRecovery({
    goal,
    errorMessage: cleanText(error?.message || error),
    pageSnapshot,
  }).catch(() => null);

  if (!plan?.actions?.length) {
    return null;
  }

  await applyWorkflowRecoveryActions(page, plan.actions).catch(() => {});
  return plan;
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

async function chooseFirstAvailableOption(page, options = {}) {
  const optionSelectors = unique([
    ...(options?.optionSelectors || []),
    '[role="option"]:not([aria-disabled="true"])',
    '[data-radix-collection-item]:not([aria-disabled="true"])',
    '[cmdk-item]:not([data-disabled])',
    'li[role="option"]',
    '[data-slot="option"]',
  ]);

  return clickFirstVisible(page, optionSelectors, {
    clickOptions: { force: true },
  });
}

async function selectFirstAvailableChoice(page, triggerSelectors, options = {}) {
  const opened = await clickFirstVisible(page, triggerSelectors, {
    clickOptions: { force: true },
  });
  if (!opened) {
    return false;
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  const picked = await chooseFirstAvailableOption(page, options);
  if (picked) {
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  return picked;
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

// ---------------------------------------------------------------------------
// waitForDialogToClose
// Polls until no open [role="dialog"] is visible or the timeout elapses.
// Returns true if the dialog closed, false if it timed out.
// ---------------------------------------------------------------------------
async function waitForDialogToClose(page, timeoutMs = 10000) {
  const sleep = (ms) =>
    typeof page.waitForTimeout === "function"
      ? page.waitForTimeout(ms).catch(() => {})
      : new Promise((resolve) => setTimeout(resolve, ms));

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const dialog = await findActiveDialogScope(page).catch(() => null);
    if (!dialog) {
      return true;
    }
    await sleep(400);
  }
  return false;
}

// ---------------------------------------------------------------------------
// assertTextVisibleWithRetry
// Polls body text at fixed intervals; returns true as soon as any of
// expectedValues is found, false if all retries are exhausted.
// ---------------------------------------------------------------------------
async function assertTextVisibleWithRetry(page, expectedValues, options = {}) {
  const sleep = (ms) =>
    typeof page.waitForTimeout === "function"
      ? page.waitForTimeout(ms).catch(() => {})
      : new Promise((resolve) => setTimeout(resolve, ms));

  const retries = Math.max(1, Number(options.retries || 4) || 4);
  const intervalMs = Math.max(200, Number(options.intervalMs || 1000) || 1000);
  for (let attempt = 0; attempt < retries; attempt++) {
    const body = await readBodyText(page);
    if (matchesExpectedText(body, expectedValues)) {
      return true;
    }
    if (attempt < retries - 1) {
      await sleep(intervalMs);
    }
  }
  return false;
}

async function primeTrainingPlannerContext(page, spec) {
  const body = (await readBodyText(page)).toLowerCase();

  // Not on the athlete-selection landing — already past it.
  if (
    !body.includes("available athletes") &&
    !body.includes("quick access") &&
    !body.includes("select athlete")
  ) {
    return;
  }

  // Strategy 1 — click a named athlete directly in the QUICK ACCESS list.
  // These are real clickable items rendered in the content area (not nav).
  const knownAthletes = [
    "Seif Eissa",
    "Moataz Bellah Asem",
    "Moataz Bellah",
    "Jana Khattab",
    "Aya Shehata",
    "Abdullah Essam Mohiuddin",
    "Abdullah Essam",
    "Malak Samy Elhosseiny",
    "Malak Samy",
  ];
  const directTextSelectors = knownAthletes.flatMap((name) => [
    `text="${name}"`,
    `[role="button"]:has-text("${name}")`,
    `li:has-text("${name}")`,
    `button:has-text("${name}")`,
    `a:has-text("${name}")`,
    `span:has-text("${name}")`,
  ]);

  const athleteCardSelectors = unique([
    ...(spec?.locators?.athleteCard ? [spec.locators.athleteCard] : []),
    ...directTextSelectors,
    // Proven selectors from executeOpenFirstAthlete (TC-004 passed with these)
    '[class*="athlete-card"]',
    '[class*="AthleteCard"]',
    '[class*="athlete"][class*="item"]',
    '[class*="player-card"]',
    '[class*="PlayerCard"]',
    '[data-testid*="athlete"]',
    '[class*="grid"] [class*="card"]:first-child',
    '[class*="list"] [class*="item"]:first-child',
    '[class*="card"]:first-child',
    'table tbody tr:first-child a',
  ]);

  const clickedCard = await clickFirstVisible(page, athleteCardSelectors, {
    clickOptions: { force: true },
  }).catch(() => false);

  if (clickedCard) {
    await page.waitForLoadState("networkidle").catch(() => {});
    const newBody = (await readBodyText(page)).toLowerCase();
    // Training Planner is a React SPA — URL stays on /training-planner after
    // athlete selection. Success = selection screen text is gone from the body.
    const selectionScreenGone =
      !newBody.includes("select athlete for") &&
      !newBody.includes("choose an athlete") &&
      !newBody.includes("available athletes") &&
      !newBody.includes("quick access");
    if (selectionScreenGone) {
      return;
    }
  }

  // Strategy 2 — use the search box: click it, type a name, pick first result.
  const searchSelectors = unique([
    ...(spec?.locators?.athleteSelector ? [spec.locators.athleteSelector] : []),
    'input[placeholder*="search athletes" i]',
    'input[placeholder*="search athlete" i]',
    '[class*="search"] input',
    'input[type="search"]',
  ]);

  // The search box may appear as a button placeholder that opens an input;
  // try both direct fill and click-then-type.
  const searchFilled = await fillFirstVisible(page, searchSelectors, "Seif").catch(() => false);
  if (!searchFilled) {
    // Try clicking the trigger button first, then fill
    await clickFirstVisible(
      page,
      ['button:has-text("Search athletes")', 'button[placeholder*="search" i]'],
      { clickOptions: { force: true } }
    ).catch(() => false);
    await fillFirstVisible(page, searchSelectors, "Seif").catch(() => false);
  }

  // Wait briefly for dropdown/results to render, then pick the first one.
  const sleepShort = (ms) =>
    typeof page.waitForTimeout === "function"
      ? page.waitForTimeout(ms).catch(() => {})
      : new Promise((resolve) => setTimeout(resolve, ms));
  await sleepShort(700);
  await chooseFirstAvailableOption(page).catch(() => false);
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function satisfyRankCalculatorPrerequisites(page, spec) {
  const athleteSelectors = unique([
    ...(spec?.locators?.athleteSelector ? [spec.locators.athleteSelector] : []),
    'button:has-text("Choose athlete")',
    'button:has-text("Select athlete")',
    '[role="combobox"]:has-text("Choose athlete")',
    '[role="combobox"]:has-text("Select athlete")',
    'select[name*="athlete" i]',
  ]);
  const rankingTypeSelectors = unique([
    ...(spec?.locators?.rankingTypeSelector ? [spec.locators.rankingTypeSelector] : []),
    'button:has-text("Select athlete first")',
    'button:has-text("Ranking Type")',
    '[role="combobox"]:has-text("Ranking Type")',
    'select[name*="ranking" i]',
  ]);
  const weightSelectors = unique([
    ...(spec?.locators?.weightSelector ? [spec.locators.weightSelector] : []),
    'button:has-text("Weight Category")',
    '[role="combobox"]:has-text("Weight Category")',
    'select[name*="weight" i]',
  ]);

  await selectFirstAvailableChoice(page, athleteSelectors).catch(() => false);
  await selectFirstAvailableChoice(page, rankingTypeSelectors).catch(() => false);
  await selectFirstAvailableChoice(page, weightSelectors).catch(() => false);

  await fillFirstVisible(
    page,
    unique([
      'input[name*="target" i]',
      'input[placeholder*="target rank" i]',
      'input[type="number"]',
      ...(spec?.locators?.targetRankInput ? [spec.locators.targetRankInput] : []),
    ]),
    spec?.targetRank || "75"
  ).catch(() => false);

  await fillFirstVisible(
    page,
    unique([
      'textarea[placeholder*="specific requirements" i]',
      'textarea[placeholder*="context" i]',
      'textarea',
      ...(spec?.locators?.notesInput ? [spec.locators.notesInput] : []),
    ]),
    cleanText(spec?.notes || "Automation rank-up validation")
  ).catch(() => false);
}

async function executeCreateEntity(page, websiteBrief, spec, runtime, config) {
  const entity = buildRuntimeEntity(config, spec, runtime);
  await openModule(page, websiteBrief, spec, config);

  if (config?.entityType === "training_plan") {
    await primeTrainingPlannerContext(page, spec).catch(() => {});
  }

  const createSelectors = unique([
    ...(spec?.locators?.createButton ? [spec.locators.createButton] : []),
    ...config.createLabels.flatMap((label) => buildTextSelectors(label, ["button", "generic", "link"])),
  ]);
  const createTriggered = await clickFirstVisible(page, createSelectors, {
    clickOptions: { force: true },
  });
  if (!createTriggered && !spec?.skipCreateTrigger) {
    const directNameFieldExists = Boolean(
      await findFirstVisibleLocator(
        page,
        unique([
          ...(spec?.locators?.nameInput ? [spec.locators.nameInput] : []),
          ...buildFieldSelectors(["name", "title", `${config.entityType} name`], "title"),
        ])
      )
    );

    if (!directNameFieldExists) {
      await attemptOpenAIWorkflowRecovery(
        page,
        `Find the create flow for ${config.entityLabel} and expose the form fields`,
        createClassifiedError(`Could not find a create action for ${config.entityLabel}.`)
      ).catch(() => null);
    }
  }

  let scope = createTriggered ? await findActiveDialogScope(page) : null;

  if (!createTriggered && !scope) {
    const directNameFieldExists = Boolean(
      await findFirstVisibleLocator(
        page,
        unique([
          ...(spec?.locators?.nameInput ? [spec.locators.nameInput] : []),
          ...buildFieldSelectors(["name", "title", `${config.entityType} name`], "title"),
        ])
      )
    );
    if (!directNameFieldExists && !spec?.skipCreateTrigger) {
      throw createClassifiedError(`Could not find a create action for ${config.entityLabel}.`);
    }
  }

  if (createTriggered) {
    await page.waitForLoadState("networkidle").catch(() => {});
    scope = await findActiveDialogScope(page);
  }

  const nameFilled = await fillFirstVisible(
    page,
    unique([
      ...(spec?.locators?.nameInput ? [spec.locators.nameInput] : []),
      ...buildFieldSelectors(["name", "title", `${config.entityType} name`], "title"),
    ]),
    entity.name,
    { scope }
  );

  const descriptionValue = entity.description;
  await fillFirstVisible(
    page,
    unique([
      ...(spec?.locators?.descriptionInput ? [spec.locators.descriptionInput] : []),
      ...buildFieldSelectors(["description", "notes", "summary", "Add a description"], "description"),
    ]),
    descriptionValue,
    { scope }
  );

  if (!nameFilled && !spec?.allowMissingNameField) {
    throw createClassifiedError(`Could not find a name/title field for ${config.entityLabel}.`);
  }

  if (spec?.fields && typeof spec.fields === "object") {
    for (const [fieldName, fieldValue] of Object.entries(spec.fields)) {
      if (["name", "title", "description"].includes(cleanText(fieldName).toLowerCase())) {
        continue;
      }
      await fillFirstVisible(
        page,
        buildFieldSelectors([fieldName]),
        interpolateTemplate(fieldValue, runtime),
        { scope }
      ).catch(() => {});
    }
  }

  if (config?.entityType === "collection") {
    await clickFirstVisible(
      page,
      unique([
        ...(spec?.locators?.colorOption ? [spec.locators.colorOption] : []),
        ...buildCollectionColorSelectors(entity.color),
      ]),
      { scope, clickOptions: { force: true } }
    ).catch(() => false);

    await clickFirstVisible(
      page,
      unique([
        ...(spec?.locators?.iconOption ? [spec.locators.iconOption] : []),
        ...buildCollectionIconSelectors(entity.icon),
      ]),
      { scope, clickOptions: { force: true } }
    ).catch(() => false);
  }

  const submitSelectors = unique([
    ...(spec?.locators?.submitButton ? [spec.locators.submitButton] : []),
    ...config.submitLabels.flatMap((label) => buildTextSelectors(label, ["button", "generic"])),
  ]);

  let submitted = await clickFirstVisible(page, submitSelectors, {
    scope,
    clickOptions: { force: true },
  });
  if (!submitted && !scope) {
    scope = await findActiveDialogScope(page);
    submitted = await clickFirstVisible(page, submitSelectors, {
      scope,
      clickOptions: { force: true },
    });
  }
  if (!submitted) {
    await attemptOpenAIWorkflowRecovery(
      page,
      `Submit the ${config.entityLabel} form from the active page state`,
      createClassifiedError(`Could not find a submit/save action for ${config.entityLabel}.`)
    ).catch(() => null);

    submitted = await clickFirstVisible(page, submitSelectors, {
      scope: await findActiveDialogScope(page),
      clickOptions: { force: true },
    });
  }
  if (!submitted) {
    throw createClassifiedError(`Could not find a submit/save action for ${config.entityLabel}.`);
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  // Wait for any modal/dialog that showed a spinner ("Creating…", "Saving…") to
  // actually close before asserting persistence.  We poll for up to ~12 seconds.
  await waitForDialogToClose(page, 12000).catch(() => {});

  // After the dialog closes the app may still be committing server-side;
  // give it one more networkidle settle.
  await page.waitForLoadState("networkidle").catch(() => {});

  const expectedTexts = unique([
    entity.name,
    ...(Array.isArray(spec?.expect?.textVisible) ? spec.expect.textVisible : []),
    ...(spec?.expect?.textVisible && !Array.isArray(spec.expect.textVisible) ? [spec.expect.textVisible] : []),
  ]);

  if (expectedTexts.length && spec?.expect?.createdNameVisible !== false) {
    // Retry visibility check with a short polling window in case the list
    // re-renders asynchronously after the modal closes.
    const visible = await assertTextVisibleWithRetry(
      page,
      expectedTexts,
      { retries: 6, intervalMs: 1500 }
    );
    if (!visible) {
      throw new Error(
        `${config.entityLabel} appears to have been submitted, but the created data was not visible afterward.`
      );
    }
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
  await satisfyRankCalculatorPrerequisites(page, spec).catch(() => {});

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
    throw createClassifiedError(
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
    'button:has-text("Analyze")',
    'button[type="submit"]',
  ]);

  const calculated = await clickFirstVisible(page, calculateSelectors, {
    clickOptions: { force: true },
  }).catch(() => false);

  if (!calculated) {
    throw createClassifiedError(
      `Could not trigger calculation in the ${moduleLabel} module. ` +
        `No Calculate/Submit button was found or clickable.`
    );
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  // Verify output changed (new body text appeared)
  const newBody = await readBodyText(page);
  if (newBody.length <= priorBody.length && newBody === priorBody) {
    throw new Error(
      `The ${moduleLabel} calculator was triggered but the page content did not change. ` +
        `Expected new output or results to appear after calculation.`
    );
  }

  return { module: moduleLabel, url: cleanText(page.url()) };
}

// ---------------------------------------------------------------------------
// executeDeleteEntity
// Generic delete flow: click delete button, confirm, record in runtime.
// ---------------------------------------------------------------------------
async function executeDeleteEntity(page, websiteBrief, spec, runtime, config) {
  // If the latest created entity has a URL, navigate directly to it so the
  // delete controls are visible. Otherwise stay on the current page (e.g. the
  // entity was just created and we're already on its detail page).
  const entity = latestCreatedEntity(runtime, config.entityType);
  if (entity?.url && cleanText(entity.url) !== cleanText(page.url())) {
    try {
      await page.goto(cleanText(entity.url), { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
    } catch {
      // fall through — try delete from current page
    }
  }

  const deleteSelectors = unique([
    ...(spec?.locators?.deleteButton ? [spec.locators.deleteButton] : []),
    ...config.deleteLabels.flatMap((label) => buildTextSelectors(label, ["button", "generic"])),
  ]);

  await clickFirstVisible(page, deleteSelectors, { clickOptions: { force: true } }).catch(() => false);
  await page.waitForLoadState("networkidle").catch(() => {});

  // Confirm if a confirmation dialog appears
  const confirmSelectors = unique([
    ...(spec?.locators?.confirmDeleteButton ? [spec.locators.confirmDeleteButton] : []),
    ...buildTextSelectors("Confirm", ["button"]),
    ...buildTextSelectors("Yes, Delete", ["button"]),
    ...buildTextSelectors("Yes", ["button"]),
  ]);
  await clickFirstVisible(page, confirmSelectors, { clickOptions: { force: true } }).catch(() => false);
  await page.waitForLoadState("networkidle").catch(() => {});

  if (entity) {
    runtime.deletedEntities.push({ ...entity });
  }

  return entity || {};
}

// ---------------------------------------------------------------------------
// trigger_module_action
// Navigate to a module and attempt to trigger a generic primary action
// (e.g. "Export Report", "Generate", "Analyze") to verify it is functional.
// ---------------------------------------------------------------------------
async function executeTriggerModuleAction(page, websiteBrief, spec, runtime) {
  const moduleLabel = cleanText(spec?.module || "module");
  const actionLabel = cleanText(spec?.actionLabel || "");

  await openModule(page, websiteBrief, spec, {
    entityLabel: moduleLabel,
    moduleNames: [moduleLabel],
  });

  if (!actionLabel) {
    // No specific action label — just verify the module loaded with content.
    const body = await readBodyText(page);
    if (body.length < 50) {
      throw new Error(
        `The ${moduleLabel} module loaded but shows no meaningful content (${body.length} chars).`
      );
    }
    return { module: moduleLabel, url: cleanText(page.url()) };
  }

  const actionSelectors = buildTextSelectors(actionLabel, ["button", "link", "generic"]);
  const triggered = await clickFirstVisible(page, actionSelectors, {
    clickOptions: { force: true },
  }).catch(() => false);

  if (!triggered) {
    throw createClassifiedError(
      `Could not find or click the "${actionLabel}" action in the ${moduleLabel} module.`
    );
  }

  await page.waitForLoadState("networkidle").catch(() => {});
  return { module: moduleLabel, action: actionLabel, url: cleanText(page.url()) };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

async function runAssertion(page, assertion, runtime) {
  const type = cleanText(assertion?.type || "").toLowerCase();

  if (type === "text_visible") {
    const expected = cleanText(assertion?.text || "");
    if (!expected) return;
    const body = await readBodyText(page);
    if (!matchesExpectedText(body, [expected])) {
      throw new Error(`Expected text "${expected}" to be visible on the page.`);
    }
    return;
  }

  if (type === "url_includes") {
    const expected = cleanText(assertion?.value || "");
    if (!expected) return;
    const url = cleanText(page.url());
    if (!url.includes(expected)) {
      throw new Error(`Expected URL to include "${expected}", but got "${url}".`);
    }
    return;
  }

  if (type === "created_entity_visible") {
    const entityType = cleanText(assertion?.entityType || "");
    const entity = entityType
      ? latestCreatedEntity(runtime, entityType)
      : runtime.createdEntities[runtime.createdEntities.length - 1];
    if (!entity?.name) return;
    const body = await readBodyText(page);
    if (!matchesExpectedText(body, [entity.name])) {
      throw new Error(`Created ${entityType || "entity"} "${entity.name}" was not visible on the page.`);
    }
    return;
  }

  if (type === "refresh_and_created_entity_visible") {
    await page.reload().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    const entityType = cleanText(assertion?.entityType || "");
    const entity = entityType
      ? latestCreatedEntity(runtime, entityType)
      : runtime.createdEntities[runtime.createdEntities.length - 1];
    if (!entity?.name) return;
    const body = await readBodyText(page);
    if (!matchesExpectedText(body, [entity.name])) {
      throw new Error(
        `Created ${entityType || "entity"} "${entity.name}" was not visible after page refresh.`
      );
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function createWorkflowRuntime(options = {}) {
  return {
    id: cleanText(options?.id || ""),
    timestamp: formatTimestamp(),
    random: randomSuffix(),
    createdEntities: [],
    deletedEntities: [],
    cleanupErrors: [],
  };
}

export function hasWorkflowDefinition(testCase) {
  if (!testCase || typeof testCase !== "object") return false;
  const actions = toArray(testCase.setupActions);
  if (actions.length) return true;
  if (testCase.action?.type) return true;
  return false;
}

export async function executeWorkflowTestCase(page, websiteBrief, spec, runtime) {
  if (!runtime) {
    runtime = createWorkflowRuntime({ id: spec?.id || "" });
  }

  // Run setup actions first
  for (const action of toArray(spec?.setupActions)) {
    await dispatchAction(page, websiteBrief, action, spec, runtime);
  }

  // Run the primary action
  let actionResult = null;
  if (spec?.action?.type) {
    actionResult = await dispatchAction(page, websiteBrief, spec.action, spec, runtime);
  }

  // Run assertions
  for (const assertion of Array.isArray(spec?.assertions) ? spec.assertions : []) {
    await runAssertion(page, assertion, runtime);
  }

  // Run cleanup actions (best-effort — errors don't fail the test)
  for (const action of toArray(spec?.cleanupActions)) {
    await dispatchAction(page, websiteBrief, action, spec, runtime).catch((error) => {
      runtime.cleanupErrors.push(cleanText(error?.message || String(error)));
    });
  }

  return { actionResult, runtime };
}

async function dispatchAction(page, websiteBrief, action, spec, runtime) {
  const type = cleanText(action?.type || "").toLowerCase();
  const mergedSpec = { ...spec, ...action };

  const config = entityConfig(type);
  if (config) {
    if (type.startsWith("delete_")) {
      return executeDeleteEntity(page, websiteBrief, mergedSpec, runtime, config);
    }
    return executeCreateEntity(page, websiteBrief, mergedSpec, runtime, config);
  }

  switch (type) {
    case "verify_module_content":
      return executeVerifyModuleContent(page, websiteBrief, mergedSpec, runtime);
    case "search_in_directory":
      return executeSearchInDirectory(page, websiteBrief, mergedSpec, runtime);
    case "open_first_athlete":
      return executeOpenFirstAthlete(page, websiteBrief, mergedSpec, runtime);
    case "run_rank_calculator":
      return executeRunRankCalculator(page, websiteBrief, mergedSpec, runtime);
    case "trigger_module_action":
      return executeTriggerModuleAction(page, websiteBrief, mergedSpec, runtime);
    default:
      throw createClassifiedError(
        `Unknown workflow action type: "${type}". This action is not implemented in the executor.`
      );
  }
}