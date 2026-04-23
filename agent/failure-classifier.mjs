function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, patterns) {
  const haystack = cleanText(text).toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern));
}

export function isRealBugClassification(classification) {
  return cleanText(classification).toLowerCase() === "product bug";
}

export function classifyFailure({ error, pageContext, authState, screenshotFingerprintCount = 1 }) {
  const message = cleanText(error?.message || error || "");
  const currentUrl = cleanText(pageContext?.url || "").toLowerCase();
  const currentTitle = cleanText(pageContext?.title || "").toLowerCase();
  const reachedProtectedPage = Boolean(pageContext?.reachedProtectedPage);
  const explicitlyUnauthenticated = authState?.authenticated === false;

  // Respect explicit classification set by the executor
  if (error?.classification === "authentication_access_issue") {
    return "Authentication/access issue";
  }

  if (error?.classification === "automation_issue") {
    return "Automation issue";
  }

  if (explicitlyUnauthenticated && !reachedProtectedPage) {
    return "Authentication/access issue";
  }

  if (
    includesAny(message, [
      "missing required authentication configuration",
      "login form could not be found",
      "did not reach the authenticated application shell",
      "authenticated discovery lost",
      "password field",
    ]) ||
    /\/login\b|\bsignin\b|\bauth\b/.test(currentUrl) ||
    /\blogin\b|\bsign in\b/.test(currentTitle)
  ) {
    return "Authentication/access issue";
  }

  if (
    includesAny(message, [
      "timed out",
      "http 500",
      "http 502",
      "http 503",
      "http 504",
      "net::",
      "enotfound",
      "econnrefused",
      "empty during the performance check",
    ])
  ) {
    return "Environment/test setup issue";
  }

  if (
    includesAny(message, [
      "could not find a navigation target",
      "could not validate the",
      "unsupported",
      "unconfirmed",
    ])
  ) {
    return "Unsupported/unconfirmed feature assumption";
  }

  // Executor gaps that are clearly automation issues, not product bugs
  if (
    includesAny(message, [
      "could not find a create action",
      "could not find a submit/save action",
      "could not find a name/title field",
      "could not open the",
      "could not find a calculate",
      "no numeric inputs are available",
      "no search input",
      "no athlete cards",
      "insufficient content",
    ]) &&
    reachedProtectedPage
  ) {
    return "Automation issue";
  }

  // Repeated screenshot fingerprints suggest the page is stuck/looping
  if (screenshotFingerprintCount > 2) {
    return "Environment/test setup issue";
  }

  return "Product bug";
}
