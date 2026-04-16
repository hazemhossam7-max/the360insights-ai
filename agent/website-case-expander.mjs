function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return cleanText(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function truncate(value, maxLength = 80) {
  const text = cleanText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function removeWebsiteName(value, websiteTitle) {
  const text = cleanText(value);
  const site = normalizeKey(websiteTitle);
  if (!site) {
    return text;
  }

  return cleanText(
    text
      .replace(new RegExp(site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ")
      .replace(/\bthe360\s*insights\b/ig, " ")
      .replace(/\bthe360insights\b/ig, " ")
  );
}

function humanizePath(pathname) {
  return cleanText(
    String(pathname || "")
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean)
      .join(" ")
      .replace(/[-_]+/g, " ")
  );
}

function extractSeedFeature(testCase, websiteTitle) {
  const raw = cleanText(
    [testCase?.sourceCriterion, testCase?.title, testCase?.expectedResult]
      .filter(Boolean)
      .join(" ")
  );
  if (!raw) {
    return "";
  }

  let text = removeWebsiteName(raw, websiteTitle);
  text = text
    .replace(/^\s*verify\s+/i, "")
    .replace(/^\s*display\s+/i, "")
    .replace(/^\s*show\s+/i, "")
    .replace(/\b(home page|landing page|dashboard|page|section|flow|experience)\b/gi, "$1")
    .trim();

  return truncate(text || raw, 72);
}

function buildFeaturePool(websiteBrief, seedCases = []) {
  const websiteTitle = cleanText(websiteBrief?.websiteTitle || websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website");
  const websiteHost = cleanText(websiteBrief?.host || "");
  const websiteSummary = cleanText(websiteBrief?.summary || "");
  const features = new Map();

  function addFeature(label, evidence, kind = "feature", weight = 1) {
    const normalized = normalizeKey(label);
    if (!normalized) {
      return;
    }

    const existing = features.get(normalized);
    const nextEvidence = Array.from(
      new Set([
        ...(existing?.evidence || []),
        ...(Array.isArray(evidence) ? evidence : [evidence]).map((item) => cleanText(item)).filter(Boolean),
      ])
    );

    features.set(normalized, {
      label: truncate(removeWebsiteName(label, websiteTitle) || label, 72),
      evidence: nextEvidence,
      kind,
      weight: (existing?.weight || 0) + weight,
    });
  }

  addFeature(websiteTitle, [websiteSummary, websiteHost], "site", 10);
  addFeature("home page", [websiteSummary, websiteTitle], "page", 6);
  addFeature("landing page", [websiteSummary, websiteTitle], "page", 5);
  addFeature("top navigation", [websiteTitle], "navigation", 5);
  addFeature("primary call to action", [websiteTitle], "cta", 5);
  addFeature("content sections", [websiteSummary], "content", 4);

  for (const feature of Array.isArray(websiteBrief?.featureCandidates) ? websiteBrief.featureCandidates : []) {
    addFeature(feature?.feature || feature?.label || feature?.title, feature?.evidence || websiteTitle, "discovered", 8);
  }

  for (const page of Array.isArray(websiteBrief?.pages) ? websiteBrief.pages : []) {
    const pageLabel = cleanText(page?.title || page?.description || page?.url || "");
    if (pageLabel) {
      addFeature(pageLabel, [page.url, page.description], "page", 7);
    }

    for (const heading of Array.isArray(page?.headings) ? page.headings : []) {
      const label = removeWebsiteName(heading, websiteTitle);
      if (label && label.length >= 3) {
        addFeature(label, [page.url, pageLabel], "heading", 6);
      }
    }

    for (const button of Array.isArray(page?.buttons) ? page.buttons : []) {
      const label = removeWebsiteName(button, websiteTitle);
      if (label && label.length >= 2) {
        addFeature(label, [page.url, pageLabel], "button", 5);
      }
    }

    for (const form of Array.isArray(page?.forms) ? page.forms : []) {
      const label = removeWebsiteName(form?.summary || "form", websiteTitle);
      if (label && label.length >= 2) {
        addFeature(label, [page.url, pageLabel, form?.action || "", form?.method || ""], "form", 5);
      }
    }

    for (const link of Array.isArray(page?.importantLinks) ? page.importantLinks : []) {
      let linkPath = "";
      try {
        linkPath = new URL(link?.href || page?.url || websiteBrief?.url || "https://example.com").pathname;
      } catch {
        linkPath = "";
      }
      const label = removeWebsiteName(link?.text || humanizePath(linkPath), websiteTitle);
      if (label && label.length >= 2) {
        addFeature(label, [page.url, link?.href || ""], "link", 4);
      }
    }
  }

  for (const path of Array.isArray(websiteBrief?.notablePaths) ? websiteBrief.notablePaths : []) {
    const label = humanizePath(path);
    if (label) {
      addFeature(label, path, "route", 4);
    }
  }

  for (const seed of Array.isArray(seedCases) ? seedCases : []) {
    const label = extractSeedFeature(seed, websiteTitle);
    if (label) {
      addFeature(label, seed?.sourceCriterion || seed?.title || websiteTitle, "seed", 6);
    }
  }

  const genericFallbacks = [
    "billing and pricing",
    "account and profile",
    "reports and analytics",
    "charts and dashboards",
    "search and filtering",
    "forms and validation",
    "download and export",
    "support and help",
    "notifications and alerts",
    "permissions and roles",
    "settings and preferences",
    "data tables and summaries",
    "empty states and recovery",
    "keyboard accessibility",
    "screen reader behavior",
    "mobile layout",
    "desktop layout",
    "cross-browser behavior",
    "performance and load time",
    "navigation and routing",
  ];

  for (const fallback of genericFallbacks) {
    addFeature(fallback, websiteTitle, "generic", 2);
  }

  return Array.from(features.values())
    .sort((a, b) => (b.weight || 0) - (a.weight || 0) || a.label.localeCompare(b.label))
    .map((item) => ({
      label: titleCase(item.label),
      evidence: item.evidence,
      kind: item.kind,
      weight: item.weight,
    }));
}

function buildPersonaVariants() {
  return [
    { key: "first-time", label: "a first-time visitor" },
    { key: "returning", label: "a returning visitor" },
    { key: "guest", label: "a guest user" },
    { key: "authenticated", label: "an authenticated user" },
    { key: "mobile", label: "a mobile user" },
    { key: "desktop", label: "a desktop user" },
    { key: "keyboard", label: "a keyboard-only user" },
    { key: "low-bandwidth", label: "a low-bandwidth user" },
  ];
}

function buildThemeVariants() {
  return [
    {
      key: "home",
      kind: "home",
      label: "home page loads",
      buildTitle: (feature, persona, websiteTitle) => `Verify ${websiteTitle} home page loads for ${persona.label}`,
      buildPreconditions: (feature, persona, websiteTitle) => [`The ${websiteTitle} website is reachable.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} home page as ${persona.label}.`,
        "Confirm the landing page loads without errors.",
        "Verify the main headline, branding, or primary content is visible.",
        "Confirm the page shows clear entry points into the site.",
      ],
      buildExpected: (feature, persona, websiteTitle) => `The ${websiteTitle} home page loads successfully and the key entry points are visible for ${persona.label}.`,
      priority: "High",
    },
    {
      key: "flow",
      kind: "flow",
      label: "typical user flow",
      buildTitle: (feature, persona) => `Verify ${feature.label} works for a typical user flow`,
      buildPreconditions: (feature) => [`The ${feature.label} area is accessible.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Navigate to the ${feature.label} area or page.`,
        `Exercise the main ${feature.label} journey from start to finish.`,
        `Confirm the ${feature.label} flow completes successfully.`,
      ],
      buildExpected: (feature, persona) => `The ${feature.label} journey completes successfully for ${persona.label}.`,
      priority: "High",
    },
    {
      key: "navigation",
      kind: "navigation",
      label: "navigation route",
      buildTitle: (feature, persona) => `Verify navigation to ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} route or related navigation is available.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Follow the navigation path or link associated with ${feature.label}.`,
        `Confirm the destination page for ${feature.label} loads without errors.`,
        `Verify the destination content matches the selected route.`,
      ],
      buildExpected: (feature, persona) => `The ${feature.label} destination loads successfully and shows the expected content.`,
      priority: "Medium",
    },
    {
      key: "validation",
      kind: "error",
      label: "invalid or empty input",
      buildTitle: (feature, persona) => `Verify ${feature.label} handles invalid or empty input gracefully`,
      buildPreconditions: (feature) => [`The ${feature.label} area accepts user input or interactions.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Go to the ${feature.label} area or form.`,
        `Submit invalid, empty, or incomplete data for ${feature.label}.`,
        "Confirm a clear validation message or graceful empty state appears.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} flow rejects invalid input with a clear message or graceful empty state.`,
      priority: "Medium",
    },
    {
      key: "responsive-mobile",
      kind: "responsive",
      label: "responsive mobile viewport",
      buildTitle: (feature, persona) => `Verify responsive behavior on ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area is available on the site.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website on a desktop viewport.`,
        `Repeat the ${feature.label} flow on a mobile-sized viewport as ${persona.label}.`,
        "Confirm navigation, text, and controls remain usable.",
        "Verify no critical layout overlaps or clipped controls appear.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} experience remains usable and readable on mobile for ${persona.label}.`,
      priority: "Medium",
    },
    {
      key: "responsive-desktop",
      kind: "responsive",
      label: "responsive desktop viewport",
      buildTitle: (feature, persona) => `Verify responsive behavior on ${feature.label} for desktop users`,
      buildPreconditions: (feature) => [`The ${feature.label} area is available on the site.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website on a desktop-sized viewport.`,
        `Confirm the ${feature.label} area lays out correctly on larger screens.`,
        "Check that primary controls remain visible and aligned.",
        "Verify the page does not break or overflow unexpectedly.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} experience remains stable and readable on desktop.`,
      priority: "Medium",
    },
    {
      key: "accessibility-keyboard",
      kind: "accessibility",
      label: "keyboard accessibility",
      buildTitle: (feature, persona) => `Verify accessibility basics on ${feature.label} with keyboard navigation`,
      buildPreconditions: (feature) => [`The ${feature.label} area is reachable from the home page.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Use only the keyboard to reach the ${feature.label} area.`,
        "Confirm focus moves logically through the interactive controls.",
        "Verify the main action can be completed without a mouse.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} area is usable with keyboard navigation.`,
      priority: "Medium",
    },
    {
      key: "accessibility-labels",
      kind: "accessibility",
      label: "screen reader labels",
      buildTitle: (feature, persona) => `Verify accessibility labels for ${feature.label} are understandable`,
      buildPreconditions: (feature) => [`The ${feature.label} area is visible.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Inspect the labels and controls around ${feature.label}.`,
        "Confirm interactive elements have meaningful labels or visible text.",
        "Verify the content is understandable without relying only on color or icons.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} area exposes understandable labels and controls.`,
      priority: "Medium",
    },
    {
      key: "cta",
      kind: "cta",
      label: "call-to-action availability",
      buildTitle: (feature, persona) => `Verify call-to-action visibility for ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area is visible.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Review the ${feature.label} area for the primary call-to-action.`,
        "Confirm the main action is visible and clickable.",
        "Verify the action leads to the expected next page or section.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} call-to-action is visible and functional.`,
      priority: "High",
    },
    {
      key: "content",
      kind: "content",
      label: "content consistency",
      buildTitle: (feature, persona) => `Verify content consistency for ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} content is available.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Review the visible content for ${feature.label}.`,
        "Confirm headings, summary text, and supporting content align with the page purpose.",
        "Verify there is no obvious mismatch between title and displayed content.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} content is consistent and understandable.`,
      priority: "Medium",
    },
    {
      key: "performance",
      kind: "performance",
      label: "load time performance",
      buildTitle: (feature, persona) => `Verify ${feature.label} loads within an acceptable time for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} page or area is reachable.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Measure how long the ${feature.label} area takes to become visible.`,
        "Confirm the page reaches an interactive state without a long delay.",
        "Verify the load time stays within the expected budget.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} area becomes usable within the expected performance budget.`,
      priority: "Medium",
    },
    {
      key: "empty",
      kind: "error",
      label: "empty state handling",
      buildTitle: (feature, persona) => `Verify ${feature.label} handles empty state gracefully for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area can appear with no available data.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Navigate to the ${feature.label} area with no data or results available.`,
        "Confirm an empty-state message or placeholder is shown instead of a crash.",
        "Verify the user can recover or continue navigating.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} area presents a graceful empty state.`,
      priority: "Medium",
    },
    {
      key: "refresh",
      kind: "feature",
      label: "state persistence and refresh",
      buildTitle: (feature, persona) => `Verify ${feature.label} preserves state after refresh for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area supports a visible state or selection.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Interact with the ${feature.label} area and change a visible state.`,
        "Refresh or revisit the page.",
        "Confirm the important state is preserved or restored as expected.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} state is preserved or recovered after refresh.`,
      priority: "Medium",
    },
    {
      key: "browser",
      kind: "responsive",
      label: "cross-browser behavior",
      buildTitle: (feature, persona) => `Verify browser compatibility for ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area is available on the site.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Exercise the ${feature.label} area in the current browser.`,
        "Confirm the layout and controls behave consistently.",
        "Verify the same flow is likely to work in another modern browser.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} experience behaves consistently across browsers.`,
      priority: "Low",
    },
    {
      key: "search",
      kind: "feature",
      label: "search and filtering",
      buildTitle: (feature, persona) => `Verify search and filtering behavior for ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area exposes search or filtering controls.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Apply a search, filter, or sort action in the ${feature.label} area.`,
        "Confirm the displayed results update appropriately.",
        "Verify the user can clear the filter or search term.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} results update correctly and can be reset.`,
      priority: "Medium",
    },
    {
      key: "data",
      kind: "feature",
      label: "data updates and refresh",
      buildTitle: (feature, persona) => `Verify data updates for ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area displays dynamic data.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Trigger a refresh, save, or update action in the ${feature.label} area.`,
        "Confirm the displayed data changes or refreshes appropriately.",
        "Verify the updated state remains visible after the action completes.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} data updates correctly.`,
      priority: "Medium",
    },
    {
      key: "support",
      kind: "feature",
      label: "help and support",
      buildTitle: (feature, persona) => `Verify help and support access for ${feature.label} for ${persona.label}`,
      buildPreconditions: (feature) => [`The ${feature.label} area includes help or support content.`],
      buildSteps: (feature, persona, websiteTitle) => [
        `Open the ${websiteTitle} website as ${persona.label}.`,
        `Navigate to the help or support content related to ${feature.label}.`,
        "Confirm the support content opens and is understandable.",
        "Verify the user can return to the main journey afterward.",
      ],
      buildExpected: (feature, persona) => `The ${feature.label} help and support content is available and useful.`,
      priority: "Low",
    },
  ];
}

function normalizeDraftCase(draft, websiteTitle) {
  const title = cleanText(draft?.title || "");
  const steps = Array.isArray(draft?.steps) ? draft.steps.map((item) => cleanText(item)).filter(Boolean) : [];
  const preconditions = Array.isArray(draft?.preconditions) ? draft.preconditions.map((item) => cleanText(item)).filter(Boolean) : [];
  const expectedResult = cleanText(draft?.expectedResult || "");

  return {
    title: title || `Verify ${websiteTitle} coverage`,
    preconditions: preconditions.length ? preconditions : [`The ${websiteTitle} website is reachable.`],
    steps: steps.length ? steps : [
      `Open the ${websiteTitle} website.`,
      "Exercise the relevant user flow.",
      "Confirm the expected behavior occurs.",
    ],
    expectedResult: expectedResult || `The ${websiteTitle} experience behaves as expected.`,
    priority: ["High", "Medium", "Low"].includes(draft?.priority) ? draft.priority : "Medium",
    automationCandidate: draft?.automationCandidate !== false,
    sourceCriterion: cleanText(draft?.sourceCriterion || draft?.title || expectedResult || title || ""),
  };
}

function buildDraftKey(draft) {
  return normalizeKey(
    [draft?.title, draft?.sourceCriterion, draft?.expectedResult, ...(Array.isArray(draft?.steps) ? draft.steps : [])]
      .filter(Boolean)
      .join(" ")
  );
}

function buildSyntheticPool(websiteBrief, basePool, targetCount) {
  const websiteTitle = cleanText(websiteBrief?.websiteTitle || websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website");
  const supplemental = [];
  const countsByKind = new Map();
  const themes = buildThemeVariants();
  const personas = buildPersonaVariants();

  const genericLabels = [
    "billing and pricing",
    "reporting dashboard",
    "analytics summary",
    "hero and branding",
    "navigation menu",
    "primary action",
    "secondary action",
    "content section",
    "search and filters",
    "forms and validation",
    "accessibility labels",
    "mobile layout",
    "desktop layout",
    "empty state",
    "error state",
    "performance budget",
    "browser compatibility",
    "help center",
    "settings panel",
    "data cards",
  ].map((label) => ({
    label: titleCase(label),
    evidence: [websiteTitle],
    kind: "generic",
  }));

  const expandedFeatures = [...basePool];
  for (const item of genericLabels) {
    expandedFeatures.push(item);
  }

  function nextPriority(themePriority) {
    const count = countsByKind.get(themePriority) || 0;
    countsByKind.set(themePriority, count + 1);
    return themePriority;
  }

  for (const feature of expandedFeatures) {
    for (const theme of themes) {
      for (const persona of personas) {
        if (supplemental.length >= targetCount) {
          break;
        }

        const key = normalizeKey(`${feature.label} ${theme.key} ${persona.key}`);
        if (supplemental.some((item) => item.__key === key)) {
          continue;
        }

        const draft = normalizeDraftCase(
          {
            title: theme.buildTitle(feature, persona, websiteTitle),
            preconditions: theme.buildPreconditions(feature, persona, websiteTitle),
            steps: theme.buildSteps(feature, persona, websiteTitle),
            expectedResult: theme.buildExpected(feature, persona, websiteTitle),
            priority: nextPriority(theme.priority),
            automationCandidate: true,
            sourceCriterion: `${feature.label} :: ${theme.label} :: ${persona.label}`,
          },
          websiteTitle
        );

        draft.__key = key;
        supplemental.push(draft);
      }
    }
  }

  return supplemental;
}

export function expandWebsiteTestCases(websiteBrief, seedCases = [], targetCount = 1000) {
  const websiteTitle = cleanText(websiteBrief?.websiteTitle || websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website");
  const desiredCount = Math.max(1, Number(targetCount) || 1);
  const normalizedSeeds = Array.isArray(seedCases)
    ? seedCases.map((item) => normalizeDraftCase(item, websiteTitle))
    : [];
  const featurePool = buildFeaturePool(websiteBrief, normalizedSeeds);
  const expanded = [];
  const seen = new Set();

  function pushDraft(draft) {
    const normalized = normalizeDraftCase(draft, websiteTitle);
    const key = buildDraftKey(normalized);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    expanded.push(normalized);
    return true;
  }

  for (const seed of normalizedSeeds) {
    pushDraft(seed);
  }

  for (const feature of featurePool) {
    if (expanded.length >= desiredCount) {
      break;
    }

    const pool = buildSyntheticPool(
      websiteBrief,
      [feature, ...featurePool.filter((item) => normalizeKey(item.label) !== normalizeKey(feature.label))],
      desiredCount - expanded.length + 100
    );

    for (const item of pool) {
      if (expanded.length >= desiredCount) {
        break;
      }
      pushDraft(item);
    }
  }

  if (expanded.length < desiredCount) {
    const backupPool = buildSyntheticPool(websiteBrief, featurePool, desiredCount - expanded.length + 1000);
    for (const item of backupPool) {
      if (expanded.length >= desiredCount) {
        break;
      }
      pushDraft(item);
    }
  }

  return expanded.slice(0, desiredCount).map((item, index) => ({
    ...item,
    id: `TC-${String(index + 1).padStart(3, "0")}`,
  }));
}
