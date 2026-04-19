import assert from "node:assert/strict";
import {
  resolveWebsiteGenerationMode,
  shouldExecuteGeneratedCases,
  shouldUseGroundedGenerator,
} from "../../agent/website-generation-strategy.mjs";

const cases = [
  {
    name: "resolveWebsiteGenerationMode defaults to grounded",
    run() {
      assert.equal(resolveWebsiteGenerationMode(""), "grounded");
      assert.equal(resolveWebsiteGenerationMode("generate-grounded"), "grounded");
    },
  },
  {
    name: "resolveWebsiteGenerationMode recognizes openai generation values",
    run() {
      assert.equal(resolveWebsiteGenerationMode("generate-openai"), "openai");
      assert.equal(resolveWebsiteGenerationMode("generate-openai-only"), "openai");
      assert.equal(resolveWebsiteGenerationMode("openai"), "openai");
      assert.equal(resolveWebsiteGenerationMode("ai"), "openai");
    },
  },
  {
    name: "shouldExecuteGeneratedCases disables execution for only modes",
    run() {
      assert.equal(shouldExecuteGeneratedCases("generate-openai-only"), false);
      assert.equal(shouldExecuteGeneratedCases("generate-grounded-only"), false);
      assert.equal(shouldExecuteGeneratedCases("generate-openai"), true);
    },
  },
  {
    name: "shouldUseGroundedGenerator keeps authenticated discovery grounded by default",
    run() {
      assert.equal(
        shouldUseGroundedGenerator(
          { authenticated: true, source: "authenticated-app-discovery" },
          "generate-grounded"
        ),
        true
      );
    },
  },
  {
    name: "shouldUseGroundedGenerator allows openai for authenticated discovery when requested",
    run() {
      assert.equal(
        shouldUseGroundedGenerator(
          { authenticated: true, source: "authenticated-app-discovery" },
          "generate-openai"
        ),
        false
      );
    },
  },
  {
    name: "shouldUseGroundedGenerator uses ai generation for unauthenticated websites",
    run() {
      assert.equal(
        shouldUseGroundedGenerator(
          { authenticated: false, source: "website-url" },
          "generate-grounded"
        ),
        false
      );
    },
  },
];

let failures = 0;

for (const entry of cases) {
  try {
    await entry.run();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error?.stack || error?.message || String(error));
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log(`PASS ${cases.length} tests`);
}
