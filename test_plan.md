# Test Plan

## Scope

Validate the website automation flow, website analysis, OpenAI generation, Playwright execution, Azure DevOps upload path, and artifact publishing.

## Test Types

- Smoke: the website can be crawled and a run can start
- Positive: real site features generate useful coverage and execute successfully
- Negative: invalid inputs and unavailable services fail with clear messages
- Regression: rerun the automation after any bug fix

## Environments

- Local Node server on `http://127.0.0.1:4180`
- Chromium browser controlled through Playwright
- Azure Pipelines for hosted automation runs

## Entry Criteria

- Target website is reachable
- OpenAI key is configured when AI generation is expected
- Azure DevOps credentials are configured when uploads are expected
- Browser automation dependency and browser runtime are available

## Exit Criteria

- Generated checks have been executed
- Failure artifacts exist for any failed run
- A JSON report and JUnit file were published
- Any configured Azure DevOps upload completed successfully

## Failure Handling

- Capture a screenshot into `/bug_reports`
- Write a markdown bug report with steps, expected result, and actual result
- Retry transient service failures where possible
- Keep the pipeline output visible in artifacts for review

