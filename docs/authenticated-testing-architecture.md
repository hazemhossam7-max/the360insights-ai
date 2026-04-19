# Authentication-aware testing architecture

## Previous failure mode

The original workflow allowed this sequence:

1. fetch or crawl the website without a valid authenticated session
2. infer features from partial public HTML
3. generate many generic tests
4. execute them against a protected app that was never truly reached
5. record blocked navigation and login failures as product bugs

That produced a large noisy suite with repeated screenshots and false positives.

## New architecture

The workflow is now gated by authenticated access.

### 1. Preflight gate

The pipeline validates:

- secure auth variables are present
- login page is reachable
- valid credentials reach the protected shell

If any of these fail, the pipeline stops before bulk execution.

### 2. Shared authenticated session helper

`agent/authenticated-app-session.mjs` is now the single place that:

- builds auth config from environment variables
- validates auth requirements
- performs login
- verifies protected-shell markers
- discovers real authenticated modules/pages

### 3. Grounded discovery

After login succeeds, discovery collects only what is actually visible:

- sidebar modules
- internal reachable routes
- page titles/headings
- buttons and actions
- forms
- cards/widgets
- tables

### 4. Grounded small-suite generation

`agent/grounded-website-testcases.mjs` creates a small suite from confirmed discovery only.

Categories:

1. Auth smoke tests
2. Navigation tests
3. Module availability tests
4. Core functional smoke tests
5. UI validation tests
6. Optional deeper tests

The default cap is intentionally small to optimize trustworthiness over raw volume.

### 5. Safer execution behavior

`website_qa_runner.mjs` now:

- re-validates the authenticated session before protected checks
- stops the bulk run early if auth collapses
- marks the remaining cases as blocked/auth-related instead of continuing noisily

### 6. Safer reporting behavior

Failures are classified into:

- Product bug
- Automation issue
- Authentication/access issue
- Environment/test setup issue
- Unsupported/unconfirmed feature assumption

Only product bugs should be treated as candidate defects in the app.

### 7. Azure DevOps behavior

Azure now receives:

- a preflight stage result
- a completed test run for executed cases
- test point outcome updates

This separation makes it easier to distinguish:

- app defects
- test harness problems
- environment/auth problems

## Operational guidance

- Never bulk-run protected app tests without successful auth smoke first.
- Start with the small grounded suite.
- Expand coverage only after the authenticated discovery clearly matches the real app.
- Review the classification mix before treating failures as defects.
