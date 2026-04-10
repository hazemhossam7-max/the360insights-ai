# Trip Budget Planner

A multi-page travel budgeting app with a lightweight Node.js backend, local JSON persistence, and browser-based QA automation.

## Overview

Trip Budget Planner helps a traveler:

- generate a budget snapshot for a trip
- calculate daily and per-traveler spending guidance
- save trip plans to persistent storage
- review saved history
- inspect aggregate insights
- compare multiple saved trips side by side

The project is intentionally simple to run locally while still covering realistic app behavior across frontend, backend, persistence, and end-to-end tests.

## Features

- Multi-page experience:
  - Planner
  - History
  - Insights
  - Compare
- Client-side validation for trip planning inputs
- Server-side validation before persistence
- Risk classification based on daily-per-traveler budget
- Style-based allocation breakdowns
- Saved trip history with style filtering
- Aggregate analytics across saved trips
- Side-by-side trip comparison view
- Empty states and graceful backend-unavailable messaging
- Playwright-based automated regression coverage

## Pages

### Planner

The planner page lets a user:

- enter trip details
- generate a budget summary
- see allocation recommendations
- save a valid trip
- reset the form

### History

The history page lets a user:

- review saved trips
- filter trips by travel style
- clear all saved trips

### Insights

The insights page shows:

- total trips
- average budget
- average daily budget
- most common style
- number of trips flagged as `Too Tight`
- total budget tracked across all trips

### Compare

The compare page highlights:

- best daily value trip
- highest total budget trip
- count of tight-budget trips
- a side-by-side comparison table of saved plans

## Validation and Business Rules

### Input rules

- Trip name: 2 to 40 characters
- Destination: 2 to 50 characters
- Budget: `100` to `50000`
- Days: `1` to `30`
- Travelers: `1` to `10`
- Travel style: required
- Notes: up to `160` characters

### Risk rules

`dailyPerTraveler = total budget / days / travelers`

- `< 35` => `Too Tight`
- `35` to `< 80` => `Balanced`
- `>= 80` => `Comfortable`

### Allocation rules

- Shoestring:
  - Lodging 35%
  - Food 25%
  - Transport 20%
  - Activities 20%
- Balanced:
  - Lodging 40%
  - Food 25%
  - Transport 15%
  - Activities 20%
- Comfort:
  - Lodging 45%
  - Food 20%
  - Transport 15%
  - Activities 20%

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js built-in `http`, `fs`, and `path`
- Persistence: local JSON file at `data/trips.json`
- QA: Playwright via Node

See also [tech_stack.md](./tech_stack.md).

## Project Structure

```text
testing/
  index.html
  history.html
  insights.html
  compare.html
  styles.css
  planner.js
  history.js
  insights.js
  compare.js
  server.js
  qa_runner.mjs
  test_cases.json
  test_plan.md
  requirements.md
  tech_stack.md
  data/
  bug_reports/
```

## Getting Started

### Prerequisites

- Node.js
- npm

### Install dependencies

```bash
npm install
```

### Run the app

```bash
npm run serve
```

Then open:

- [http://127.0.0.1:4180](http://127.0.0.1:4180)

## Testing

Run the end-to-end QA suite:

```bash
npm run test:e2e
```

The QA runner:

- loads the app in Chromium
- exercises planner, history, insights, and compare flows
- captures screenshots and markdown bug reports on failure
- writes a JSON summary to `bug_reports/latest_report.json`

## API Endpoints

- `GET /api/trips`
- `POST /api/trips`
- `DELETE /api/trips`
- `GET /api/stats`

## Key Files

- [server.js](./server.js): backend routes, validation, persistence, stats
- [planner.js](./planner.js): planner logic, calculations, saving
- [history.js](./history.js): history rendering and filtering
- [insights.js](./insights.js): aggregate stats rendering
- [compare.js](./compare.js): comparison page logic
- [qa_runner.mjs](./qa_runner.mjs): end-to-end automation
- [test_cases.json](./test_cases.json): source of truth for QA cases

## Notes

- Opening the HTML files directly from disk will show the UI shell, but backend-powered features work fully when the Node server is running.
- Runtime notices are shown in file-preview mode to clarify that persistence and analytics depend on the backend.
