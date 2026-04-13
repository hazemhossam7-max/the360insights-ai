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

export function generateTestCaseDrafts(story) {
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
