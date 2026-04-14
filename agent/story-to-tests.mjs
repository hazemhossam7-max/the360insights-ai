function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitAcceptanceCriteria(text) {
  return cleanText(text)
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function summarizeCriterion(criterion) {
  const stripped = cleanText(criterion)
    .replace(/^(given|when|then|and)\s+/i, "")
    .replace(/[.?!]+$/, "");

  return truncate(stripped, 72);
}

function buildSteps(storyTitle, criterion) {
  const summary = cleanText(criterion);
  return [
    `Open the user story for "${storyTitle}".`,
    `Review the acceptance criterion: "${summary}".`,
    "Exercise the UI flow or API path that satisfies the criterion.",
    "Confirm the expected outcome matches the story.",
  ];
}

function buildWebsiteCaseTitle(feature, suffix) {
  const base = cleanText(feature || "the website");
  return `Verify ${base} ${suffix}`.trim();
}

function buildWebsiteSteps(websiteTitle, feature, action) {
  const label = cleanText(feature || websiteTitle || "the website");
  return [
    `Open the ${cleanText(websiteTitle || "website")} site.`,
    `Navigate to the ${label} area or page.`,
    action,
    `Confirm the ${label} experience behaves as expected.`,
  ];
}

function generateWebsiteTestCaseDrafts(websiteBrief) {
  const websiteTitle = cleanText(websiteBrief?.websiteTitle || websiteBrief?.title || websiteBrief?.host || websiteBrief?.url || "Website");
  const summary = cleanText(websiteBrief?.summary || "");
  const featureCandidates = Array.isArray(websiteBrief?.featureCandidates)
    ? websiteBrief.featureCandidates
    : [];
  const notablePaths = Array.isArray(websiteBrief?.notablePaths) ? websiteBrief.notablePaths : [];

  const features = [
    ...new Set(
      featureCandidates
        .map((item) => cleanText(item?.feature))
        .filter(Boolean)
    ),
  ];

  const cases = [];
  const targetCount = Math.max(5, 1 + features.length * 2, notablePaths.length ? 4 : 0);

  cases.push({
    id: "TC-001",
    title: `Verify ${websiteTitle} home page loads and key navigation is visible`,
    preconditions: [`The ${websiteTitle} website is reachable.`],
    steps: [
      `Open the ${websiteTitle} home page.`,
      "Confirm the main page content loads without errors.",
      "Confirm the primary navigation or key call-to-action is visible.",
      "Verify the page title and top-level branding are correct.",
    ],
    expectedResult: `The ${websiteTitle} home page loads successfully and the user can see the main navigation or call-to-action.`,
    priority: "High",
    automationCandidate: true,
    sourceCriterion: summary || "Homepage smoke coverage",
  });

  for (const feature of features) {
    if (cases.length >= targetCount) {
      break;
    }

    cases.push({
      id: `TC-${String(cases.length + 1).padStart(3, "0")}`,
      title: buildWebsiteCaseTitle(feature, "works for a typical user flow"),
      preconditions: [`The ${feature.toLowerCase()} area is accessible.`],
      steps: buildWebsiteSteps(
        websiteTitle,
        feature,
        `Exercise the main ${feature.toLowerCase()} journey from start to finish.`
      ),
      expectedResult: `The ${feature.toLowerCase()} journey completes successfully on ${websiteTitle}.`,
      priority: cases.length === 1 ? "High" : "Medium",
      automationCandidate: true,
      sourceCriterion: feature,
    });

    if (cases.length >= targetCount) {
      break;
    }

    cases.push({
      id: `TC-${String(cases.length + 1).padStart(3, "0")}`,
      title: buildWebsiteCaseTitle(feature, "handles invalid or empty input gracefully"),
      preconditions: [`The ${feature.toLowerCase()} area is accessible.`],
      steps: buildWebsiteSteps(
        websiteTitle,
        feature,
        `Submit an invalid, empty, or incomplete ${feature.toLowerCase()} action to validate error handling.`
      ),
      expectedResult: `The ${feature.toLowerCase()} flow shows a clear validation message or graceful empty state.`,
      priority: "Medium",
      automationCandidate: true,
      sourceCriterion: feature,
    });
  }

  for (const path of notablePaths.slice(0, 4)) {
    if (cases.length >= targetCount) {
      break;
    }

    const pathLabel = cleanText(path.replace(/^\/+/, "") || path || "page");
    cases.push({
      id: `TC-${String(cases.length + 1).padStart(3, "0")}`,
      title: `Verify navigation to ${pathLabel}`,
      preconditions: [`The ${websiteTitle} website is reachable.`],
      steps: [
        `Open the ${websiteTitle} website.`,
        `Navigate to the "${pathLabel}" page or route.`,
        "Confirm the destination page loads without errors.",
        "Verify the page content matches the selected route.",
      ],
      expectedResult: `The ${pathLabel} page loads successfully and shows the expected content.`,
      priority: "Medium",
      automationCandidate: true,
      sourceCriterion: pathLabel,
    });
  }

  if (cases.length < targetCount) {
    cases.push({
      id: `TC-${String(cases.length + 1).padStart(3, "0")}`,
      title: `Verify responsive behavior on ${websiteTitle}`,
      preconditions: [`The ${websiteTitle} website is reachable.`],
      steps: [
        `Open the ${websiteTitle} home page on a desktop-sized viewport.`,
        "Repeat the same flow on a mobile-sized viewport.",
        "Confirm navigation, headings, and primary content remain usable.",
        "Verify no critical layout overlaps or broken controls appear.",
      ],
      expectedResult: `The ${websiteTitle} interface remains usable across common viewport sizes.`,
      priority: "Medium",
      automationCandidate: true,
      sourceCriterion: "Responsive behavior",
    });
  }

  return {
    websiteTitle,
    summary: summary || `Website at ${cleanText(websiteBrief?.host || websiteBrief?.url || websiteTitle)}`,
    generatedAt: new Date().toISOString(),
    testCases: cases,
  };
}

export function generateTestCaseDrafts(story) {
  if (story?.featureCandidates || story?.pages || story?.websiteUrl || story?.source === "website-url") {
    return generateWebsiteTestCaseDrafts(story);
  }

  const title = cleanText(story?.title);
  const acceptanceCriteria = splitAcceptanceCriteria(
    story?.acceptanceCriteria || story?.description || ""
  );

  const criteria =
    acceptanceCriteria.length > 0
      ? acceptanceCriteria
      : ["The story's main happy path completes successfully."];

  return {
    storyId: story?.id ?? null,
    storyTitle: title,
    generatedAt: new Date().toISOString(),
    testCases: criteria.map((criterion, index) => ({
      id: `TC-${String(index + 1).padStart(3, "0")}`,
      title: `Verify ${summarizeCriterion(criterion)}`,
      preconditions: [`Story "${title}" is ready for validation.`],
      steps: buildSteps(title, criterion),
      expectedResult: cleanText(criterion),
      priority: index === 0 ? "High" : "Medium",
      automationCandidate: true,
      sourceCriterion: cleanText(criterion),
    })),
  };
}
