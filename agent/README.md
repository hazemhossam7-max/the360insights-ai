# The360 Insights AI Agent

This folder contains the Azure DevOps webhook service that will:

1. receive work-item webhook events
2. fetch the full story or website context from Azure DevOps
3. generate a draft set of test cases from the story text or from a website crawl
4. migrate existing Azure DevOps test cases from summary-style descriptions into step-based test cases

## Local run

```bash
cd agent
npm start
```

## Required environment variables

- `AZDO_ORG_URL` - for example `https://dev.azure.com/your-org`
- `AZDO_PROJECT` - for example `the360insights-ai`
- `AZDO_PAT` - a token with permission to read work items
- `OPENAI_API_KEY` - preferred for AI-based test generation and website automation
- `OPENAI_MODEL` - optional, defaults to `gpt-4o-mini`
- `OPENAI_BASE_URL` - optional, defaults to `https://api.openai.com`
- `GEMINI_API_KEY` - still supported if you want to keep using Gemini
- `GEMINI_MODEL` - optional, defaults to `gemini-2.5-flash`
- `GEMINI_BASE_URL` - optional, defaults to `https://generativelanguage.googleapis.com/v1beta`
- `AI_PROVIDER` - optional, set to `gemini` or `openai` to force a provider
- `AZDO_TEST_PLAN_ID` - optional, enables Test Plans upload
- `AZDO_TEST_SUITE_ID` - optional, enables Test Plans upload
- `PORT` - optional, defaults to `3000`
- `ALLOW_HEURISTIC_FALLBACK` - optional, set to `true` only if you want the rule-based fallback generator

By default, the agent uses OpenAI if `OPENAI_API_KEY` is present, otherwise it falls back to Gemini when `GEMINI_API_KEY` is present.
Set `AI_PROVIDER=openai` if you want to force OpenAI even when Gemini variables are also present.
Set `AI_PROVIDER=gemini` if you want to force Gemini even when OpenAI variables are also present.
Set `ALLOW_HEURISTIC_FALLBACK=true` only if you want to keep the older rule-based fallback as a backup.

If your Azure App Service already has the legacy lowercase keys from earlier setup
(`azdo.org.url`, `azdo.project`, `azdo.pat`, `azdo.test.plan.id`,
`azdo.test.suite.id`, `openai.key`, `openai.model`, `openai.base.url`), the
agent will read those too.

## Endpoints

- `GET /health`
- `GET /`
- `POST /webhook`
- `GET /inspect-url?url=https://example.com`
- `POST /inspect-url`

`/inspect-url` crawls the given website URL, summarizes visible pages and feature candidates, generates test cases with the selected AI provider, and uploads them to Azure Test Plans if plan and suite IDs are configured.

## Test case migration

To rewrite existing Azure DevOps test cases so their content lives in the Steps field instead of the Description field, run:

```bash
npm run migrate:test-cases
```

The script expects:

- `AZDO_ORG_URL`
- `AZDO_PROJECT`
- `AZDO_PAT`
- `AZDO_TEST_PLAN_ID` optional, limit the rewrite to one or more comma-separated plan ids

If `AZDO_TEST_PLAN_ID` is omitted, it scans every test plan in the project, rewrites each test case that still has summary text in Description, and stores the converted content in Microsoft.VSTS.TCM.Steps.

## Webhook URL

After deployment to Azure App Service, the webhook URL becomes:

`https://<your-app-name>.azurewebsites.net/webhook`
