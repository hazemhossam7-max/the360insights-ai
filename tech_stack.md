# Tech Stack

## Runtime
- Node.js for the backend server and local persistence

## Frontend
- HTML5 for page structure
- CSS3 with custom properties and responsive layouts
- Vanilla JavaScript for client-side validation, rendering, filtering, and API calls

## Backend
- Native Node.js `http`, `fs`, and `path` modules
- JSON file storage under `data/trips.json`

## QA and Automation
- Playwright in Node for browser-based testing
- JSON test-case source of truth
- Automated failure screenshots and markdown bug reports written to `/bug_reports`

## Why This Stack
- The backend stays lightweight and easy to run locally.
- File-backed persistence is enough for the project scope without introducing a database dependency.
- Plain JavaScript keeps the app inspectable while still supporting realistic multi-page behavior.
