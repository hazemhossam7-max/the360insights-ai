# The360 Insights AI QA Requirements

## Overview

Build a website automation project that can inspect a live URL, generate useful test coverage from the visible page content, run the checks with Playwright, and publish the results into Azure DevOps artifacts or Test Plans.

## Goals

- Crawl a website URL and summarize observable features
- Generate concrete automated coverage with OpenAI
- Execute the generated checks in Playwright
- Store the output in pipeline artifacts
- Optionally upload generated cases to Azure DevOps Test Plans

## Functional Requirements

- Accept a `websiteUrl` input for the automation run
- Extract headings, links, buttons, forms, and page text from the target site
- Generate multiple site-specific test cases from the crawl results
- Prefer OpenAI when `OPENAI_API_KEY` is present
- Fall back to a safe local generator when the AI path is unavailable
- Execute the generated checks automatically in the browser
- Produce screenshots and markdown bug reports for failures
- Publish a JUnit report and JSON summary for the pipeline run

## Azure DevOps Integration

- Support `AZDO_PROJECT_URL` or `AZDO_ORG_URL` + `AZDO_PROJECT`
- Support `AZDO_PAT` or `System.AccessToken`
- Support optional plan and suite IDs for upload targets
- Reuse existing Azure DevOps utilities for uploads and migration

## Non-Goals

- Rebuilding the old trip-planner demo into a production app
- Storing sensitive data outside the configured Azure DevOps / OpenAI settings
- Turning Azure Test Plans into the primary browser runner

## Acceptance Criteria

- The pipeline can run end to end from a website URL
- The pipeline can generate and execute meaningful test coverage
- The repository no longer presents itself as a trip-planner project
