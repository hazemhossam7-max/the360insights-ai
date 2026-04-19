# The360 Insights AI QA

Authentication-aware website automation for protected web apps using Playwright and Azure DevOps Test Plans.

## Root cause we fixed

The earlier large run was contaminated by false positives:

- the agent did not have valid credentials
- discovery happened on the public landing page instead of the real app
- generic tests were generated for unseen modules
- navigation/access failures were reported like product bugs

The workflow is now built around **authenticated entry first**. If login or protected-shell validation fails, the run stops early and reports an authentication/setup problem instead of polluting Test Plans with fake defects.

## What this repo does now

- validates secure auth variables before bulk execution
- logs into the protected app with Playwright
- confirms authenticated shell visibility before continuing
- discovers real visible modules, routes, headings, buttons, forms, cards, and tables after login
- generates a smaller grounded suite from confirmed UI only
- runs existing Azure DevOps suite cases or grounded generated cases
- classifies failures into trustworthy buckets
- publishes Azure DevOps run results and updates test points

## Main entry points

- `website_qa_runner.mjs`
  Auth-aware discovery, execution, reporting, and Azure DevOps publishing
- `authenticated_smoke_check.mjs`
  Fast login validation used by the pipeline preflight stage
- `azure-pipelines.yml`
  Two-stage Azure pipeline with auth preflight and guarded execution
- `agent/authenticated-app-session.mjs`
  Shared login/session/discovery helper
- `agent/grounded-website-testcases.mjs`
  Grounded small-suite generator based on authenticated discovery
- `agent/failure-classifier.mjs`
  Failure classification rules

## Authentication-aware execution

The workflow now follows this order:

1. Validate secure variables exist
2. Open the login page
3. Submit credentials
4. Confirm protected shell markers are visible
5. Discover visible authenticated modules and pages
6. Generate a small high-confidence suite from discovered UI only
7. Execute the suite
8. Publish results and only file real bug reports for pages actually reached

If step 2–4 fails, the system produces an **Authentication/access issue** report and stops.

## Required environment variables

Use secure pipeline variables or a local `.env` loader of your choice. Never hardcode credentials.

Required for protected apps:

- `APP_REQUIRE_AUTH=true`
- `APP_LOGIN_URL`
- `APP_USERNAME`
- `APP_PASSWORD`

Optional auth helpers:

- `APP_POST_LOGIN_URL`
- `APP_USERNAME_SELECTOR`
- `APP_PASSWORD_SELECTOR`
- `APP_SUBMIT_SELECTOR`
- `APP_SUCCESS_SELECTORS`
- `APP_DISCOVERY_MAX_PAGES`

Azure DevOps execution variables:

- `AZDO_PROJECT_URL` or `AZDO_ORG_URL` + `AZDO_PROJECT`
- `AZDO_PAT` or `System.AccessToken`
- `AZDO_TEST_PLAN_ID`
- `AZDO_TEST_SUITE_ID`

Website run input:

- `websiteUrl`

See [`C:\Users\hazem\Downloads\testing\.env.auth.example`](C:\Users\hazem\Downloads\testing\.env.auth.example) for an example template.

## Failure classification

Every failure is classified as one of:

1. `Product bug`
2. `Automation issue`
3. `Authentication/access issue`
4. `Environment/test setup issue`
5. `Unsupported/unconfirmed feature assumption`

Examples:

- login page still visible after submit -> `Authentication/access issue`
- network timeout / 5xx / host resolution -> `Environment/test setup issue`
- “could not find navigation target” -> `Unsupported/unconfirmed feature assumption`
- repeated identical screenshots / blocked flow -> `Automation issue`
- real reached page with broken behavior -> `Product bug`

## Bug report rules

A report is treated as a real product bug only when:

- the protected app page was actually reached
- the module/page is known
- the steps are reproducible
- expected vs actual is clear
- the screenshot was captured from a real reached page

If the app page was not reached, the report becomes a setup/access or automation diagnostic instead.

## Local usage

Install dependencies:

```bash
npm install
npx playwright install --with-deps chromium
```

Run the auth smoke gate:

```bash
npm run test:auth:smoke -- https://the360insights.ai/
```

Run the auth-aware website runner:

```bash
npm run test:website:auto -- https://the360insights.ai/
```

## Azure Pipelines flow

The Azure pipeline now has two stages:

1. `Preflight`
   - validate secure auth variables
   - perform authenticated smoke login
   - publish `preflight-results`
2. `Execute`
   - only runs if preflight passed
   - runs the auth-aware suite
   - publishes JUnit, raw results, and bug reports

## Recommended execution flow

Use this sequence for reliable runs:

1. Configure secure auth variables
2. Run the authenticated smoke check
3. Confirm the discovered modules match the real app shell
4. Start with a small grounded suite
5. Review classifications, not just raw failures
6. Expand coverage only after auth and discovery are stable

## Supporting notes

- architecture note:
  [`C:\Users\hazem\Downloads\testing\docs\authenticated-testing-architecture.md`](C:\Users\hazem\Downloads\testing\docs\authenticated-testing-architecture.md)
- auth env template:
  [`C:\Users\hazem\Downloads\testing\.env.auth.example`](C:\Users\hazem\Downloads\testing\.env.auth.example)
