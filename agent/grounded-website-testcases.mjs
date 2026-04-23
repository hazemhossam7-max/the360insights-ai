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

// ---------------------------------------------------------------------------
// Known route hints for each module (tried before UI sidebar navigation).
// Multiple candidates are listed in priority order.
// ---------------------------------------------------------------------------
const KNOWN_MODULE_ROUTE_HINTS = {
  "dashboard": ["/dashboard", "/"],
  "directory": ["/directory", "/athletes"],
  "athlete 360°": ["/athlete-360", "/athlete360", "/athletes"],
  "athlete 360": ["/athlete-360", "/athlete360", "/athletes"],
  "collections": ["/collections"],
  "competitions": ["/competitions"],
  "ai opponent analysis": ["/ai-opponent-analysis", "/opponent-analysis"],
  "technical analysis": ["/technical-analysis"],
  "mental analysis": ["/mental-analysis"],
  "training planner": ["/training-planner", "/training"],
  "rank-up calculator": ["/rank-up-calculator", "/rankup-calculator"],
  "ai insights": ["/ai-insights", "/insights"],
  "sponsorship hub": ["/sponsorship-hub", "/sponsorship"],
};

function resolveModuleRoute(moduleName, routeByModule) {
  const lower = cleanText(moduleName).toLowerCase();
  const discovered = routeByModule.get(lower) || "";
  if (discovered) return discovered;
  const hints = KNOWN_MODULE_ROUTE_HINTS[lower] || [];
  return hints[0] || "";
}

// ---------------------------------------------------------------------------
// Workflow case builders – one per module
// ---------------------------------------------------------------------------

function buildDashboardWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Dashboard loads with real metrics content",
      category: "Workflow data creation tests",
      module: "Dashboard",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Navigate to the Dashboard module.",
        "Verify the Dashboard loads with substantive content (metrics, stats, or activity feed).",
        "Confirm the content is not an empty state or error page.",
      ],
      expectedResult:
        "The Dashboard module loads with real metrics, statistics, or activity content visible to the authenticated user.",
      action: {
        type: "verify_module_content",
        module: "Dashboard",
        route,
        moduleAliases: ["Home", "Overview"],
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
}

function buildDirectoryWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Directory search returns athlete results",
      category: "Workflow data creation tests",
      module: "Directory",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Directory module.",
        "Use the search input to search for an athlete.",
        "Verify that results are returned after the search.",
      ],
      expectedResult:
        "The Directory module accepts a search query and returns visible athlete results.",
      action: {
        type: "search_in_directory",
        module: "Directory",
        route,
        moduleAliases: ["Athletes", "Player Directory"],
        query: "a",
      },
      assertions: [],
    }),
  ];
}

function buildAthlete360WorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Athlete 360° opens athlete detail view",
      category: "Workflow data creation tests",
      module: "Athlete 360°",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Athlete 360° module.",
        "Click on the first visible athlete card or list item.",
        "Verify a detail view opens with athlete-specific information.",
      ],
      expectedResult:
        "An athlete detail view opens showing relevant athlete data (stats, profile, or analysis sections).",
      action: {
        type: "open_first_athlete",
        module: "Athlete 360°",
        route,
        moduleAliases: ["Athlete 360", "Athletes"],
      },
      assertions: [],
    }),
  ];
}

function buildCompetitionsWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Competitions module loads competition data",
      category: "Workflow data creation tests",
      module: "Competitions",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Competitions module.",
        "Verify the module loads with competition data or a list of competitions.",
        "Confirm the content is real data, not an empty or broken state.",
      ],
      expectedResult:
        "The Competitions module loads with visible competition entries or relevant competition content.",
      action: {
        type: "verify_module_content",
        module: "Competitions",
        route,
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
}

function buildAiOpponentAnalysisWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: AI Opponent Analysis module loads its interface",
      category: "Workflow data creation tests",
      module: "AI Opponent Analysis",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the AI Opponent Analysis module.",
        "Verify the module loads with an analysis interface or results.",
        "Confirm the module content is not blank or in an error state.",
      ],
      expectedResult:
        "The AI Opponent Analysis module loads with a functional interface for opponent analysis.",
      action: {
        type: "verify_module_content",
        module: "AI Opponent Analysis",
        route,
        moduleAliases: ["Opponent Analysis", "AI Opponent"],
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
}

function buildTechnicalAnalysisWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Technical Analysis module loads with analysis content",
      category: "Workflow data creation tests",
      module: "Technical Analysis",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Technical Analysis module.",
        "Verify the module loads with technical analysis content or interface.",
        "Confirm the content is not blank or in an error state.",
      ],
      expectedResult:
        "The Technical Analysis module loads with a functional technical analysis interface or results.",
      action: {
        type: "verify_module_content",
        module: "Technical Analysis",
        route,
        moduleAliases: ["Technical"],
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
}

function buildMentalAnalysisWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Mental Analysis module loads with analysis content",
      category: "Workflow data creation tests",
      module: "Mental Analysis",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Mental Analysis module.",
        "Verify the module loads with mental analysis content or interface.",
        "Confirm the content is not blank or in an error state.",
      ],
      expectedResult:
        "The Mental Analysis module loads with mental analysis content relevant to the authenticated user.",
      action: {
        type: "verify_module_content",
        module: "Mental Analysis",
        route,
        moduleAliases: ["Mental"],
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
}

function buildTrainingPlannerWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: create training plan and verify it persists",
      category: "Workflow data creation tests",
      module: "Training Planner",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Training Planner module.",
        "Create a new training plan with automation-generated name and description.",
        "Confirm the plan appears in the list after save.",
      ],
      expectedResult:
        "A real training plan can be created successfully and remains visible after save.",
      action: {
        type: "create_training_plan",
        module: "Training Planner",
        route,
        locators: {
          createButton:
            'button:has-text("Create Plan"), button:has-text("New Plan"), button:has-text("Create Training Plan"), button:has-text("Add Plan"), button:has-text("Add")',
          nameInput:
            'input[placeholder*="plan name" i], input[placeholder*="name" i], input[name*="name" i], input[name*="title" i]',
          submitButton:
            'button:has-text("Save"), button:has-text("Create"), button:has-text("Submit"), button:has-text("Create Plan")',
        },
      },
      assertions: [
        { type: "created_entity_visible", entityType: "training_plan" },
      ],
    }),
  ];
}

function buildRankUpCalculatorWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Rank-Up Calculator accepts inputs and produces output",
      category: "Workflow data creation tests",
      module: "Rank-Up Calculator",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Rank-Up Calculator module.",
        "Fill in calculator inputs (scores or metrics) with test values.",
        "Trigger the calculation.",
        "Verify the calculator produces a visible output or result.",
      ],
      expectedResult:
        "The Rank-Up Calculator accepts numeric inputs and produces a visible rank or score result.",
      action: {
        type: "run_rank_calculator",
        module: "Rank-Up Calculator",
        route,
        moduleAliases: ["Rank Up Calculator", "RankUp", "Calculator", "Rank-Up"],
      },
      assertions: [],
    }),
  ];
}

function buildAiInsightsWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: AI Insights module loads with insights content",
      category: "Workflow data creation tests",
      module: "AI Insights",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the AI Insights module.",
        "Verify the module loads with AI-generated insights or a functional interface.",
        "Confirm the content is not blank or in an error state.",
      ],
      expectedResult:
        "The AI Insights module loads with visible AI insights or a functional interface for generating them.",
      action: {
        type: "verify_module_content",
        module: "AI Insights",
        route,
        moduleAliases: ["Insights", "AI"],
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
}

function buildSponsorshipHubWorkflowCases(route) {
  return [
    buildWorkflowCase({
      title: "Workflow: Sponsorship Hub loads with sponsorship content",
      category: "Workflow data creation tests",
      module: "Sponsorship Hub",
      route,
      priority: "High",
      steps: [
        "Log into the protected application.",
        "Open the Sponsorship Hub module.",
        "Verify the module loads with sponsorship listings or content.",
        "Confirm the content is not blank or in an error state.",
      ],
      expectedResult:
        "The Sponsorship Hub module loads with visible sponsorship opportunities or sponsor listings.",
      action: {
        type: "verify_module_content",
        module: "Sponsorship Hub",
        route,
        moduleAliases: ["Sponsorship", "Sponsors"],
        minBodyChars: 100,
      },
      assertions: [],
    }),
  ];
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

  // ---------------------------------------------------------------------------
  // Workflow cases – always generated for the 12 known target modules.
  // openModule() uses sidebar navigation as fallback when routes are unknown.
  // ---------------------------------------------------------------------------

  drafts.push(
    ...buildDashboardWorkflowCases(resolveModuleRoute("dashboard", routeByModule))
  );

  drafts.push(
    ...buildDirectoryWorkflowCases(resolveModuleRoute("directory", routeByModule))
  );

  drafts.push(
    ...buildAthlete360WorkflowCases(resolveModuleRoute("athlete 360°", routeByModule))
  );

  drafts.push(
    ...buildCollectionWorkflowCases(resolveModuleRoute("collections", routeByModule))
  );

  drafts.push(
    ...buildCompetitionsWorkflowCases(resolveModuleRoute("competitions", routeByModule))
  );

  drafts.push(
    ...buildAiOpponentAnalysisWorkflowCases(
      resolveModuleRoute("ai opponent analysis", routeByModule)
    )
  );

  drafts.push(
    ...buildTechnicalAnalysisWorkflowCases(
      resolveModuleRoute("technical analysis", routeByModule)
    )
  );

  drafts.push(
    ...buildMentalAnalysisWorkflowCases(resolveModuleRoute("mental analysis", routeByModule))
  );

  drafts.push(
    ...buildTrainingPlannerWorkflowCases(resolveModuleRoute("training planner", routeByModule))
  );

  drafts.push(
    ...buildRankUpCalculatorWorkflowCases(
      resolveModuleRoute("rank-up calculator", routeByModule)
    )
  );

  drafts.push(
    ...buildAiInsightsWorkflowCases(resolveModuleRoute("ai insights", routeByModule))
  );

  drafts.push(
    ...buildSponsorshipHubWorkflowCases(resolveModuleRoute("sponsorship hub", routeByModule))
  );

  for (const page of pages.slice(0, 8)) {
    drafts.push(...buildPageCases(page));
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
