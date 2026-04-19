function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveWebsiteGenerationMode(value) {
  const normalized = cleanText(value);
  if (["generate-openai", "openai", "ai"].includes(normalized)) {
    return "openai";
  }

  return "grounded";
}

export function shouldUseGroundedGenerator(websiteBrief, generationMode) {
  const mode = resolveWebsiteGenerationMode(generationMode);
  const authenticated =
    websiteBrief?.source === "authenticated-app-discovery" || Boolean(websiteBrief?.authenticated);

  return authenticated && mode !== "openai";
}
