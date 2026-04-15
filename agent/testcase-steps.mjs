function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanStepText(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

function splitInlineNumberedSteps(text) {
  return normalizeText(text)
    .replace(/\s+(?=\d+\.\s)/g, "\n")
    .split("\n")
    .map((line) => cleanStepText(line))
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:\d+\.|[-*])\s*/, "").trim())
    .filter(Boolean);
}

function extractSection(text, sectionName) {
  const normalized = normalizeText(text).replace(
    /\s+(Source criterion|Preconditions|Steps?|Expected result|Expected outcome|Expected)\s*:/gi,
    "\n$1:"
  );
  const headerPattern = new RegExp(
    String.raw`(?:^|\n)\s*${sectionName}\s*:?\s*([\s\S]*?)(?=(?:\n\s*(?:Source criterion|Preconditions|Steps?|Expected result|Expected outcome|Expected)\s*:)|$)`,
    "i"
  );
  const match = normalized.match(headerPattern);
  return cleanStepText(match?.[1] || "");
}

export function parseLegacyDescriptionToSteps(description) {
  const normalized = normalizeText(description);
  if (!normalized) {
    return {
      steps: [],
      expectedResult: "",
    };
  }

  const sectionized = normalized.replace(
    /\s+(Source criterion|Preconditions|Steps?|Expected result|Expected outcome|Expected)\s*:/gi,
    "\n$1:"
  );

  const stepsBlock = extractSection(sectionized, "Steps");
  const expectedResult =
    extractSection(sectionized, "Expected result") ||
    extractSection(sectionized, "Expected outcome") ||
    extractSection(sectionized, "Expected") ||
    "";

  const steps = [];
  if (stepsBlock) {
    for (const line of stepsBlock.split("\n")) {
      const cleaned = cleanStepText(line);
      if (!cleaned) {
        continue;
      }

      const normalizedLine = cleaned.replace(/^\s*(?:\d+\.|[-*])\s*/, "");
      const parts = splitInlineNumberedSteps(normalizedLine);
      if (parts.length > 1) {
        steps.push(...parts);
        continue;
      }

      if (normalizedLine) {
        steps.push(normalizedLine);
      }
    }
  }

  if (!steps.length) {
    const fallbackText = sectionized
      .replace(/(?:^|\n)\s*(?:Source criterion|Preconditions|Expected result|Expected outcome|Expected)\s*:\s*/gi, "\n")
      .replace(/\n+/g, "\n")
      .trim();

    for (const line of fallbackText.split("\n")) {
      const cleaned = cleanStepText(line).replace(/^\s*(?:\d+\.|[-*])\s*/, "").trim();
      if (cleaned) {
        steps.push(cleaned);
      }
    }
  }

  if (!steps.length) {
    const sentenceParts = normalized
      .split(/(?<=[.!?])\s+/)
      .map((value) => cleanStepText(value))
      .filter(Boolean);
    steps.push(...sentenceParts);
  }

  return {
    steps: Array.from(new Set(steps.map((value) => cleanStepText(value)).filter(Boolean))),
    expectedResult: cleanStepText(expectedResult),
  };
}

export function buildTestCaseStepsXml(steps, expectedResult = "") {
  const normalizedSteps = Array.isArray(steps)
    ? steps.map((value) => cleanStepText(value)).filter(Boolean)
    : [];
  const actionSteps = normalizedSteps.length ? normalizedSteps : ["Open the app and follow the scenario."];
  const finalExpected = cleanStepText(expectedResult);

  const xmlSteps = actionSteps
    .map((step, index) => {
      const isLast = index === actionSteps.length - 1;
      const stepExpected = isLast ? finalExpected : "";
      return [
        `<step id="${index + 1}" type="ActionStep">`,
        `<parameterizedString isformatted="true">${escapeXml(step)}</parameterizedString>`,
        `<parameterizedString isformatted="true">${escapeXml(stepExpected)}</parameterizedString>`,
        "<description />",
        "</step>",
      ].join("");
    })
    .join("");

  return `<steps id="0" last="${actionSteps.length}">${xmlSteps}</steps>`;
}

export function buildTestCaseStepsXmlFromDraft(testCaseDraft) {
  const steps = Array.isArray(testCaseDraft?.steps) ? testCaseDraft.steps : [];
  return buildTestCaseStepsXml(steps, testCaseDraft?.expectedResult || "");
}
