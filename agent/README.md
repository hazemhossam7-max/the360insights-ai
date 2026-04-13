# Trip Budget Agent

This folder contains the Azure DevOps webhook service that will:

1. receive work-item webhook events
2. fetch the full User Story from Azure DevOps
3. generate a draft set of test cases from the story text or from a website crawl

## Local run

```bash
cd agent
npm start
```

## Required environment variables

- `AZDO_ORG_URL` - for example `https://dev.azure.com/your-org`
- `AZDO_PROJECT` - for example `trip-budget-planner`
- `AZDO_PAT` - a token with permission to read work items
- `OPENAI_API_KEY` - required for AI-based test generation
- `OPENAI_MODEL` - optional, defaults to `gpt-4o-mini`
- `OPENAI_BASE_URL` - optional, defaults to `https://api.openai.com`
- `AZDO_TEST_PLAN_ID` - optional, enables Test Plans upload
- `AZDO_TEST_SUITE_ID` - optional, enables Test Plans upload
- `PORT` - optional, defaults to `3000`
- `ALLOW_HEURISTIC_FALLBACK` - optional, set to `true` only if you want the rule-based fallback generator

By default, the agent uses OpenAI for test generation and will fail if the API key or request fails.
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

`/inspect-url` crawls the given website URL, summarizes visible pages and feature candidates, generates test cases with OpenAI, and uploads them to Azure Test Plans if plan and suite IDs are configured.

## Webhook URL

After deployment to Azure App Service, the webhook URL becomes:

`https://<your-app-name>.azurewebsites.net/webhook`
