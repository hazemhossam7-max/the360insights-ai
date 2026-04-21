function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(new Set((values || []).map((item) => cleanText(item)).filter(Boolean)));
}

function toId(index) {
  return `TC-${String(index + 1).padStart(3, "0")}`;
}

function buildCase({ title, category, module, route, steps, expectedResult, priority = "Medium", automationCandidate = true }) {
  return {
    title,
    category,
    module: cleanText(module || ""),
    route: cleanText(route || ""),
    preconditions: ["A valid authenticated session is available and the protected application shell has loaded."],
    steps,
    expectedResult,
    priority,
    automationCandidate,
    sourceCriterion: [category, module, route].filter(Boolean).join(" :: "),
  };
}

function buildWorkflowCase({
  title,
  category,
  module,
  route,
  steps,
  expectedResult,
  action,
  assertions = [],
  cleanupActions = [],
  priority = "High",
  automationCandidate = true,
}) {
  return {
    ...buildCase({
      title,
      category,
      module,
      route,
      steps,
      expectedResult,
      priority,
      automationCandidate,
    }),
    action,
    assertions,
    cleanupActions,
  };
}

function buildModuleCases(module, route, title) {
  const label = cleanText(module || title || route || "module");
  return [
    buildCase({
      title: `Auth smoke: ${label} is visible after login`,
      category: "Auth smoke tests",
      module: label,
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Wait for the authenticated shell to finish loading.",
        `Confirm the "${label}" module is visible in the protected navigation or landing page.`,
      ],
      expectedResult: `The authenticated application shell shows the "${label}" module after login.`,
    }),
    buildCase({
      title: `Navigation: open ${label}`,
      category: "Navigation tests",
      module: label,
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        `Open the "${label}" module from the authenticated navigation.`,
        "Wait for the module page to load.",
        "Confirm the page shows a title, heading, or content area related to the selected module.",
      ],
      expectedResult: `The "${label}" module opens successfully and shows module-specific content.`,
    }),
    buildCase({
      title: `Module availability: ${label} shell renders correctly`,
      category: "Module availability tests",
      module: label,
      route,
      steps: [
        "Log into the protected application.",
        `Open the "${label}" module.`,
        "Confirm the main content area is not blank.",
        "Verify at least one meaningful control, card, table, or heading is visible on the page.",
      ],
      expectedResult: `The "${label}" module renders meaningful authenticated content instead of an empty or broken shell.`,
    }),
  ];
}

function buildPageCases(page) {
  const label = cleanText(page?.title || page?.url || "page");
  const route = cleanText(page?.url || "");
  const cases = [];

  cases.push(
    buildCase({
      title: `UI validation: ${label} shows key headings`,
      category: "UI validation tests",
      module: label,
      route,
      steps: [
        "Log into the protected application.",
        `Open the page for "${label}".`,
        "Verify at least one heading or section title is visible.",
        "Confirm the heading text matches the page context.",
      ],
      expectedResult: `The "${label}" page shows understandable headings or section titles.`,
    })
  );

  if ((page?.forms || []).length) {
    cases.push(
      buildCase({
        title: `Core functional smoke: ${label} form surface is ready`,
        category: "Core functional smoke tests",
        module: label,
        route,
        steps: [
          "Log into the protected application.",
          `Open the "${label}" page.`,
          "Locate the primary form or input surface.",
          "Verify the inputs and a submit/save action are visible and enabled.",
        ],
        expectedResult: `The "${label}" page exposes a usable authenticated form surface.`,
      })
    );
  }

  if ((page?.buttons || []).length) {
    cases.push(
      buildCase({
        title: `Core functional smoke: ${label} primary action is visible`,
        category: "Core functional smoke tests",
        module: label,
        route,
        steps: [
          "Log into the protected application.",
          `Open the "${label}" page.`,
          "Identify the primary button or call-to-action.",
          "Confirm it is visible and appears actionable.",
        ],
        expectedResult: `The "${label}" page exposes a visible primary action for the authenticated user.`,
      })
    );
  }

  if (Number(page?.tables || 0) > 0) {
    cases.push(
      buildCase({
        title: `UI validation: ${label} table or grid is readable`,
        category: "UI validation tests",
        module: label,
        route,
        steps: [
          "Log into the protected application.",
          `Open the "${label}" page.`,
          "Locate the main table or data grid.",
          "Verify headers, rows, or placeholders are readable and aligned.",
        ],
        expectedResult: `The "${label}" table or grid is readable and structurally intact.`,
      })
    );
  }

  return cases;
}

function buildOptionalCases(pages) {
  return pages.slice(0, 6).map((page) =>
    buildCase({
      title: `Optional deep smoke: refresh preserves ${cleanText(page?.title || page?.url || "page")} shell`,
      category: "Optional deeper feature tests",
      module: cleanText(page?.title || ""),
      route: cleanText(page?.url || ""),
      priority: "Low",
      steps: [
        "Log into the protected application.",
        `Open the "${cleanText(page?.title || page?.url || "page")}" page.`,
        "Refresh the browser page.",
        "Confirm the page returns to an authenticated state without falling back to the login screen.",
      ],
      expectedResult: `Refreshing "${cleanText(page?.title || page?.url || "the page")}" keeps the user inside the authenticated application shell.`,
    })
  );
}

function hasModule(modules, label) {
  const target = cleanText(label).toLowerCase();
  return unique(modules).some((item) => cleanText(item).toLowerCase() === target);
}

function buildCollectionWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: create collection and verify it persists after refresh",
      category: "Workflow data creation tests",
      module: "Collections",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Collections module.",
        "Create a new collection with unique automation-generated data.",
        "Confirm the collection appears after save.",
        "Refresh the page and confirm the same collection is still visible.",
      ],
      expectedResult:
        "A real collection can be created successfully, remains visible after save, and still exists after refresh.",
      action: {
        type: "create_collection",
        module: "Collections",
        route,
        color: "blue",
        icon: "folder",
        locators: {
          createButton: 'button:has-text("Create Collection")',
          nameInput: 'input[placeholder*="Collection name" i]',
          descriptionInput: 'textarea[placeholder*="Add a description" i]',
          colorOption: '[data-color="blue"]',
          iconOption: '[data-icon="folder"]',
          submitButton: 'button:has-text("Create Collection")',
        },
      },
      assertions: [
        { type: "created_entity_visible", entityType: "collection" },
        { type: "refresh_and_created_entity_visible", entityType: "collection" },
      ],
    }),
  ];
}

export function generateGroundedWebsiteTestCases(websiteBrief, options = {}) {
  const maxCases = Math.max(1, Math.min(50, Number(options.maxCases || 30) || 30));
  const modules = unique(websiteBrief?.sidebarModules || websiteBrief?.featureCandidates?.map((item) => item?.feature));
  const pages = Array.isArray(websiteBrief?.pages) ? websiteBrief.pages : [];
  const routeByModule = new Map(
    pages
      .filter((page) => cleanText(page?.title))
      .map((page) => [cleanText(page.title).toLowerCase(), cleanText(page.url || "")])
  );

  const drafts = [];

  drafts.push(
    buildCase({
      title: "Auth smoke: login reaches the protected application shell",
      category: "Auth smoke tests",
      priority: "High",
      steps: [
        "Open the protected application login page.",
        "Submit valid credentials from secure environment variables.",
        "Wait for the authenticated shell to load.",
        "Confirm protected navigation or dashboard markers are visible.",
      ],
      expectedResult: "The login flow reaches the authenticated application shell and exposes protected navigation.",
    })
  );

  for (const module of modules.slice(0, 10)) {
    drafts.push(...buildModuleCases(module, routeByModule.get(module.toLowerCase()) || ""));
  }

  for (const page of pages.slice(0, 8)) {
    drafts.push(...buildPageCases(page));
  }

  if (hasModule(modules, "Collections")) {
    drafts.push(...buildCollectionWorkflowCases(routeByModule.get("collections") || ""));
  }

  drafts.push(...buildOptionalCases(pages));

  const limited = drafts.slice(0, maxCases).map((item, index) => ({
    ...item,
    id: toId(index),
  }));

  return {
    websiteUrl: cleanText(websiteBrief?.url || ""),
    websiteTitle: cleanText(websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website"),
    summary: cleanText(
      `Grounded authenticated suite generated from ${modules.length} visible modules and ${pages.length} discovered pages.`
    ),
    generationSource: "grounded-authenticated-discovery",
    generatedAt: new Date().toISOString(),
    testCases: limited,
  };
}
