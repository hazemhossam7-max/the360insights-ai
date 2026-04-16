# The360 Insights AI QA

Website automation toolkit for inspecting a live URL, generating coverage with OpenAI, and running the resulting checks with Playwright and Azure DevOps.

## What this repo does

- crawls a website URL and extracts visible content, headings, buttons, links, and forms
- generates concrete test cases from that evidence with OpenAI
- runs the automated checks in Playwright
- uploads generated cases into Azure DevOps Test Plans when credentials are provided
- publishes bug reports, screenshots, and JUnit output as pipeline artifacts

## Main entry points

- `website_qa_runner.mjs` - website crawl, generation, execution, and reporting
- `azure-pipelines.yml` - Azure Pipelines entry point for automated website runs
- `agent/` - Azure DevOps webhook agent and migration helpers
- `server.js` - local demo app server used by the repo's browser tests

## Local run

```bash
npm install
npm run serve
```

Open:

- [http://127.0.0.1:4180](http://127.0.0.1:4180)

## Automated website run

Run the generated website automation against a URL:

```bash
npm run test:website:auto -- https://the360insights.ai/
```

Set `OPENAI_API_KEY` to enable OpenAI generation. If Azure DevOps variables are present, the runner can also create or update test cases in a plan and suite.

## Azure Pipelines

The pipeline accepts:

- `websiteUrl` - the website to inspect and test
- `OPENAI_API_KEY` - secret pipeline variable for generation
- `AZDO_PROJECT_URL` or `AZDO_ORG_URL` + `AZDO_PROJECT` - Azure DevOps target
- `AZDO_PAT` or `System.AccessToken` - Azure DevOps authentication
- `AZDO_TEST_PLAN_ID` and `AZDO_TEST_SUITE_ID` - optional upload targets

## Azure DevOps agent

The `agent/` folder contains a webhook service that:

- receives Azure DevOps service-hook events
- reads work items from Azure DevOps
- generates test cases from stories or website content
- can rewrite existing Azure DevOps test cases from Description into Steps

Run it locally with:

```bash
npm run agent:serve
```

## Repository layout

```text
testing/
  azure-pipelines.yml
  website_qa_runner.mjs
  agent/
  bug_reports/
  data/
  history.html
  insights.html
  compare.html
  index.html
  planner.js
  history.js
  insights.js
  compare.js
  server.js
  tests/
  test_cases.json
  test_plan.md
  requirements.md
  tech_stack.md
```

## Legacy local demo app

The repo still includes a small local HTML/JS app and Playwright suite. Those files are kept as a stable browser target and can still be run locally, but the primary project focus is now website automation for The360 Insights.

