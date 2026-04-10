# Test Plan

## Scope
Validate the multi-page Trip Budget Planner, backend persistence, API-backed history rendering, filtering, aggregate insights, and destructive actions.

## Test Types
- Smoke: pages load and navigation works
- Positive: valid plans calculate correctly, save successfully, and appear in downstream pages
- Negative: invalid inputs are blocked on both client and server paths
- Boundary: threshold rules and min and max ranges compute correctly
- Regression: rerun the complete suite after any bug fix

## Environments
- Local Node server on `http://127.0.0.1:4180`
- Chromium browser controlled through Playwright

## Entry Criteria
- Backend server starts successfully
- Storage file exists or can be created
- Browser automation dependency and browser runtime are available

## Exit Criteria
- All cases in `test_cases.json` pass
- Failure artifacts exist for any intermediate failed run
- No blocking runtime errors break navigation or API-backed flows

## Failure Handling
- Capture a screenshot into `/bug_reports`
- Write a markdown bug report with steps, expected result, and actual result
- Patch the defect
- Run smoke plus full regression after the fix
