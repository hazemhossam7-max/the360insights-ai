# Trip Budget Agent

This folder contains the Azure DevOps webhook service that will:

1. receive work-item webhook events
2. fetch the full User Story from Azure DevOps
3. generate a draft set of test cases from the story text

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

If `OPENAI_API_KEY` is not set, the agent falls back to the rule-based generator.

## Endpoints

- `GET /health`
- `GET /`
- `POST /webhook`

## Webhook URL

After deployment to Azure App Service, the webhook URL becomes:

`https://<your-app-name>.azurewebsites.net/webhook`
